/**
 * ASTRA nodes — channel intake, quality, normalize, route (+ Syntra HTTP).
 *
 * Tools (nodeRegistry / TOOL_CATALOG):
 * - astra.requirement.intake   → POST /internal/astra/intake/email
 * - astra.requirement.ingest   → POST /internal/astra/requirements/ingest
 * - astra.jobboard.fetch       → POST /internal/astra/jobboards/fetch
 * - astra.requirement.quality  → POST /internal/astra/requirements/quality
 * - astra.requirement.normalize→ POST /internal/astra/requirements/:id/normalize
 * - astra.route.decision       → orch-only bridge / reject
 *
 * Stub: ORCH_STUB_SYNTRA=1|force only (never auto-stub for ASTRA HTTP).
 */
import { v4 as uuidv4 } from 'uuid';
import type { EventInput } from '../types.js';
import { ClassifiedError } from '../workflow/errors.js';
import type { NodeImpl, SyntraGraphState } from './types.js';

export const ASTRA_EVENT_TYPES = {
  REQUIREMENT_RECEIVED: 'astra.requirement.received',
  REQUIREMENT_NORMALIZED: 'astra.requirement.normalized',
  REQUIREMENT_REJECTED: 'astra.requirement.rejected',
  REQUIREMENT_SCORED: 'astra.requirement.scored',
  JD_NORMALIZED: 'syntra.jd.normalized',
} as const;

const SYNTRA_BASE = process.env.SYNTRA_API_URL || 'http://localhost:4000';

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

async function postAstra(
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
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      const permanent =
        res.status === 400 || res.status === 404 || res.status === 422;
      throw new ClassifiedError(
        `Syntra ${path} failed: ${res.status} ${text}`,
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
        ? `Syntra timeout after ${timeoutMs}ms (${path})`
        : `Syntra unreachable (${path}): ${err instanceof Error ? err.message : String(err)}`,
      'transient',
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
  }
}

function requireTrigger(state: SyntraGraphState, tool: string): EventInput {
  if (!state.trigger_event) {
    throw new ClassifiedError(`${tool}: missing trigger_event`, 'permanent-input');
  }
  return state.trigger_event;
}

/** Email-shaped intake → astra.requirement.received */
export const astraRequirementIntake: NodeImpl = async (state, ctx) => {
  const trigger = requireTrigger(state, 'astra.requirement.intake');
  const p = trigger.payload ?? {};
  const body = {
    subject: p.subject ?? p.title,
    body: rawTextFromPayload(p),
    from: p.from ?? p.source_email ?? p.source,
    title: p.title,
    location: p.location,
  };
  if (!body.body || !String(body.body).trim()) {
    throw new ClassifiedError(
      'astra.requirement.intake: empty email body / raw_text',
      'permanent-input',
    );
  }

  ctx.logger.info('calling Syntra ASTRA email intake', { orgId: ctx.orgId });
  const r = await postAstra('/internal/astra/intake/email', body, {
    created: true,
    jobId: jobIdFromPayload(p) ?? uuidv4(),
    requirement_id: jobIdFromPayload(p) ?? undefined,
    channel_type: 'EMAIL',
  });
  const jobId = String(r.jobId ?? r.requirement_id ?? jobIdFromPayload(p) ?? '');
  if (!jobId) {
    throw new ClassifiedError(
      'astra.requirement.intake: Syntra returned no jobId',
      'permanent-input',
    );
  }

  ctx.events.emit(
    completionEvent(trigger, ASTRA_EVENT_TYPES.REQUIREMENT_RECEIVED, {
      jobId,
      requirement_id: jobId,
      title: r.title ?? body.subject,
      channel_type: 'EMAIL',
      syntra: r,
    }),
  );

  return {
    result: `astra.intake email → job=${jobId}`,
    trigger_event: {
      ...trigger,
      payload: {
        ...p,
        jobId,
        requirement_id: jobId,
        channel_type: 'EMAIL',
        raw_text: body.body,
      },
    },
  };
};

/** Source-agnostic ingest → astra.requirement.received */
export const astraRequirementIngest: NodeImpl = async (state, ctx) => {
  const trigger = requireTrigger(state, 'astra.requirement.ingest');
  const p = trigger.payload ?? {};
  const rawText = rawTextFromPayload(p);
  if (!rawText || !rawText.trim()) {
    throw new ClassifiedError(
      'astra.requirement.ingest: raw_text required',
      'permanent-input',
    );
  }
  const body = {
    title: p.title,
    raw_text: rawText,
    location: p.location,
    company_name: p.company_name ?? p.companyName,
    channel_type: p.channel_type ?? 'API',
    source: p.source ?? 'orch',
  };
  ctx.logger.info('calling Syntra ASTRA ingest', { orgId: ctx.orgId });
  const r = await postAstra('/internal/astra/requirements/ingest', body, {
    created: true,
    jobId: jobIdFromPayload(p) ?? uuidv4(),
    channel_type: body.channel_type,
  });
  const jobId = String(r.jobId ?? r.requirement_id ?? '');
  if (!jobId) {
    throw new ClassifiedError(
      'astra.requirement.ingest: Syntra returned no jobId',
      'permanent-input',
    );
  }
  ctx.events.emit(
    completionEvent(trigger, ASTRA_EVENT_TYPES.REQUIREMENT_RECEIVED, {
      jobId,
      requirement_id: jobId,
      title: r.title ?? body.title,
      channel_type: body.channel_type,
      syntra: r,
    }),
  );
  return {
    result: `astra.ingest → job=${jobId} duplicate=${Boolean(r.duplicate)}`,
    trigger_event: {
      ...trigger,
      payload: { ...p, jobId, requirement_id: jobId, raw_text: rawText },
    },
  };
};

