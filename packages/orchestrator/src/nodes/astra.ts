/**
 * ASTRA nodes — normalize a requirement via Syntra HTTP, then route
 * actionable work onto the SYNTRA bridge event (`syntra.jd.normalized`).
 *
 * Error model (design §10 / ClassifiedError):
 * - Syntra unreachable / 5xx / network → transient (pg-boss retry)
 * - Missing jobId / empty JD content / 400|404|422 → permanent-input (terminal)
 *
 * Stub policy (stricter than syntra.* passthrough nodes):
 * - ORCH_STUB_SYNTRA=1|force → demo stub only (explicit opt-in)
 * - unset / auto / 0 / off → NEVER soft-stub. Unreachable Syntra throws
 *   ClassifiedError(transient). ASTRA is a gate; auto-stubbing
 *   is_actionable:true would silently pass bad input in production.
 */
import { v4 as uuidv4 } from 'uuid';
import type { EventInput } from '../types.js';
import { ClassifiedError } from '../workflow/errors.js';
import type { NodeImpl } from './types.js';

/** Event types used by ASTRA nodes (DB seed lands in Stage 3). */
export const ASTRA_EVENT_TYPES = {
  REQUIREMENT_RECEIVED: 'astra.requirement.received',
  REQUIREMENT_NORMALIZED: 'astra.requirement.normalized',
  REQUIREMENT_REJECTED: 'astra.requirement.rejected',
  /** Bridge into SYNTRA matching — not the raw upload event. */
  JD_NORMALIZED: 'syntra.jd.normalized',
} as const;

const SYNTRA_BASE = process.env.SYNTRA_API_URL || 'http://localhost:4000';

/** Explicit force only — ASTRA never treats unset/auto as soft-stub. */
function stubForced(): boolean {
  const v = (process.env.ORCH_STUB_SYNTRA ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'force';
}

function jobIdFromPayload(p: Record<string, unknown> | undefined): string | undefined {
  if (!p) return undefined;
  const id =
    (p.jobId as string | undefined) ??
    (p.requirement_id as string | undefined) ??
    (p.requirementId as string | undefined);
  return id ? String(id) : undefined;
}

function rawTextFromPayload(p: Record<string, unknown> | undefined): string | undefined {
  if (!p) return undefined;
  const raw =
    (p.raw_text as string | undefined) ??
    (p.rawText as string | undefined) ??
    (p.body as string | undefined) ??
    (p.content as string | undefined);
  return raw === undefined || raw === null ? undefined : String(raw);
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
    aggregate_type: trigger.aggregate_type ?? 'requirement',
    organization_id: trigger.organization_id,
    correlation_id: trigger.correlation_id,
    payload,
  };
}

/**
 * POST Syntra ASTRA normalize.
 * Soft-stub ONLY when ORCH_STUB_SYNTRA is explicitly force/1 — never on auto/unset.
 */
