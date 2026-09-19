/**
 * The whole flow, by correlation: every event, every run it started, every
 * event those runs announced — in order, linked, with secrets blanked.
 *
 * WHAT EXISTED. `loadTraceByEventId` (agent-runs.ts) answers for ONE event:
 * the outbox rows around it and the runs that event started. Ask it about a
 * requirement that arrived, was parsed, matched, shortlisted and sent for
 * consent, and it shows the first hop. The rest of the story is four more
 * lookups a person has to know to make.
 *
 * WHAT THIS ADDS. One read by `correlation_id` — stamped on the first event
 * and carried onto everything it causes — assembled into a chain:
 *
 *   event ─started→ run ─announced→ event ─started→ run …
 *
 * Linking is by what the rows already record: a run's `trigger_event_id`
 * says which event started it; an announced event's `causation_id` is the
 * trigger of the run that announced it (runner.ts persistEvents). Where two
 * runs share a trigger (fan-out) and both could have announced an event,
 * the run whose steps recorded that event type wins; otherwise the link is
 * left open and said so.
 *
 * WHAT IT DOES NOT SHOW. Which binding routed each event. The bindings
 * table says what routes NOW, not what routed THEN, and a trace that
 * presents the present as the past is worse than one with a gap. The run's
 * `graph_key@graph_version` is what actually ran, and that is recorded.
 *
 * WHAT IT NEVER SHOWS. Anything under a key that looks like a secret —
 * password, token, api_key, authorization, credential, bearer, private_key,
 * access_key — in a payload, an error, or a step's output. Blanked before
 * it leaves this function, so no screen has to remember to.
 *
 * Pure assembly (`buildFlow`) over plain rows, so it is tested without a
 * database; `loadFlowByCorrelation` is the three reads that feed it.
 */
import type { Pool } from 'pg';
import { isParked, normalizeRunStatus } from './run-status.js';

/* ────────────────────────────── redaction ───────────────────────────── */

const SENSITIVE_KEY =
  /password|secret|token|api[_-]?key|authorization|credential|bearer|private[_-]?key|access[_-]?key/i;

/** The same value with every secret-looking key blanked, at any depth. */
export function sanitizeTraceValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeTraceValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : sanitizeTraceValue(v, depth + 1);
  }
  return out;
}

/* ─────────────────────────────── shapes ─────────────────────────────── */

export type OutboxRow = {
  event_id: string;
  event_type: string;
  organization_id: string;
  aggregate_type: string | null;
  aggregate_id: string | null;
  correlation_id: string | null;
  causation_id: string | null;
  producer: string | null;
  payload_ref: unknown;
  occurred_at: string | null;
  published_at: string | null;
};

export type RunRow = {
  id: string;
  graph_key: string;
  graph_version: number | null;
  status: string;
  trigger_event_id: string | null;
  langgraph_thread_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  heartbeat_at: string | null;
  error: unknown;
};

export type StepRow = {
  run_id: string;
  seq: number;
  node: string;
  tool_name: string | null;
  status: string;
  latency_ms: number | null;
  output_ref: unknown;
  created_at: string | null;
};

export type FlowEvent = {
  eventId: string;
  eventType: string;
  occurredAt: string | null;
  publishedAt: string | null;
  published: boolean;
  producer: string | null;
  aggregate: { type: string | null; id: string | null };
  causationId: string | null;
  payload: unknown;
  /** Runs this event started (fan-out gives more than one). */
  startedRuns: string[];
  /** The run that announced this event, when it can be told. */
  announcedByRun: string | null;
};

export type FlowStep = {
  seq: number;
  node: string;
  tool: string | null;
  status: string;
  latencyMs: number | null;
  at: string | null;
  emitted: string[];
  output: unknown;
};

export type FlowRun = {
  id: string;
  graphKey: string;
  graphVersion: number | null;
  status: string;
  parked: boolean;
  triggerEventId: string | null;
  threadId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  heartbeatAt: string | null;
  error: unknown;
  /** Events this run announced, in outbox order. */
  announced: string[];
  steps: FlowStep[];
};

export type Flow = {
  correlationId: string;
  events: FlowEvent[];
  runs: FlowRun[];
  /** The first event of the chain, if it is in the window. */
  rootEventId: string | null;
  /** Links the rows did not settle, said plainly. */
  warnings: string[];
  truncated: boolean;
};

/* ─────────────────────────────── assembly ───────────────────────────── */

function emittedTypesOf(output: unknown): string[] {
  const list = (output as { emitted?: unknown } | null)?.emitted;
  return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string') : [];
}

