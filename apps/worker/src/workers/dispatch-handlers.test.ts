/**
 * A decision that does not name its thread.
 *
 * The dispatcher used to acknowledge — drop — any resume event without
 * `thread_id` and `graph_key` on it. A candidate's reply through RELAY and a
 * recruiter's click both know the conversation, not the LangGraph thread, so
 * the parked run is now looked up by correlation and the resume enqueued
 * with what was found.
 */
import { describe, expect, it } from 'vitest';
import { handlePlatformDispatchEvent } from './dispatch-handlers.js';

type Sent = { queue: string; job: Record<string, unknown> };

function boss(sent: Sent[]) {
  return {
    createQueue: async () => {},
    send: async (queue: string, job: Record<string, unknown>) => {
      sent.push({ queue, job });
      return 'job-id';
    },
  } as never;
}

/** A pool whose one query answers the parked-run lookup. */
function pool(parked: Record<string, unknown> | null) {
  return {
    query: async (text: string) => ({
      rows: /status = 'PARKED'/.test(text) && parked ? [parked] : [],
    }),
  } as never;
}

const decided = (payload: Record<string, unknown>) =>
  ({
    event_id: 'evt-decided',
    event_type: 'syntra.approval.decided',
    organization_id: '00000000-0000-0000-0000-000000000001',
    correlation_id: 'corr-1',
    payload_ref: payload,
  }) as never;

describe('a resume event without a thread id', () => {
  it('finds the parked run by correlation and resumes it', async () => {
    const sent: Sent[] = [];
    const outcome = await handlePlatformDispatchEvent({
      boss: boss(sent),
      pool: pool({
        id: 'run-9',
        graph_key: 'duplicate.review',
        graph_version: 2,
        langgraph_thread_id: '00000000-0000-0000-0000-000000000001:evt-1',
        organization_id: '00000000-0000-0000-0000-000000000001',
      }),
      envelope: decided({ decision: { approved: true } }),
    });
    expect(outcome).toBe('enqueued_resume');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.job).toMatchObject({
      thread_id: '00000000-0000-0000-0000-000000000001:evt-1',
      graph_key: 'duplicate.review',
      graph_version: 2,
      decision: { approved: true },
    });
  });

  it('is acknowledged, and says why, when no run is parked for that correlation', async () => {
    const sent: Sent[] = [];
    const outcome = await handlePlatformDispatchEvent({
      boss: boss(sent),
      pool: pool(null),
      envelope: decided({ decision: 'approved' }),
    });
    expect(outcome).toBe('acked');
    expect(sent).toHaveLength(0);
  });

  it('a decision that names its thread is resumed as before, without a lookup', async () => {
    const sent: Sent[] = [];
    let queried = 0;
    const p = { query: async () => { queried += 1; return { rows: [] }; } } as never;
    const outcome = await handlePlatformDispatchEvent({
      boss: boss(sent),
      pool: p,
      envelope: decided({ thread_id: 'org:evt-7', graph_key: 'duplicate.review', decision: 'rejected' }),
    });
    expect(outcome).toBe('enqueued_resume');
    expect(queried).toBe(0);
    expect(sent[0]!.job).toMatchObject({ thread_id: 'org:evt-7', graph_key: 'duplicate.review' });
  });
});
