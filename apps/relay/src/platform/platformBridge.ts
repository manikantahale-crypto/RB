import { v4 as uuidv4 } from 'uuid';
import { internalHeaders } from './internalSecret';
import { buildToolResult } from './toolEnvelope';
import { isPlatformUuid, relayThreadCorrelationId } from './relayIds';

const ORCH_BASE = process.env.ORCH_API_URL || `http://127.0.0.1:${process.env.API_PORT || '4100'}`;
const ORG_ID =
  process.env.ORCH_ORGANIZATION_ID ||
  process.env.ORGANIZATION_ID ||
  '00000000-0000-0000-0000-000000000001';

export type PlatformEventInput = {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  causationId?: string | null;
};

function bridgeEnabled(): boolean {
  return (
    process.env.RELAY_PLATFORM_EVENTS === '1' ||
    process.env.RELAY_PLATFORM_EVENTS === 'true' ||
    process.env.PLATFORM_EVENTS_ENABLED === '1' ||
    process.env.PLATFORM_EVENTS_ENABLED === 'true'
  );
}

/** Publish a platform event to orchestration ingress (POST /v1/events). */
export async function publishPlatformEvent(input: PlatformEventInput): Promise<string | null> {
  if (!bridgeEnabled()) {
    console.log(`[relay/platform] skipped (RELAY_PLATFORM_EVENTS=0) ${input.eventType}`);
    return null;
  }

  const eventId = uuidv4();
  const correlationId =
    input.correlationId && isPlatformUuid(input.correlationId)
      ? input.correlationId
      : eventId;
  const aggregateId =
    input.aggregateId && isPlatformUuid(input.aggregateId)
      ? input.aggregateId
      : correlationId;

  const envelope = {
    event_id: eventId,
    event_type: input.eventType,
    schema_version: '1.0',
    occurred_at: new Date().toISOString(),
    correlation_id: correlationId,
    causation_id: input.causationId ?? null,
    organization_id: ORG_ID,
    aggregate: { type: input.aggregateType, id: aggregateId },
    payload_ref: input.payload,
    producer: 'relay.smart-inbox',
  };

  try {
    const res = await fetch(`${ORCH_BASE}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${res.status} ${text.slice(0, 300)}`);
    }
    console.log(
      `[relay/platform] EMIT ${input.eventType} aggregate=${input.aggregateType}:${input.aggregateId} correlation=${correlationId}`,
    );
    return eventId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isFetchFailed = msg.includes('fetch failed') || msg.includes('ECONNREFUSED');
    if (isFetchFailed) {
      console.warn(`[WARN] [relay/platform] Orchestrator offline target=${ORCH_BASE}/v1/events event=${input.eventType}`);
    } else {
      console.error(`[ERROR] [relay/platform] event=${input.eventType} target=${ORCH_BASE}/v1/events reason="${msg.slice(0, 200)}"`);
    }
    if (process.env.RELAY_PLATFORM_EVENTS_STRICT === '1') throw err;
    return null;
  }
}

/** JD intent detected during classify — used inside relay.email.classified payload only. */
export const JD_ORCHESTRATION_INTENTS = new Set(['Requirement Shared']);

/** First-touch intents only — Vendor Reply / Follow-up removed to prevent reply loops. */
export const AUTO_REPLY_INTENTS = new Set([
  'Requirement Shared',
  'Interview Request',
  'Selected for Interview',
  'Candidate Shortlisted',
  'Interview Feedback',
  'Need Resume',
  'Rate Asked',
]);

export const MANUAL_ACTION_INTENTS = new Set([
  'Client Submission',
  'Follow-Up Needed',
]);

/**
 * SINGLE Smart Inbox orchestration front door.
 * Do NOT also emit astra.email.received — intake graph routes JD to astra.requirement.intake.
 */