export function buildFlow(args: {
  correlationId: string;
  events: OutboxRow[];
  runs: RunRow[];
  steps: StepRow[];
  limit: number;
}): Flow {
  const warnings: string[] = [];
  const truncated = args.events.length >= args.limit;
  if (truncated) {
    warnings.push(`only the first ${args.limit} events are shown`);
  }

  const stepsByRun = new Map<string, FlowStep[]>();
  for (const s of args.steps) {
    const list = stepsByRun.get(s.run_id) ?? [];
    list.push({
      seq: s.seq,
      node: s.node,
      tool: s.tool_name,
      status: s.status,
      latencyMs: s.latency_ms,
      at: s.created_at,
      emitted: emittedTypesOf(s.output_ref),
      output: sanitizeTraceValue(s.output_ref),
    });
    stepsByRun.set(s.run_id, list);
  }
  for (const list of stepsByRun.values()) list.sort((a, b) => a.seq - b.seq);

  const runs: FlowRun[] = args.runs.map((r) => ({
    id: r.id,
    graphKey: r.graph_key,
    graphVersion: r.graph_version,
    status: normalizeRunStatus(r.status) ?? r.status,
    parked: isParked(r.status),
    triggerEventId: r.trigger_event_id,
    threadId: r.langgraph_thread_id,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    heartbeatAt: r.heartbeat_at,
    error: sanitizeTraceValue(r.error),
    announced: [],
    steps: stepsByRun.get(r.id) ?? [],
  }));
  const runsByTrigger = new Map<string, FlowRun[]>();
  for (const run of runs) {
    if (!run.triggerEventId) continue;
    const list = runsByTrigger.get(run.triggerEventId) ?? [];
    list.push(run);
    runsByTrigger.set(run.triggerEventId, list);
  }

  const events: FlowEvent[] = args.events.map((e) => {
    const started = (runsByTrigger.get(e.event_id) ?? []).map((r) => r.id);

    // Who announced it: the run(s) whose trigger is this event's causation.
    let announcedBy: string | null = null;
    if (e.causation_id && e.producer === 'orchestrator') {
      const candidates = runsByTrigger.get(e.causation_id) ?? [];
      if (candidates.length === 1) {
        announcedBy = candidates[0]!.id;
      } else if (candidates.length > 1) {
        // Fan-out: the run whose steps recorded this event type.
        const recorded = candidates.filter((r) =>
          r.steps.some((s) => s.emitted.includes(e.event_type)),
        );
        if (recorded.length === 1) announcedBy = recorded[0]!.id;
        else {
          warnings.push(
            `${e.event_type} (${e.event_id}) could have been announced by ${candidates.length} runs of the same trigger — not attributed`,
          );
        }
      }
    }
    if (announcedBy) {
      runs.find((r) => r.id === announcedBy)!.announced.push(e.event_id);
    }

    return {
      eventId: e.event_id,
      eventType: e.event_type,
      occurredAt: e.occurred_at,
      publishedAt: e.published_at,
      published: e.published_at != null,
      producer: e.producer,
      aggregate: { type: e.aggregate_type, id: e.aggregate_id },
      causationId: e.causation_id,
      payload: sanitizeTraceValue(e.payload_ref),
      startedRuns: started,
      announcedByRun: announcedBy,
    };
  });

  const known = new Set(events.map((e) => e.eventId));
  for (const run of runs) {
    if (run.triggerEventId && !known.has(run.triggerEventId)) {
      warnings.push(
        `run ${run.id} (${run.graphKey}) was started by an event outside this window`,
      );
    }
  }

  const root = events.find((e) => !e.causationId || !known.has(e.causationId)) ?? null;

  return {
    correlationId: args.correlationId,
    events,
    runs,
    rootEventId: root?.eventId ?? null,
    warnings,
    truncated,
  };
}

/* ──────────────────────────────── reads ─────────────────────────────── */

export const FLOW_EVENT_LIMIT = 100;

export async function loadFlowByCorrelation(
  pool: Pool,
  correlationId: string,
  opts: { limit?: number } = {},
): Promise<Flow> {
  const limit = opts.limit ?? FLOW_EVENT_LIMIT;

  const { rows: events } = await pool.query<OutboxRow>(
    `SELECT event_id::text AS event_id, event_type, organization_id::text AS organization_id,
            aggregate_type, aggregate_id::text AS aggregate_id,
            correlation_id::text AS correlation_id, causation_id::text AS causation_id,
            producer, payload_ref, occurred_at::text AS occurred_at, published_at::text AS published_at
       FROM orch.event_outbox
      WHERE correlation_id::text = $1
      ORDER BY occurred_at ASC NULLS LAST, id ASC
      LIMIT $2`,
    [correlationId, limit],
  );

  const eventIds = events.map((e) => e.event_id);
  const { rows: runs } = await pool.query<RunRow>(
    `SELECT id::text AS id, graph_key, graph_version, status,
            trigger_event_id::text AS trigger_event_id, langgraph_thread_id,
            started_at::text AS started_at, completed_at::text AS completed_at,
            heartbeat_at::text AS heartbeat_at, error
       FROM orch.runs
      WHERE trigger_event_id::text = ANY($1::text[])
         OR input_ref->>'correlation_id' = $2
      ORDER BY started_at ASC NULLS LAST, created_at ASC`,
    [eventIds, correlationId],
  );

  const runIds = runs.map((r) => r.id);
  const { rows: steps } =
    runIds.length === 0
      ? { rows: [] as StepRow[] }
      : await pool.query<StepRow>(
          `SELECT run_id::text AS run_id, seq, node, tool_name, status, latency_ms,
                  output_ref, created_at::text AS created_at
             FROM orch.steps
            WHERE run_id = ANY($1::uuid[])
            ORDER BY run_id, seq`,
          [runIds],
        );

  return buildFlow({ correlationId, events, runs, steps, limit });
}

/** The correlation a run belongs to, from its trigger event or its own record. */
export async function correlationOfRun(pool: Pool, runId: string): Promise<string | null> {
  const { rows } = await pool.query<{ correlation_id: string | null }>(
    `SELECT COALESCE(e.correlation_id::text, r.input_ref->>'correlation_id') AS correlation_id
       FROM orch.runs r
       LEFT JOIN orch.event_outbox e ON e.event_id = r.trigger_event_id
      WHERE r.id = $1::uuid
      LIMIT 1`,
    [runId],
  );
  return rows[0]?.correlation_id ?? null;
}
