/**
 * Syntra tools for events that already exist in event_schemas but had no
 * runtime consumer (jd.parsed, profile.prepared, match.completed,
 * approval.decided, agent_run.failed).
 *
 * Same HTTP/stub behaviour as syntra.ts. Does not change the three day-1
 * process adapters.
 */
import { v4 as uuidv4 } from 'uuid';
import { EVENT_TYPES } from '@tekisho/domain';
import type { EventInput } from '../types.js';
import type { NodeImpl } from './types.js';

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
    return { status: 'stubbed', stub: true, path, body: body ?? null };
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

function payload(state: { trigger_event: EventInput | null }): Record<string, any> {
  return state.trigger_event?.payload ?? {};
}

/** jd.parsed → ask Syntra to match this requirement against the bench. */
export const syntraContinuousMatch: NodeImpl = async (state, ctx) => {
  const trigger = state.trigger_event;
  const p = payload(state);
  const jobId = p.jobId ?? p.requirement_id;
  if (!jobId || !trigger) {
    throw new Error('syntra.continuous.match: no jobId/requirement_id in payload');
  }

  ctx.logger.info('calling Syntra continuous match', { jobId, orgId: ctx.orgId });
  const r = await postSyntra(`/internal/jobs/${jobId}/continuous-match`, {
    jobId,
    requirement_id: jobId,
  });
  ctx.events.emit(
    completionEvent(trigger, EVENT_TYPES.MATCH_COMPLETED, {
      jobId,
      requirement_id: jobId,
      match_job_id: r.match_job_id ?? uuidv4(),
      result_count: r.result_count ?? 0,
      top_score: r.top_score ?? null,
      status: r.status,
      syntra: r,
    }),
  );
  return { result: `continuous match ${jobId}: ${r.status ?? 'ok'}` };
};

/** profile.prepared → probable-duplicate check. */
export const syntraDuplicateDetect: NodeImpl = async (state, ctx) => {
  const trigger = state.trigger_event;
  const p = payload(state);
  const candidateId = p.candidateId ?? p.candidate_id;
  if (!candidateId || !trigger) {
    throw new Error('syntra.duplicate.detect: no candidateId in payload');
  }

  ctx.logger.info('calling Syntra duplicate detect', {
    candidateId,
    orgId: ctx.orgId,
  });
  const r = await postSyntra(`/internal/candidates/${candidateId}/duplicates/detect`, {
    candidateId,
    candidate_profile_id: p.candidate_profile_id,
  });

  const other = r.candidate_b ?? r.duplicateCandidateId;
  if (other) {
    ctx.events.emit(
      completionEvent(trigger, EVENT_TYPES.DUPLICATE_REVIEW_REQUIRED, {
        duplicate_review_id: r.duplicate_review_id ?? uuidv4(),
        candidate_a: candidateId,
        candidate_b: other,
        approval_id: r.approval_id ?? null,
        signals: r.signals ?? {},
        status: r.status,
        syntra: r,
      }),
    );
  }
  return {
    result: other
      ? `duplicate detect ${candidateId}: review vs ${other}`
      : `duplicate detect ${candidateId}: none`,
  };
};

/** profile.prepared → bench alert (this profile vs live requirements). */
export const syntraBenchAlert: NodeImpl = async (state, ctx) => {
  const trigger = state.trigger_event;
  const p = payload(state);
  const candidateId = p.candidateId ?? p.candidate_id;
  if (!candidateId || !trigger) {
    throw new Error('syntra.bench.alert: no candidateId in payload');
  }

  ctx.logger.info('calling Syntra bench alert', { candidateId, orgId: ctx.orgId });
  const r = await postSyntra(`/internal/candidates/${candidateId}/bench-alert`, {
    candidateId,
    candidate_profile_id: p.candidate_profile_id,
  });
  const jobId = r.jobId ?? r.requirement_id;
  const resumeId = p.resumeId ?? p.document_id;
  if (jobId && resumeId) {
    ctx.events.emit(
      completionEvent(trigger, EVENT_TYPES.MATCH_REQUESTED, {
        candidateId,
        jobId,
        resumeId,
        status: r.status,
        syntra: r,
      }),
    );
  }
  return { result: `bench alert ${candidateId}: ${r.status ?? 'ok'}` };
};

/** match.completed → tell Syntra the shortlist is ready (UI notify). */
export const syntraShortlistNotify: NodeImpl = async (state, ctx) => {
  const trigger = state.trigger_event;
  const p = payload(state);
  const jobId = p.jobId ?? p.requirement_id;
  if (!jobId || !trigger) {
    throw new Error('syntra.shortlist.notify: no jobId/requirement_id in payload');
  }

  ctx.logger.info('calling Syntra shortlist notify', { jobId, orgId: ctx.orgId });
  const r = await postSyntra(`/internal/jobs/${jobId}/shortlist/notify`, {
    jobId,
    requirement_id: jobId,
    match_job_id: p.match_job_id,
    result_count: p.result_count,
  });
  return { result: `shortlist notify ${jobId}: ${r.status ?? 'ok'}` };
};

/** approval.decided → merge or keep candidates in Syntra. */
export const syntraDuplicateMerge: NodeImpl = async (state, ctx) => {
  const trigger = state.trigger_event;
  const p = payload(state);
  const approvalId = p.approval_id ?? p.approvalId;
  if (!approvalId || !trigger) {
    throw new Error('syntra.duplicate.merge: no approval_id in payload');
  }

  ctx.logger.info('calling Syntra duplicate merge', {
    approvalId,
    orgId: ctx.orgId,
  });
  const r = await postSyntra(`/internal/approvals/${approvalId}/duplicate-merge`, {
    approval_id: approvalId,
    decision: p.decision,
    candidate_a: p.candidate_a,
    candidate_b: p.candidate_b,
  });
  return { result: `duplicate merge ${approvalId}: ${r.status ?? 'ok'}` };
};

/** agent_run.failed → ask Syntra to retry the failed run. */
export const syntraRunRetry: NodeImpl = async (state, ctx) => {
  const trigger = state.trigger_event;
  const p = payload(state);
  const agentRunId = p.agent_run_id ?? p.agentRunId;
  if (!agentRunId || !trigger) {
    throw new Error('syntra.run.retry: no agent_run_id in payload');
  }

  ctx.logger.info('calling Syntra run retry', { agentRunId, orgId: ctx.orgId });
  const r = await postSyntra(`/internal/agent-runs/${agentRunId}/retry`, {
    agent_run_id: agentRunId,
    error_code: p.error_code,
    failed_node: p.failed_node,
  });
  return { result: `run retry ${agentRunId}: ${r.status ?? 'ok'}` };
};
