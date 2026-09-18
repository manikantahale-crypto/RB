import { db } from '../db';
import { followups, emailThreads } from '../db/schema';
import { and, eq, lte } from 'drizzle-orm';
import { emitConsentDecided } from '../platform/platformBridge';

const CONSENT_INTENT = 'Candidate Consent Request';

function consentTimeoutEnabled(): boolean {
  return (
    process.env.RELAY_CONSENT_TIMEOUT === '1' ||
    process.env.RELAY_CONSENT_TIMEOUT === 'true'
  );
}

export async function sweepConsentTimeouts() {
  if (!consentTimeoutEnabled()) {
    console.log(
      '[Consent Timeout] Disabled (set RELAY_CONSENT_TIMEOUT=1 to enable).',
    );
    return { scanned: 0, emitted: 0 };
  }

  const now = new Date();
  console.log('[Consent Timeout] Scanning overdue consent follow-ups...');

  const overdue = await db
    .select()
    .from(followups)
    .where(and(eq(followups.status, 'Open'), lte(followups.dueDate, now)));

  const consentFollowups = overdue.filter(
    (f) => f.replyType === CONSENT_INTENT,
  );
  if (!consentFollowups.length) {
    console.log('[Consent Timeout] No overdue consent follow-ups.');
    return { scanned: 0, emitted: 0 };
  }

  let emitted = 0;

  for (const followup of consentFollowups) {
    try {
      if (!followup.threadId || !followup.candidateId) continue;

      const [thread] = await db
        .select()
        .from(emailThreads)
        .where(eq(emailThreads.threadId, followup.threadId))
        .limit(1);

      if (!thread) continue;

      const ctx = (thread.workflowContext as Record<string, unknown>) || {};
      if (ctx.consent_timeout_emitted === true) continue;

      const correlationId =
        thread.correlationId ||
        (typeof ctx.correlation_id === 'string' ? ctx.correlation_id : null);
      if (!correlationId) continue;

      await emitConsentDecided({
        threadId: followup.threadId,
        candidateId: String(followup.candidateId),
        decision: 'timeout',
        correlationId,
        bodySnippet: 'consent_sla_timeout',
      });

      await db
        .update(emailThreads)
        .set({
          workflowContext: {
            ...ctx,
            consent_timeout_emitted: true,
            consent_timed_out_at: now.toISOString(),
          },
          status: 'Consent Timed Out',
        })
        .where(eq(emailThreads.threadId, followup.threadId));

      await db
        .update(followups)
        .set({
          status: 'Timed Out',
          followupReason: 'Consent SLA exceeded — relay.consent.decided timeout emitted',
        })
        .where(eq(followups.id, followup.id));

      emitted += 1;
      console.log(
        `[Consent Timeout] emitted timeout for thread=${followup.threadId} candidate=${followup.candidateId}`,
      );
    } catch (err) {
      console.error(`[Consent Timeout] failed followup ${followup.id}:`, err);
    }
  }

  return { scanned: consentFollowups.length, emitted };
}
