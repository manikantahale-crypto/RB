/**
 * The chain, assembled from rows: event → run → announced event → run,
 * with fan-out attributed by what the steps recorded, and secrets blanked.
 */
import { describe, expect, it } from 'vitest';
import { buildFlow, sanitizeTraceValue, type OutboxRow, type RunRow, type StepRow } from './trace.js';

const ev = (over: Partial<OutboxRow> & { event_id: string; event_type: string }): OutboxRow => ({
  organization_id: 'org',
  aggregate_type: 'requirement',
  aggregate_id: 'req-1',
  correlation_id: 'corr',
  causation_id: null,
  producer: 'api',
  payload_ref: {},
  occurred_at: '2026-09-19T10:00:00Z',
  published_at: '2026-09-19T10:00:01Z',
  ...over,
});
const run = (over: Partial<RunRow> & { id: string; graph_key: string }): RunRow => ({
  graph_version: 1,
  status: 'COMPLETED',
  trigger_event_id: null,
  langgraph_thread_id: null,
  started_at: null,
  completed_at: null,
  heartbeat_at: null,
  error: null,
  ...over,
});
const step = (over: Partial<StepRow> & { run_id: string; node: string }): StepRow => ({
  seq: 1,
  tool_name: null,
  status: 'OK',
  latency_ms: 10,
  output_ref: {},
  created_at: null,
  ...over,
});

describe('sanitizeTraceValue', () => {
  it('blanks secret-looking keys at any depth and leaves the rest', () => {
    expect(
      sanitizeTraceValue({
        jobId: '1',
        api_key: 'sk-live',
        nested: { Authorization: 'Bearer x', list: [{ password: 'p', ok: 1 }] },
      }),
    ).toEqual({
      jobId: '1',
      api_key: '[redacted]',
      nested: { Authorization: '[redacted]', list: [{ password: '[redacted]', ok: 1 }] },
    });
    expect(sanitizeTraceValue(null)).toBeNull();
    expect(sanitizeTraceValue('a string')).toBe('a string');
  });
});

describe('buildFlow — the chain', () => {
  it('links an event to the run it started and a run to the events it announced', () => {
    const flow = buildFlow({
      correlationId: 'corr',
      limit: 100,
      events: [
        ev({ event_id: 'e1', event_type: 'syntra.jd.received' }),
        ev({ event_id: 'e2', event_type: 'syntra.jd.parsed', causation_id: 'e1', producer: 'orchestrator' }),
        ev({ event_id: 'e3', event_type: 'syntra.match.completed', causation_id: 'e2', producer: 'orchestrator', published_at: null }),
      ],
      runs: [
        run({ id: 'r1', graph_key: 'syntra.jd.workflow', trigger_event_id: 'e1' }),
        run({ id: 'r2', graph_key: 'syntra.match.workflow', trigger_event_id: 'e2', status: 'WAITING_APPROVAL' }),
      ],
      steps: [step({ run_id: 'r1', node: 'process', output_ref: { emitted: ['syntra.jd.parsed'] } })],
    });

    expect(flow.rootEventId).toBe('e1');
    expect(flow.events[0]!.startedRuns).toEqual(['r1']);
    expect(flow.events[1]!.announcedByRun).toBe('r1');
    expect(flow.events[1]!.startedRuns).toEqual(['r2']);
    expect(flow.events[2]!.announcedByRun).toBe('r2');
    expect(flow.events[2]!.published).toBe(false);
    expect(flow.runs[0]!.announced).toEqual(['e2']);
    expect(flow.runs[0]!.steps[0]!.emitted).toEqual(['syntra.jd.parsed']);
    // the old word is normalised for the screen, and the run is marked parked
    expect(flow.runs[1]!.status).toBe('PARKED');
    expect(flow.runs[1]!.parked).toBe(true);
    expect(flow.warnings).toEqual([]);
    expect(flow.truncated).toBe(false);
  });

  it('attributes a fan-out announcement by what the steps recorded, or says it cannot', () => {
    const events = [
      ev({ event_id: 'e1', event_type: 'syntra.jd.received' }),
      ev({ event_id: 'e2', event_type: 'orbit.bench.hold', causation_id: 'e1', producer: 'orchestrator' }),
      ev({ event_id: 'e3', event_type: 'mystery.event', causation_id: 'e1', producer: 'orchestrator' }),
    ];
    const runs = [
      run({ id: 'rA', graph_key: 'syntra.jd.workflow', trigger_event_id: 'e1' }),
      run({ id: 'rB', graph_key: 'orbit.lifecycle.workflow', trigger_event_id: 'e1' }),
    ];
    const flow = buildFlow({
      correlationId: 'corr',
      limit: 100,
      events,
      runs,
      steps: [step({ run_id: 'rB', node: 'hold', output_ref: { emitted: ['orbit.bench.hold'] } })],
    });
    expect(flow.events[1]!.announcedByRun).toBe('rB');
    expect(flow.events[2]!.announcedByRun).toBeNull();
    expect(flow.warnings.some((w) => w.includes('mystery.event'))).toBe(true);
  });

  it('says when the window is full and when a run was started outside it', () => {
    const flow = buildFlow({
      correlationId: 'corr',
      limit: 1,
      events: [ev({ event_id: 'e9', event_type: 'x', causation_id: 'e8' })],
      runs: [run({ id: 'r', graph_key: 'g', trigger_event_id: 'e0' })],
      steps: [],
    });
    expect(flow.truncated).toBe(true);
    expect(flow.warnings[0]).toMatch(/first 1 events/);
    expect(flow.warnings[1]).toMatch(/outside this window/);
    // an event whose cause is not in the window is treated as the root shown
    expect(flow.rootEventId).toBe('e9');
  });

  it('blanks secrets in payloads, errors and step outputs', () => {
    const flow = buildFlow({
      correlationId: 'corr',
      limit: 100,
      events: [ev({ event_id: 'e1', event_type: 'x', payload_ref: { token: 't', jobId: 'j' } })],
      runs: [run({ id: 'r', graph_key: 'g', trigger_event_id: 'e1', error: { message: 'm', api_key: 'k' } })],
      steps: [step({ run_id: 'r', node: 'n', output_ref: { secret: 's', result: 'ok' } })],
    });
    expect(flow.events[0]!.payload).toEqual({ token: '[redacted]', jobId: 'j' });
    expect(flow.runs[0]!.error).toEqual({ message: 'm', api_key: '[redacted]' });
    expect(flow.runs[0]!.steps[0]!.output).toEqual({ secret: '[redacted]', result: 'ok' });
  });
});