export async function emitEmailClassified(args: {
  threadId: string;
  messageId: string;
  replyIntent: string;
  subject: string;
  body: string;
  fromEmail: string;
  fromName?: string;
  requiresFollowup?: boolean;
  vendorId?: string | null;
  candidateId?: string | null;
  confidenceSource?: string;
  correlationId?: string | null;
}): Promise<string | null> {
  const isJdIntent = JD_ORCHESTRATION_INTENTS.has(args.replyIntent);
  const orchCorrelationId = relayThreadCorrelationId(args.threadId, args.correlationId);

  const toolResult = buildToolResult(
    'relay.classifier',
    'relay.mailbox.ingested',
    'ok',
    {
      reply_intent: args.replyIntent,
      is_jd_intent: isJdIntent,
      thread_id: args.threadId,
      message_id: args.messageId,
    },
    'relay.email.classified',
  );

  return publishPlatformEvent({
    eventType: 'relay.email.classified',
    aggregateType: 'email_thread',
    aggregateId: orchCorrelationId,
    correlationId: orchCorrelationId,
    payload: {
      thread_id: args.threadId,
      relay_thread_id: args.threadId,
      correlation_id: orchCorrelationId,
      message_id: args.messageId,
      reply_intent: args.replyIntent,
      subject: args.subject,
      body: args.body,
      from: args.fromEmail,
      from_name: args.fromName,
      requires_followup: args.requiresFollowup,
      vendor_id: args.vendorId ?? undefined,
      candidate_id: args.candidateId ?? undefined,
      vendor_email: args.fromEmail,
      is_jd_intent: isJdIntent,
      confidence_source: args.confidenceSource,
      tool_result: toolResult,
    },
  });
}

export async function emitConsentDecided(args: {
  threadId: string;
  candidateId: string;
  decision: 'approved' | 'rejected' | 'timeout';
  correlationId: string;
  bodySnippet?: string;
  jobId?: string;
  graphKey?: string;
  graphVersion?: number;
  orchThreadId?: string;
}): Promise<string | null> {
  const decisionPayload = {
    decision: args.decision,
    approved: args.decision === 'approved',
    candidate_id: args.candidateId,
    thread_id: args.threadId,
    relay_thread_id: args.threadId,
  };

  const toolResult = buildToolResult(
    'relay.consent.parser',
    'relay.mailbox.ingested',
    'ok',
    {
      thread_id: args.threadId,
      candidate_id: args.candidateId,
      decision: args.decision,
      body_snippet: args.bodySnippet,
    },
    'relay.consent.decided',
  );

  return publishPlatformEvent({
    eventType: 'relay.consent.decided',
    aggregateType: 'candidate',
    aggregateId: args.candidateId,
    correlationId: args.correlationId,
    payload: {
      ...decisionPayload,
      ...(args.orchThreadId ? { thread_id: args.orchThreadId } : {}),
      jobId: args.jobId,
      requirement_id: args.jobId,
      body_snippet: args.bodySnippet,
      graph_key: args.graphKey ?? 'relay.consent.workflow',
      graph_version: args.graphVersion ?? 2,
      tool_result: toolResult,
    },
  }).then((eventId) => {
    const base = (process.env.SYNTRA_API_URL || `http://127.0.0.1:${process.env.SYNTRA_PORT || '4000'}`).replace(/\/$/, '');
    void fetch(`${base}/internal/pipeline/consent-decided`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({
        candidateId: args.candidateId,
        jobId: args.jobId,
        decision: args.decision,
        threadId: args.threadId,
        correlationId: args.correlationId,
        bodySnippet: args.bodySnippet,
      }),
    }).catch(() => {
      /* orbit pipeline logging is best-effort */
    });
    return eventId;
  });
}

/** @deprecated Use emitEmailClassified — avoids duplicate astra.email.received ingress. */
export async function emitJdReceivedFromEmail(): Promise<null> {
  console.warn('[relay/platform] emitJdReceivedFromEmail is deprecated — use emitEmailClassified only');
  return null;
}
