/**
 * ORBIT nodes — workforce / bench lifecycle, placement, revenue, activity.
 *
 * Independent of ASTRA (JD intake) and Syntra matching. Named `orbit.*` only.
 *
 * Tools (nodeRegistry / TOOL_CATALOG):
 * - orbit.lifecycle.transition  → POST /candidates/:id/lifecycle/transition
 * - orbit.placement.confirm     → POST /placements
 * - orbit.revenue.arrange       → POST /placements/:id/revenue
 * - orbit.activity.note         → POST /candidates/:id/activities
 * - orbit.route.decision        → orch-only branch after lifecycle/placement
 *
 * Stub: ORCH_STUB_SYNTRA=1|force (same flag as other Syntra HTTP adapters).
 */
import { v4 as uuidv4 } from 'uuid';
import type { EventInput } from '../types.js';
import { ClassifiedError } from '../workflow/errors.js';
import type { NodeImpl, SyntraGraphState } from './types.js';

export const ORBIT_EVENT_TYPES = {
  LIFECYCLE_TRANSITION_REQUESTED: 'orbit.lifecycle.transition_requested',
  LIFECYCLE_TRANSITIONED: 'orbit.lifecycle.transitioned',
  PLACEMENT_CONFIRM_REQUESTED: 'orbit.placement.confirm_requested',
  PLACEMENT_CONFIRMED: 'orbit.placement.confirmed',
  REVENUE_ARRANGE_REQUESTED: 'orbit.revenue.arrange_requested',
  REVENUE_ARRANGED: 'orbit.revenue.arranged',
  ACTIVITY_NOTE_REQUESTED: 'orbit.activity.note_requested',
  ACTIVITY_NOTED: 'orbit.activity.noted',
  BENCH_HOLD: 'orbit.bench.hold',
} as const;

const SYNTRA_BASE = process.env.SYNTRA_API_URL || 'http://localhost:4000';

