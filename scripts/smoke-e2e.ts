/**
 * End-to-end smoke: POST platform events → wait → print worker-visible trace.
 *
 * Prerequisites:
 *   Terminal 1: npm start                 (worker)
 *   Terminal 2: npm run start -w @tekisho/api
 *   Optional:   ORCH_STUB_SYNTRA=1         (JD/match without Syntra :4000)
 *
 * Usage:
 *   npm run smoke:e2e
 *   npm run smoke:e2e -- --jd --match
 */
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import pg from 'pg';

loadEnv({ path: resolve(process.cwd(), '.env') });
loadEnv({ path: resolve(process.cwd(), '../../.env') });

const API = process.env.ORCH_API_URL ?? 'http://localhost:4100';
const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
if (!databaseUrl) {
  console.error('DATABASE_MIGRATOR_URL required');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const wantJd = args.has('--jd') || args.has('--all');
const wantMatch = args.has('--match') || args.has('--all');
const wantResume = !args.has('--jd-only') && !args.has('--match-only');

async function resolveOrgId(pool: pg.Pool): Promise<string> {
  if (process.env.SMOKE_ORG_ID) return process.env.SMOKE_ORG_ID;

  // Prefer a tenant already seen in the outbox (migrator may lack SELECT on organizations).
  try {
    const fromOutbox = await pool.query<{ id: string }>(
      `SELECT organization_id::text AS id
       FROM orch.event_outbox
       WHERE organization_id IS NOT NULL
       ORDER BY occurred_at DESC NULLS LAST
       LIMIT 1`,
    );
    if (fromOutbox.rows[0]?.id) return fromOutbox.rows[0].id;
  } catch {
    /* fall through */
  }

  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id::text AS id FROM organizations ORDER BY created_at NULLS LAST LIMIT 1`,
    );
    if (rows[0]?.id) return rows[0].id;
  } catch {
    /* fall through */
  }

  // Known demo tenant used in FRONT_DOOR examples for this shared Supabase project.
  return '2b8e12b3-1745-4ae9-902c-5a249c28ba94';
}

function envelope(args: {
  eventType: string;
  orgId: string;
  correlationId: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}) {
  return {
    event_id: randomUUID(),
    event_type: args.eventType,
    schema_version: '1.0',
    occurred_at: new Date().toISOString(),
    correlation_id: args.correlationId,
    causation_id: null,
    organization_id: args.orgId,
    aggregate: { type: args.aggregateType, id: args.aggregateId },
    payload_ref: args.payload,
    producer: 'smoke-e2e',
  };
}

async function postEvent(body: Record<string, unknown>) {
  const res = await fetch(`${API}/v1/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`POST /v1/events ${res.status}: ${text}`);
  }
  return json as { event_id: string; status: string; trace?: string };
}

async function waitTrace(
  eventId: string,
  opts: { minOutbox?: number; timeoutMs?: number } = {},
) {
  const minOutbox = opts.minOutbox ?? 2; // trigger + at least one follow-on
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const started = Date.now();
  let last: any = null;
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${API}/v1/trace/${eventId}`);
    last = await res.json();
    const runsDone =
      Array.isArray(last.runs) &&
      last.runs.some(
        (r: any) =>
          r.status === 'COMPLETED' ||
          r.status === 'FAILED' ||
          r.status === 'WAITING_APPROVAL',
      );
    const hasFollowOn =
      Array.isArray(last.outbox) &&
      last.outbox.some((e: any) => e.event_id !== eventId);
    // Prefer terminal run + follow-on; never return mid-flight on first step alone.
    if (runsDone && (hasFollowOn || (last.outbox_count ?? 0) >= minOutbox)) {
      return last;
    }
    if (runsDone && (last.steps_count ?? 0) > 0 && Date.now() - started > 8_000) {
      // Graph finished; follow-on may be delayed by outbox write — accept after brief wait.
      return last;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return last;
}

function printTrace(label: string, trace: any) {
  console.log(`\n=== ${label} ===`);
  console.log(
    `outbox=${trace?.outbox_count ?? 0} runs=${trace?.runs_count ?? 0} steps=${trace?.steps_count ?? 0}`,
  );
  if (Array.isArray(trace?.warnings) && trace.warnings.length) {
    for (const w of trace.warnings) console.warn(`  ! ${w}`);
  }
  for (const row of trace?.outbox ?? []) {
    console.log(
      `  [outbox] ${row.event_type}  event_id=${row.event_id}  producer=${row.producer}`,
    );
  }
  for (const run of trace?.runs ?? []) {
    console.log(
      `  [run] ${run.status}  id=${run.id}  source=${run.source ?? '?'}` +
        (run.graph_key ? ` graph=${run.graph_key}` : ''),
    );
  }
  for (const step of trace?.steps ?? []) {
    console.log(
      `  [step] #${step.seq} ${step.node} (${step.tool_name}) ${step.status}` +
        (step.latency_ms != null ? ` ${step.latency_ms}ms` : ''),
    );
  }
}