/** Job-board batch fetch → emits received per created job (first id stays on state) */
export const astraJobboardFetch: NodeImpl = async (state, ctx) => {
  const trigger = requireTrigger(state, 'astra.jobboard.fetch');
  const p = trigger.payload ?? {};
  const body = {
    source: p.source ?? ctx.config.source ?? 'manual',
    keyword: p.keyword ?? p.query ?? p.title ?? 'software engineer',
    location: p.location ?? '',
    listings: p.listings,
    raw_text: rawTextFromPayload(p),
  };
  ctx.logger.info('calling Syntra ASTRA jobboard fetch', {
    source: body.source,
    orgId: ctx.orgId,
  });
  const r = await postAstra('/internal/astra/jobboards/fetch', body, {
    status: 'ok',
    count: 1,
    results: [
      {
        created: true,
        jobId: jobIdFromPayload(p) ?? uuidv4(),
        channel_type: 'JOB_BOARD',
      },
    ],
  });

  const results = Array.isArray(r.results) ? r.results : [];
  let firstJobId: string | undefined;
  for (const item of results) {
    const id = item?.jobId ?? item?.requirement_id;
    if (!id) continue;
    if (!firstJobId) firstJobId = String(id);
    ctx.events.emit(
      completionEvent(trigger, ASTRA_EVENT_TYPES.REQUIREMENT_RECEIVED, {
        jobId: String(id),
        requirement_id: String(id),
        channel_type: 'JOB_BOARD',
        source: body.source,
        syntra: item,
      }),
    );
  }
  if (!firstJobId) {
    throw new ClassifiedError(
      'astra.jobboard.fetch: no jobs created',
      'permanent-input',
    );
  }
  return {
    result: `astra.jobboard.fetch count=${results.length} first=${firstJobId}`,
    trigger_event: {
      ...trigger,
      payload: {
        ...p,
        jobId: firstJobId,
        requirement_id: firstJobId,
        channel_type: 'JOB_BOARD',
      },
    },
  };
};

/** Cheap quality score (no full LLM normalize) */
export const astraRequirementQuality: NodeImpl = async (state, ctx) => {
  const trigger = requireTrigger(state, 'astra.requirement.quality');
  const p = trigger.payload ?? {};
  const jobId = jobIdFromPayload(p);
  const body = {
    jobId,
    requirement_id: jobId,
    title: p.title,
    raw_text: rawTextFromPayload(p),
    required_skills: p.required_skills ?? p.requiredSkills,
    location: p.location,
  };
  ctx.logger.info('calling Syntra ASTRA quality', { jobId, orgId: ctx.orgId });
  const r = await postAstra('/internal/astra/requirements/quality', body, {
    status: 'scored',
    is_actionable: true,
    confidence_score: 0.75,
    validation_details: 'stub_quality',
  });
  const isActionable = Boolean(r.is_actionable ?? r.isActionable);
  const confidenceScore = Number(r.confidence_score ?? r.confidenceScore ?? 0);

  ctx.events.emit(
    completionEvent(trigger, ASTRA_EVENT_TYPES.REQUIREMENT_SCORED, {
      jobId: jobId ?? null,
      requirement_id: jobId ?? null,
      is_actionable: isActionable,
      confidence_score: confidenceScore,
      validation_details: r.validation_details ?? r.validationDetails,
      syntra: r,
    }),
  );

  return {
    result: `astra.quality actionable=${isActionable} confidence=${confidenceScore}`,
    trigger_event: {
      ...trigger,
      payload: {
        ...p,
        is_actionable: isActionable,
        confidence_score: confidenceScore,
        validation_details: r.validation_details ?? r.validationDetails,
      },
    },
  };
};

export const astraRequirementNormalize: NodeImpl = async (state, ctx) => {
  const trigger = requireTrigger(state, 'astra.requirement.normalize');
  const jobId = jobIdFromPayload(trigger.payload);
  if (!jobId) {
    throw new ClassifiedError(
      'astra.requirement.normalize: no jobId in payload',
      'permanent-input',
    );
  }
  const rawText = rawTextFromPayload(trigger.payload);
  if (rawText !== undefined && rawText.trim() === '') {
    throw new ClassifiedError(
      'astra.requirement.normalize: empty raw_text — unprocessable JD content',
      'permanent-input',
    );
  }

  ctx.logger.info('calling Syntra ASTRA normalize', { jobId, orgId: ctx.orgId });
  const r = await postAstra(
    `/internal/astra/requirements/${jobId}/normalize`,
    {
      jobId,
      requirement_id: jobId,
      raw_text: rawText,
      title: trigger.payload?.title,
      channel_type: trigger.payload?.channel_type,
      ...((typeof ctx.config.prompt === 'string' && ctx.config.prompt.trim()
        ? { prompt: ctx.config.prompt.trim() }
        : {}) as Record<string, unknown>),
    },
    {
      status: 'stubbed',
      is_actionable: true,
      confidence_score: 0.9,
      parser_version: 'orch.stub.astra.v1',
    },
  );

  const isActionable = Boolean(r.is_actionable ?? r.isActionable ?? true);
  const confidenceScore = Number(r.confidence_score ?? r.confidenceScore ?? 0);
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

export const astraRouteDecision: NodeImpl = async (state, ctx) => {
  const trigger = requireTrigger(state, 'astra.route.decision');
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
      branch_key: 'pass',
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
    branch_key: 'reject',
  };
};
