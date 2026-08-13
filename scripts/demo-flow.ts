/**
 * Demo: post JD / resume / match platform events and print traces.
 * Requires: npm start (worker) + npm run start -w @tekisho/api
 *
 *   npm run demo:flow
 *   npm run demo:flow -- --resume-only
 */
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '.env') });

const API = process.env.ORCH_API_URL ?? 'http://localhost:4100';
const ORG =
  process.env.SMOKE_ORG_ID ?? '2b8e12b3-1745-4ae9-902c-5a249c28ba94';

const args = new Set(process.argv.slice(2));
const resumeOnly = args.has('--resume-only');

function envelope(
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
  correlationId: string,
) {
  return {
    event_id: randomUUID(),
    event_type: eventType,
    schema_version: '1.0',
    occurred_at: new Date().toISOString(),
    correlation_id: correlationId,
    causation_id: null,
    organization_id: ORG,
    aggregate: { type: aggregateType, id: aggregateId },
    payload_ref: payload,
    producer: 'demo-flow',
  };
}

async function post(body: Record<string, unknown>) {
  const res = await fetch(`${API}/v1/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json as { event_id: string };
}

async function waitTrace(eventId: string) {
  const deadline = Date.now() + 90_000;
  let last: any;
  while (Date.now() < deadline) {
    const res = await fetch(`${API}/v1/trace/${eventId}`);
    last = await res.json();
    const myRuns = (last.runs ?? []).filter(
      (r: any) => String(r.trigger_event_id) === eventId || r.source === 'orch.runs',
    );
    // Prefer orch.runs tied to this trigger
    const orchDone = (last.runs ?? []).some(
      (r: any) =>
        r.source === 'orch.runs' &&
        String(r.trigger_event_id) === eventId &&
        (r.status === 'COMPLETED' ||
          r.status === 'FAILED' ||
          r.status === 'WAITING_APPROVAL'),
    );
    const caused = (last.outbox ?? []).some(
      (e: any) =>
        e.event_id !== eventId &&
        String(e.causation_id ?? '') === eventId,
    );
    if (orchDone || (caused && myRuns.length > 0)) return last;
    if (orchDone) return last;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return last;
}

function print(label: string, eventId: string, trace: any) {
  console.log(`\n======== ${label} (${eventId}) ========`);
  for (const row of trace?.outbox ?? []) {
    console.log(`  outbox  ${row.event_type}  producer=${row.producer}`);
  }
  for (const run of trace?.runs ?? []) {
    console.log(
      `  run     ${run.status}  ${run.graph_key ?? ''}  source=${run.source ?? '?'}`,
    );
  }
  for (const step of trace?.steps ?? []) {
    console.log(
      `  step    #${step.seq} ${step.node} ${step.status}` +
        (step.latency_ms != null ? ` ${step.latency_ms}ms` : ''),
    );
  }
}

async function main() {
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`API down at ${API}. Start: npm run start -w @tekisho/api`);
    process.exit(1);
  }

  const corr = randomUUID();
  console.log(`demo-flow API=${API} org=${ORG} corr=${corr}`);
  console.log('Watch the WORKER terminal for [Ingress]/[Relay]/[Router]/[Module]');

  if (!resumeOnly) {
    const jobId = randomUUID();
    const jd = envelope(
      'syntra.jd.received',
      'requirement',
      jobId,
      { jobId, requirement_id: jobId, title: 'Demo JD — marketing manager' },
      corr,
    );
    console.log(`\n>> POST syntra.jd.received jobId=${jobId}`);
    const a = await post(jd);
    print('JD', a.event_id, await waitTrace(a.event_id));
  }

  {
    const cand = randomUUID();
    const doc = randomUUID();
    const resume = envelope(
      'syntra.resume.received',
      'candidate',
      cand,
      {
        candidate_id: cand,
        document_id: doc,
        rawText:
          'Marketing manager with 5 years B2B demand generation, HubSpot, SQL, paid media.',
        skills: ['sql', 'marketing'],
        source: 'AGENT',
      },
      corr,
    );
    console.log(`\n>> POST syntra.resume.received candidate=${cand}`);
    const a = await post(resume);
    print('RESUME', a.event_id, await waitTrace(a.event_id));
  }

  if (!resumeOnly) {
    const jobId = randomUUID();
    const resumeId = randomUUID();
    const match = envelope(
      'syntra.match.requested',
      'match',
      randomUUID(),
      { jobId, resumeId, candidateId: randomUUID(), skillMatchScore: 0.5 },
      corr,
    );
    console.log(`\n>> POST syntra.match.requested`);
    try {
      const a = await post(match);
      print('MATCH', a.event_id, await waitTrace(a.event_id));
    } catch (err: any) {
      console.warn(
        'MATCH skipped/failed (often missing event_schemas grant):',
        err.message,
      );
    }
  }

  console.log('\nDone. Worker logs should show Relay → Router → Module for each.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