async function postAstraNormalize(
  jobId: string,
  body: Record<string, unknown>,
): Promise<Record<string, any>> {
  const path = `/internal/astra/requirements/${jobId}/normalize`;
  if (stubForced()) {
    return {
      status: 'stubbed',
      stub: true,
      path,
      jobId,
      is_actionable: true,
      isActionable: true,
      confidence_score: 0.9,
      confidenceScore: 0.9,
      parser_version: 'orch.stub.astra.v1',
    };
  }

  try {
    const res = await fetch(`${SYNTRA_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      const permanent =
        res.status === 400 || res.status === 404 || res.status === 422;
      throw new ClassifiedError(
        `astra.requirement.normalize: Syntra ${path} failed: ${res.status} ${text}`,
        permanent ? 'permanent-input' : 'transient',
        { cause: { statusCode: res.status, body: text } },
      );
    }
    return (await res.json()) as Record<string, any>;
  } catch (err) {
    if (err instanceof ClassifiedError) throw err;

    const message = err instanceof Error ? err.message : String(err);
    throw new ClassifiedError(
      `astra.requirement.normalize: Syntra unreachable: ${message}`,
      'transient',
      { cause: err },
    );
  }
}

/**
 * Normalize / enrich a requirement via Syntra ASTRA intelligence.
 * Emits `astra.requirement.normalized` for the route gate (or downstream).
 */
export const astraRequirementNormalize: NodeImpl = async (state, ctx) => {
  const trigger = state.trigger_event;
  if (!trigger) {
    throw new ClassifiedError(
      'astra.requirement.normalize: missing trigger_event',
      'permanent-input',
    );
  }

  const jobId = jobIdFromPayload(trigger.payload);
  if (!jobId) {
    throw new ClassifiedError(
      'astra.requirement.normalize: no jobId in payload',
      'permanent-input',
    );
  }

  // Present-but-empty JD text is permanent-input (poison; do not retry).
  // Absent raw_text is OK — Syntra may load the row by jobId.
  const rawText = rawTextFromPayload(trigger.payload);
  if (rawText !== undefined && rawText.trim() === '') {
    throw new ClassifiedError(
      'astra.requirement.normalize: empty raw_text — unprocessable JD content',
      'permanent-input',
    );
  }

  ctx.logger.info('calling Syntra ASTRA normalize', { jobId, orgId: ctx.orgId });
  const r = await postAstraNormalize(jobId, {
    jobId,
    requirement_id: jobId,
    raw_text: rawText,
    title: trigger.payload?.title,
    channel_type: trigger.payload?.channel_type,
    ...((typeof ctx.config.prompt === 'string' && ctx.config.prompt.trim()
      ? { prompt: ctx.config.prompt.trim() }
      : {}) as Record<string, unknown>),
  });

  const isActionable = Boolean(
    r.is_actionable ?? r.isActionable ?? true,
  );
  const confidenceScore = Number(
    r.confidence_score ?? r.confidenceScore ?? 0,
  );
  const parserVersion =
    (r.parser_version as string | undefined) ??
    (r.parserVersion as string | undefined) ??
    (r.stub ? 'orch.stub.astra.v1' : 'astra-intelligence-v1');

  ctx.events.emit(
    completionEvent(trigger, ASTRA_EVENT_TYPES.REQUIREMENT_NORMALIZED, {
      jobId,
      requirement_id: jobId,
      status: r.status ?? 'normalized',
      parser_version: parserVersion,
      is_actionable: isActionable,
      confidence_score: confidenceScore,
      syntra: r,
    }),
  );

  // Same-graph handoff: route reads trigger_event.payload — merge normalize
  // output so route does not decide on the original ingress-only fields.
  return {
    result: `astra.normalize ${jobId}: actionable=${isActionable} confidence=${confidenceScore}`,
    trigger_event: {
      ...trigger,
      payload: {
        ...trigger.payload,
        jobId,
        requirement_id: jobId,
        is_actionable: isActionable,
        confidence_score: confidenceScore,
        parser_version: parserVersion,
        status: r.status ?? 'normalized',
      },
    },
  };
};

/**
 * Gate: actionable + minConfidence → emit bridge event (default syntra.jd.normalized);
 * otherwise emit reject (default astra.requirement.rejected).
 *
 * Config:
 * - onActionable: event type string (default syntra.jd.normalized)
 * - onRejected: event type string (default astra.requirement.rejected)
 * - minConfidence: number (default 0)
 */
export const astraRouteDecision: NodeImpl = async (state, ctx) => {
  const trigger = state.trigger_event;
  if (!trigger) {
    throw new ClassifiedError(
      'astra.route.decision: missing trigger_event',
      'permanent-input',
    );
  }

  const p = trigger.payload ?? {};
  const jobId = jobIdFromPayload(p);
  if (!jobId) {
    throw new ClassifiedError(
      'astra.route.decision: no jobId in payload',
      'permanent-input',
    );
  }

  const isActionable = Boolean(p.is_actionable ?? p.isActionable);
  const confidenceScore = Number(p.confidence_score ?? p.confidenceScore ?? 0);
  const minConfidence =
    typeof ctx.config.minConfidence === 'number' ? ctx.config.minConfidence : 0;
  const onActionable = String(
    ctx.config.onActionable ?? ASTRA_EVENT_TYPES.JD_NORMALIZED,
  );
  const onRejected = String(
    ctx.config.onRejected ?? ASTRA_EVENT_TYPES.REQUIREMENT_REJECTED,
  );

  const pass = isActionable && confidenceScore >= minConfidence;
  if (pass) {
    ctx.events.emit(
      completionEvent(trigger, onActionable, {
        jobId,
        requirement_id: jobId,
        status: 'normalized',
        is_actionable: true,
        confidence_score: confidenceScore,
        parser_version: p.parser_version ?? p.parserVersion,
        source_event_id: trigger.event_id,
      }),
    );
    return {
      result: `astra.route ${jobId}: actionable → ${onActionable}`,
    };
  }

  const reason = !isActionable
    ? 'not_actionable'
    : `confidence_below_min (${confidenceScore} < ${minConfidence})`;

  ctx.events.emit(
    completionEvent(trigger, onRejected, {
      jobId,
      requirement_id: jobId,
      status: 'rejected',
      is_actionable: isActionable,
      confidence_score: confidenceScore,
      reason,
      source_event_id: trigger.event_id,
    }),
  );
  return {
    result: `astra.route ${jobId}: rejected (${reason}) → ${onRejected}`,
  };
};
