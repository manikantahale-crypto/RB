import { v4 as uuidv4 } from 'uuid';
import { EVENT_TYPES } from '@tekisho/domain';
import type { EventInput } from '../types.js';
import type { NodeImpl, SyntraGraphState } from './types.js';

const SYNTRA_BASE = process.env.SYNTRA_API_URL || 'http://localhost:4000';

async function postSyntra(path: string, body?: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await fetch(`${SYNTRA_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Syntra ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as Record<string, any>;
}

function completionEvent(
  trigger: EventInput,
  eventType: string,
  payload: Record<string, unknown>
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
export const syntraJdProcess: NodeImpl = async (state) => {
  const trigger = state.trigger_event;
  const jobId = trigger?.payload?.jobId;
  if (!jobId || !trigger) throw new Error('syntra.jd.process: no jobId in payload');

  const r = await postSyntra(`/internal/jobs/${jobId}/process`);
  return {
    result: `job ${jobId}: ${r.status ?? 'ok'}`,
    _emittedEvents: [
      completionEvent(trigger, EVENT_TYPES.JD_PARSED, {
        jobId,
        status: r.status,
        syntra: r,
      }),
    ],
  };
};

/** Summarize resume + profile via Syntra. */
export const syntraResumeProcess: NodeImpl = async (state) => {
  const trigger = state.trigger_event;
  const resumeId = trigger?.payload?.resumeId;
  const candidateId = trigger?.payload?.candidateId;
  if (!resumeId || !trigger) throw new Error('syntra.resume.process: no resumeId in payload');

  const r = await postSyntra(`/internal/resumes/${resumeId}/process`, { candidateId });
  return {
    result: `resume ${resumeId}: ${r.status ?? 'ok'}`,
    _emittedEvents: [
      completionEvent(trigger, EVENT_TYPES.PROFILE_PREPARED, {
        resumeId,
        candidateId,
        status: r.status,
        syntra: r,
      }),
    ],
  };
};

/**
 * Score job × resume via Syntra.
 * Prefer Syntra response score; fall back to inbound skillMatchScore from the queue payload.
 */
export const syntraMatchProcess: NodeImpl = async (state: SyntraGraphState) => {
  const trigger = state.trigger_event;
  const jobId = trigger?.payload?.jobId;
  const resumeId = trigger?.payload?.resumeId;
  if (!jobId || !resumeId || !trigger) {
    throw new Error('syntra.match.process: need jobId and resumeId');
  }

  const r = await postSyntra(`/internal/matches/process`, { jobId, resumeId });
  const skillMatchScore =
    r.skillMatchScore ?? r.score ?? r.matchScore ?? trigger.payload?.skillMatchScore ?? null;

  return {
    result: `match ${jobId}/${resumeId}: ${r.status ?? 'ok'} (score=${skillMatchScore})`,
    _emittedEvents: [
      completionEvent(trigger, EVENT_TYPES.MATCH_COMPLETED, {
        jobId,
        resumeId,
        candidateId: trigger.payload?.candidateId,
        skillMatchScore,
        result_count: 1,
        top_score: skillMatchScore,
        status: r.status,
        syntra: r,
      }),
    ],
  };
};
