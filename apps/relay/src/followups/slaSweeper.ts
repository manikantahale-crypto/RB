import { db } from '../db';
import { followups, emailThreads, emailMessages } from '../db/schema';
import { lte, and, eq, desc } from 'drizzle-orm';
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

  const overdueFollowups = await db
    .select()
    .from(followups)
    .where(and(eq(followups.status, 'Open'), lte(followups.dueDate, now)));

  if (overdueFollowups.length === 0) {
    console.log('[SLA Sweeper] No overdue follow-ups found.');
    return;
  }

  console.log(`[SLA Sweeper] Found ${overdueFollowups.length} overdue followups.`);

  const sender = EmailSenderFactory.getSender();

  for (const followup of overdueFollowups) {
    try {
      const [thread] = await db
        .select()
        .from(emailThreads)
        .where(eq(emailThreads.threadId, followup.threadId!))
        .limit(1);

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

      const lastMessages = await db
        .select()
        .from(emailMessages)
        .where(eq(emailMessages.threadId, followup.threadId!))
        .orderBy(desc(emailMessages.date))
        .limit(1);

      const lastMessage = lastMessages[0] || null;
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
        await db
          .update(followups)
          .set({ dueDate: newDueDate, followupReason: 'Agent auto-chased and pushed deadline 24h' })
          .where(eq(followups.id, followup.id));
      }
    } catch (error) {
      console.error(`[SLA Sweeper] Failed followup ${followup.id}:`, error);
    }
  }
}
