import { query, normalizeFollowup, normalizeThread } from '../db';
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

  const { rows: followupRows } = await query(
    `SELECT * FROM relay.followups WHERE status = 'Open' AND due_date <= $1`,
    [now]
  );
  const overdue = followupRows.map(normalizeFollowup).filter(Boolean);

  const consentFollowups = overdue.filter(
    (f) => f && f.replyType === CONSENT_INTENT,
  );
  if (!consentFollowups.length) {
    console.log('[Consent Timeout] No overdue consent follow-ups.');
    return { scanned: 0, emitted: 0 };
  }

  let emitted = 0;

  for (const followup of consentFollowups) {
    if (!followup) continue;
    try {
      if (!followup.threadId || !followup.candidateId) continue;

      const { rows: threadRows } = await query(
        `SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1`,
        [followup.threadId]
      );
      const thread = normalizeThread(threadRows[0]);

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

      const nextWorkflowContext = {
        ...ctx,
        consent_timeout_emitted: true,
        consent_timed_out_at: now.toISOString(),
      };

      await query(
        `UPDATE relay.email_threads
            SET workflow_context = $1,
                status = 'Consent Timed Out'
          WHERE thread_id = $2`,
        [JSON.stringify(nextWorkflowContext), followup.threadId]
      );

      await query(
        `UPDATE relay.followups
            SET status = 'Timed Out',
                followup_reason = 'Consent SLA exceeded — relay.consent.decided timeout emitted'
          WHERE id = $1`,
        [followup.id]
      );

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