async function main() {
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(
      `API not reachable at ${API}. Start: npm run start -w @tekisho/api`,
    );
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  try {
    const orgId = await resolveOrgId(pool);
    const correlationId = randomUUID();
    console.log(`Smoke org=${orgId}`);
    console.log(`correlation_id=${correlationId}`);
    console.log(`API=${API}`);

    if (wantResume) {
      const body = envelope({
        eventType: 'syntra.resume.received',
        orgId,
        correlationId,
        aggregateType: 'candidate',
        aggregateId: randomUUID(),
        payload: {
          candidate_id: randomUUID(),
          document_id: randomUUID(),
          rawText:
            'Senior TypeScript / Node engineer with 8 years React, AWS, Postgres, Docker.',
          skills: ['typescript', 'node', 'react'],
          requiredSkills: ['typescript', 'node', 'aws'],
          source: 'AGENT',
        },
      });
      console.log(`\nPOST syntra.resume.received event_id=${body.event_id}`);
      const accepted = await postEvent(body);
      console.log('accepted:', accepted);
      const trace = await waitTrace(accepted.event_id, { minOutbox: 1 });
      printTrace('resume.intake', trace);
      if (!trace?.outbox?.length) {
        console.error(
          'FAIL: no outbox rows — is the worker running (npm start)?',
        );
        process.exitCode = 1;
      }
    }

    if (wantJd) {
      const jobId = randomUUID();
      const body = envelope({
        eventType: 'syntra.jd.received',
        orgId,
        correlationId,
        aggregateType: 'requirement',
        aggregateId: jobId,
        payload: { jobId, requirement_id: jobId, title: 'Smoke JD' },
      });
      console.log(`\nPOST syntra.jd.received event_id=${body.event_id}`);
      const accepted = await postEvent(body);
      console.log('accepted:', accepted);
      const trace = await waitTrace(accepted.event_id, { minOutbox: 1 });
      printTrace('syntra.jd.workflow', trace);
    }

    if (wantMatch) {
      const jobId = randomUUID();
      const resumeId = randomUUID();
      const body = envelope({
        eventType: 'syntra.match.requested',
        orgId,
        correlationId,
        aggregateType: 'match',
        aggregateId: randomUUID(),
        payload: { jobId, resumeId, candidateId: randomUUID() },
      });
      console.log(`\nPOST syntra.match.requested event_id=${body.event_id}`);
      try {
        const accepted = await postEvent(body);
        console.log('accepted:', accepted);
        const trace = await waitTrace(accepted.event_id, { minOutbox: 1 });
        printTrace('syntra.match.workflow', trace);
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (msg.includes('event_outbox_event_type_schema_version_fkey')) {
          console.warn(
            'SKIP match: syntra.match.requested missing from event_schemas. ' +
              'Run Flyway R__seed_event_schemas.sql as postgres, then retry --match.',
          );
        } else {
          throw err;
        }
      }
    }

    console.log(
      '\nDone. Watch the worker terminal for [Router] / [Module] / [agent_runs] / orch.* metrics.',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
