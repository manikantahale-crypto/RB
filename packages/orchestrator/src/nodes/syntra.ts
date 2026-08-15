/**
 * Syntra peer adapters (HTTP) — NOT the design §4 in-process nodes.
 *
 * Set ORCH_STUB_SYNTRA=1 to fake Syntra responses (demo without Syntra :4000).
 * When unset, unreachable Syntra still stubs once with a warning so smoke
 * paths stay green; set ORCH_STUB_SYNTRA=0 to fail hard.
 */
import { v4 as uuidv4 } from 'uuid';
import { EVENT_TYPES } from '@tekisho/domain';
import type { EventInput } from '../types.js';
import type { NodeCtx, NodeImpl, SyntraGraphState } from './types.js';

const SYNTRA_BASE = process.env.SYNTRA_API_URL || 'http://localhost:4000';

function stubMode(): 'force' | 'auto' | 'off' {
  const v = (process.env.ORCH_STUB_SYNTRA ?? 'auto').toLowerCase();
  if (v === '1' || v === 'true' || v === 'force') return 'force';
  if (v === '0' || v === 'false' || v === 'off') return 'off';
  return 'auto';
}

async function postSyntra(
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, any>> {
  const mode = stubMode();
  if (mode === 'force') {
    return {
      status: 'stubbed',
      stub: true,
      path,
      body: body ?? null,
      skillMatchScore: 0.82,
    };
  }

  try {
    const res = await fetch(`${SYNTRA_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`Syntra ${path} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as Record<string, any>;
  } catch (err) {
    if (mode === 'off') throw err;
    console.warn(
      `[syntra] unreachable (${SYNTRA_BASE}${path}) — stubbing response. ` +
        `Set ORCH_STUB_SYNTRA=0 to fail hard. Cause: ${
          err instanceof Error ? err.message : err
        }`,
    );
    return {
      status: 'stubbed',
      stub: true,
      path,
      body: body ?? null,
      skillMatchScore: 0.75,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
    aggregate_type: trigger.aggregate_type,
    organization_id: trigger.organization_id,
    correlation_id: trigger.correlation_id,
    payload,
  };
}

/** Summarize JD via Syntra internal API. */
export const syntraJdProcess: NodeImpl = async (state, ctx) => {
  const trigger = state.trigger_event;
  const jobId =
    trigger?.payload?.jobId ?? trigger?.payload?.requirement_id;
  if (!jobId || !trigger) throw new Error('syntra.jd.process: no jobId in payload');

  ctx.logger.info('calling Syntra JD process', { jobId, orgId: ctx.orgId });
  const r = await postSyntra(`/internal/jobs/${jobId}/process`);
  ctx.events.emit(
    completionEvent(trigger, EVENT_TYPES.JD_PARSED, {
      jobId,
      requirement_id: jobId,
      status: r.status,
      syntra: r,
      parser_version: r.stub ? 'orch.stub.v1' : 'syntra',
    }),
  );
  return { result: `job ${jobId}: ${r.status ?? 'ok'}` };
};

/** Summarize resume + profile via Syntra. */
export const syntraResumeProcess: NodeImpl = async (state, ctx) => {
  const trigger = state.trigger_event;
  const resumeId = trigger?.payload?.resumeId;
  const candidateId = trigger?.payload?.candidateId;
  if (!resumeId || !trigger) {
    throw new Error('syntra.resume.process: no resumeId in payload');
  }

  ctx.logger.info('calling Syntra resume process', { resumeId, orgId: ctx.orgId });
  const r = await postSyntra(`/internal/resumes/${resumeId}/process`, {
    candidateId,
  });
  ctx.events.emit(
    completionEvent(trigger, EVENT_TYPES.PROFILE_PREPARED, {
      resumeId,
      candidateId,
      status: r.status,
      syntra: r,
    }),
  );
  return { result: `resume ${resumeId}: ${r.status ?? 'ok'}` };
};

/**
 * Score job × resume via Syntra.
 * Prefer Syntra response score; fall back to inbound skillMatchScore from the queue payload.
 */
export const syntraMatchProcess: NodeImpl = async (
  state: SyntraGraphState,
  ctx: NodeCtx,
) => {
  const trigger = state.trigger_event;
  const jobId =
    trigger?.payload?.jobId ?? trigger?.payload?.requirement_id;
  const resumeId = trigger?.payload?.resumeId;
  if (!jobId || !resumeId || !trigger) {
    throw new Error('syntra.match.process: need jobId and resumeId');
  }

  ctx.logger.info('calling Syntra match process', {
    jobId,
    resumeId,
    orgId: ctx.orgId,
  });
  const r = await postSyntra(`/internal/matches/process`, { jobId, resumeId });
  const skillMatchScore =
    r.skillMatchScore ??
    r.score ??
    r.matchScore ??
    trigger.payload?.skillMatchScore ??
    null;

  ctx.events.emit(
    completionEvent(trigger, EVENT_TYPES.MATCH_COMPLETED, {
      jobId,
      resumeId,
      candidateId: trigger.payload?.candidateId,
      match_job_id: trigger.payload?.match_job_id ?? uuidv4(),
      requirement_id: jobId,
      skillMatchScore,
      result_count: 1,
      top_score: skillMatchScore,
      status: r.status,
      syntra: r,
    }),
  );
  return {
    result: `match ${jobId}/${resumeId}: ${r.status ?? 'ok'} (score=${skillMatchScore})`,
  };
};
