import { query, normalizeFollowup, normalizeThread, normalizeMessage } from '../db';
import { autoDraftChaseEmail } from '../drafting/replyDrafter';
import { EmailSenderFactory } from '../connectors/sender';
import { isMarketingOrPortalEmail } from '../classification/staffingSignals';

function autoChaseEnabled(): boolean {
  return process.env.RELAY_AUTO_CHASE === '1' || process.env.RELAY_AUTO_CHASE === 'true';
}

function isNonReplyableRecipient(email: string): boolean {
  const e = (email || '').toLowerCase();
  if (!e || !e.includes('@')) return true;
  return (
    isMarketingOrPortalEmail(e, '', '', '') ||
    e.includes('noreply') ||
    e.includes('no-reply') ||
    e.includes('donotreply') ||
    e.includes('jobmessenger') ||
    e.includes('mailer-daemon') ||
    e.includes('postmaster')
  );
}

export async function sweepSLA() {
  if (!autoChaseEnabled()) {
    console.log('[SLA Sweeper] Auto-chase disabled (set RELAY_AUTO_CHASE=1 to enable).');
    return;
  }

  console.log('[SLA Sweeper] Starting autonomous sweep for overdue follow-ups...');

  const now = new Date();

  const { rows: followupRows } = await query(
    `SELECT * FROM relay.followups WHERE status = 'Open' AND due_date <= $1`,
    [now]
  );
  const overdueFollowups = followupRows.map(normalizeFollowup).filter(Boolean);

  if (overdueFollowups.length === 0) {
    console.log('[SLA Sweeper] No overdue follow-ups found.');
    return;
  }

  console.log(`[SLA Sweeper] Found ${overdueFollowups.length} overdue followups.`);

  const sender = EmailSenderFactory.getSender();

  for (const followup of overdueFollowups) {
    if (!followup) continue;
    try {
      const { rows: threadRows } = await query(
        `SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1`,
        [followup.threadId]
      );
      const thread = normalizeThread(threadRows[0]);

      if (!thread) continue;

      if (thread.replyIntent === 'Portal Notifications' || thread.replyIntent === 'Sent') {
        console.log(`[SLA Sweeper] Skip portal/sent thread ${thread.threadId}`);
        continue;
      }

      const recipientEmail = thread.latestSenderEmail || '';
      if (isNonReplyableRecipient(recipientEmail)) {
        console.log(`[SLA Sweeper] Skip non-replyable recipient: ${recipientEmail}`);
        continue;
      }

      const { rows: msgRows } = await query(
        `SELECT * FROM relay.email_messages WHERE thread_id = $1 ORDER BY date DESC LIMIT 1`,
        [followup.threadId]
      );
      const lastMessage = normalizeMessage(msgRows[0]);
      const lastBody = lastMessage?.cleanedBody || lastMessage?.rawBody || '';
      const inReplyTo = lastMessage?.providerMessageId || undefined;

      const chaseBody = await autoDraftChaseEmail(
        followup.replyType || thread.replyIntent || 'Follow-up',
        thread.latestSender || 'there',
        thread.subject || '',
        lastBody,
      );

      const success = await sender.sendEmail(recipientEmail, `RE: ${thread.subject}`, chaseBody, inReplyTo);

      if (success) {
        const newDueDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        await query(
          `UPDATE relay.followups
              SET due_date = $1, followup_reason = 'Agent auto-chased and pushed deadline 24h'
            WHERE id = $2`,
          [newDueDate, followup.id]
        );
      }
    } catch (error) {
      console.error(`[SLA Sweeper] Failed followup ${followup.id}:`, error);
    }
  }
}