function stubForced(): boolean {
  const v = (process.env.ORCH_STUB_SYNTRA ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'force';
}

function candidateIdFromPayload(
  p: Record<string, unknown> | undefined,
): string | undefined {
  if (!p) return undefined;
  const id =
    (p.candidateId as string | undefined) ??
    (p.candidate_id as string | undefined);
  return id ? String(id) : undefined;
}

function placementIdFromPayload(
  p: Record<string, unknown> | undefined,
): string | undefined {
  if (!p) return undefined;
  const id =
    (p.placementId as string | undefined) ??
    (p.placement_id as string | undefined);
  return id ? String(id) : undefined;
}

function completionEvent(
  trigger: EventInput,
  eventType: string,
  payload: Record<string, unknown>,
): EventInput {
  return {
    event_id: uuidv4(),
    event_type: eventType,
    aggregate_id: trigger.aggregate_id,
    aggregate_type: trigger.aggregate_type ?? 'candidate',
    organization_id: trigger.organization_id,
    correlation_id: trigger.correlation_id,
    payload,
  };
}

async function postOrbit(
  path: string,
  body?: Record<string, unknown>,
  stubBody?: Record<string, unknown>,
): Promise<Record<string, any>> {
  if (stubForced()) {
    return {
      status: 'stubbed',
      stub: true,
      path,
      ...(stubBody ?? {}),
    };
  }
  const controller = new AbortController();
  const timeoutMs = Number(process.env.SYNTRA_HTTP_TIMEOUT_MS ?? 60_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SYNTRA_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Orchestrator-Callback': '1',
        ...(process.env.SYNTRA_SERVICE_TOKEN
          ? { Authorization: `Bearer ${process.env.SYNTRA_SERVICE_TOKEN}` }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      const permanent =
        res.status === 400 || res.status === 404 || res.status === 422;
      throw new ClassifiedError(
        `Orbit ${path} failed: ${res.status} ${text}`,
        permanent ? 'permanent-input' : 'transient',
        { cause: { statusCode: res.status, body: text } },
      );
    }
    return (await res.json()) as Record<string, any>;
  } catch (err) {
    if (err instanceof ClassifiedError) throw err;
    const aborted =
      err instanceof Error &&
      (err.name === 'AbortError' || /aborted/i.test(err.message));
    throw new ClassifiedError(
      aborted
        ? `Orbit timeout after ${timeoutMs}ms (${path})`
        : `Orbit unreachable (${path}): ${err instanceof Error ? err.message : String(err)}`,
      'transient',
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
  }
}

function requireTrigger(state: SyntraGraphState, tool: string): EventInput {
  const t = state.trigger_event;
  if (!t) {
    throw new ClassifiedError(
      `${tool}: missing trigger_event`,
      'permanent-system',
    );
  }
  return t;
}

/** Transition candidate lifecycle (AVAILABLE|BENCH|NOTICE|PLACED|…) */
export const orbitLifecycleTransition: NodeImpl = async (state, ctx) => {
  const trigger = requireTrigger(state, 'orbit.lifecycle.transition');
  const p = (trigger.payload ?? {}) as Record<string, unknown>;
  const candidateId = candidateIdFromPayload(p);
  if (!candidateId) {
    throw new ClassifiedError(
      'orbit.lifecycle.transition: no candidate_id in payload',
      'permanent-input',
    );
  }
  const toState = String(p.to_state ?? p.toState ?? '').toUpperCase();
  if (!toState) {
    throw new ClassifiedError(
      'orbit.lifecycle.transition: to_state is required',
      'permanent-input',
    );
  }

  ctx.logger.info('calling Orbit lifecycle transition', {
    candidateId,
    toState,
    orgId: ctx.orgId,
  });

  const r = await postOrbit(
    `/internal/orbit/candidates/${candidateId}/lifecycle/transition`,
    {
      to_state: toState,
      note: p.note ?? null,
      context: p.context ?? null,
      organization_id: trigger.organization_id,
      transitioned_by: null,
    },
    {
      state: {
        candidate_id: candidateId,
        state: toState,
        previous_state: p.from_state ?? p.fromState ?? 'AVAILABLE',
      },
    },
  );

  const fromState =
    r.state?.previous_state ?? p.from_state ?? p.fromState ?? null;
  const newState = r.state?.state ?? toState;

  ctx.events.emit(
    completionEvent(trigger, ORBIT_EVENT_TYPES.LIFECYCLE_TRANSITIONED, {
      candidate_id: candidateId,
      from_state: fromState,
      to_state: newState,
      note: p.note ?? null,
      orbit: r,
    }),
  );

  return {
    result: `orbit.lifecycle ${fromState ?? '?'}→${newState}`,
    branch_key: newState === 'PLACED' ? 'placed' : 'active',
    trigger_event: {
      ...trigger,
      payload: {
        ...p,
        candidate_id: candidateId,
        from_state: fromState,
        to_state: newState,
      },
    },
  };
};

/** Confirm client placement → SAO forces PLACED + activity */
export const orbitPlacementConfirm: NodeImpl = async (state, ctx) => {
  const trigger = requireTrigger(state, 'orbit.placement.confirm');
  const p = (trigger.payload ?? {}) as Record<string, unknown>;
  const candidateId = candidateIdFromPayload(p);
  if (!candidateId) {
    throw new ClassifiedError(
      'orbit.placement.confirm: no candidate_id in payload',
      'permanent-input',
    );
  }
  const clientName = String(p.client_name ?? p.clientName ?? '');
  if (!clientName) {
    throw new ClassifiedError(
      'orbit.placement.confirm: client_name is required',
      'permanent-input',
    );
  }

  const body = {
    candidate_id: candidateId,
    requirement_id: p.requirement_id ?? p.requirementId ?? null,
    client_name: clientName,
    start_date: p.start_date ?? p.startDate,
    end_date: p.end_date ?? p.endDate ?? null,
    confirmed_bill_rate: p.confirmed_bill_rate ?? p.confirmedBillRate,
    confirmed_pay_rate: p.confirmed_pay_rate ?? p.confirmedPayRate,
    employment_model: p.employment_model ?? p.employmentModel ?? 'C2C',
    work_mode: p.work_mode ?? p.workMode ?? 'ONSITE',
    location: p.location ?? null,
    notes: p.notes ?? null,
    organization_id: trigger.organization_id,
  };

  ctx.logger.info('calling Orbit placement confirm', {
    candidateId,
    clientName,
    orgId: ctx.orgId,
  });

  const placementId = uuidv4();
  const r = await postOrbit('/internal/orbit/placements', body, {
    placement: {
      id: placementId,
      candidate_id: candidateId,
      client_name: clientName,
      status: 'ACTIVE',
    },
  });

  const createdId = r.placement?.id ?? placementId;

  ctx.events.emit(
    completionEvent(trigger, ORBIT_EVENT_TYPES.PLACEMENT_CONFIRMED, {
      candidate_id: candidateId,
      placement_id: createdId,
      client_name: clientName,
      orbit: r,
    }),
  );

  return {
    result: `orbit.placement confirmed=${createdId} client=${clientName}`,
    branch_key: 'placed',
    trigger_event: {
      ...trigger,
      payload: {
        ...p,
        candidate_id: candidateId,
        placement_id: createdId,
        client_name: clientName,
      },
    },
  };
};

/** Attach revenue arrangement to a placement */
export const orbitRevenueArrange: NodeImpl = async (state, ctx) => {
  const trigger = requireTrigger(state, 'orbit.revenue.arrange');
  const p = (trigger.payload ?? {}) as Record<string, unknown>;
  const placementId = placementIdFromPayload(p);
  if (!placementId) {
    throw new ClassifiedError(
      'orbit.revenue.arrange: no placement_id in payload',
      'permanent-input',
    );
  }

  const arrangementType = String(
    p.arrangement_type ?? p.arrangementType ?? 'MARKUP',
  ).toUpperCase();
  const value = Number(p.value ?? 0);

  ctx.logger.info('calling Orbit revenue arrange', {
    placementId,
    arrangementType,
    orgId: ctx.orgId,
  });

  const r = await postOrbit(
    `/internal/orbit/placements/${placementId}/revenue`,
    {
      arrangement_type: arrangementType,
      value,
      notes: p.notes ?? null,
      custom_formula: p.custom_formula ?? p.customFormula ?? null,
      organization_id: trigger.organization_id,
    },
    {
      arrangement: {
        placement_id: placementId,
        arrangement_type: arrangementType,
        value,
        is_current: true,
      },
    },
  );

  ctx.events.emit(
    completionEvent(trigger, ORBIT_EVENT_TYPES.REVENUE_ARRANGED, {
      placement_id: placementId,
      arrangement_type: arrangementType,
      value,
      orbit: r,
    }),
  );

  return {
    result: `orbit.revenue ${arrangementType}=${value} placement=${placementId}`,
    trigger_event: {
      ...trigger,
      payload: {
        ...p,
        placement_id: placementId,
        arrangement_type: arrangementType,
        value,
      },
    },
  };
};

/** Recruiter note on candidate timeline */
export const orbitActivityNote: NodeImpl = async (state, ctx) => {
  const trigger = requireTrigger(state, 'orbit.activity.note');
  const p = (trigger.payload ?? {}) as Record<string, unknown>;
  const candidateId = candidateIdFromPayload(p);
  if (!candidateId) {
    throw new ClassifiedError(
      'orbit.activity.note: no candidate_id in payload',
      'permanent-input',
    );
  }
  const summary = String(p.summary ?? p.note ?? '').trim();
  if (!summary) {
    throw new ClassifiedError(
      'orbit.activity.note: summary is required',
      'permanent-input',
    );
  }

  ctx.logger.info('calling Orbit activity note', {
    candidateId,
    orgId: ctx.orgId,
  });

  const r = await postOrbit(
    `/internal/orbit/candidates/${candidateId}/activities`,
    {
      summary,
      payload: p.payload ?? {},
    },
    {
      activity: {
        candidate_id: candidateId,
        activity_type: 'NOTE',
        summary,
      },
    },
  );

  ctx.events.emit(
    completionEvent(trigger, ORBIT_EVENT_TYPES.ACTIVITY_NOTED, {
      candidate_id: candidateId,
      summary,
      orbit: r,
    }),
  );

  return {
    result: `orbit.activity noted candidate=${candidateId}`,
    trigger_event: {
      ...trigger,
      payload: { ...p, candidate_id: candidateId, summary },
    },
  };
};

/**
 * Orch-only branch after lifecycle/placement.
 * placed → continue placement path; hold → emit bench hold; else active.
 */
export const orbitRouteDecision: NodeImpl = async (state, ctx) => {
  const trigger = requireTrigger(state, 'orbit.route.decision');
  const p = (trigger.payload ?? {}) as Record<string, unknown>;
  const toState = String(p.to_state ?? p.toState ?? state.branch_key ?? '')
    .toUpperCase();
  const branchFromState =
    toState === 'PLACED' || state.branch_key === 'placed'
      ? 'placed'
      : toState === 'HOLD' || toState === 'IGNORE'
        ? 'hold'
        : 'active';

  if (branchFromState === 'hold') {
    ctx.events.emit(
      completionEvent(trigger, ORBIT_EVENT_TYPES.BENCH_HOLD, {
        candidate_id: candidateIdFromPayload(p) ?? null,
        to_state: toState || 'HOLD',
        reason: p.note ?? 'lifecycle_hold',
      }),
    );
  }

  return {
    result: `orbit.route branch=${branchFromState}`,
    branch_key: branchFromState,
    trigger_event: trigger,
  };
};
