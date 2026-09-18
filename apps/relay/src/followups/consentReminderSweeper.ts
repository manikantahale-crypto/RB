import { db } from '../db';
import { emailMessages, emailThreads } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { EmailSenderFactory } from '../connectors/sender';
import { shouldSkipOutboundSend } from '../connectors/relayOutbound';
import {
  buildConsentReminderEmail,
  fetchJobContextForConsent,
} from '../platform/consentEmail';
import { findRegisteredCandidateById } from '../matching/candidateRegistry';
import { v4 as uuidv4 } from 'uuid';

const CONSENT_INTENT = 'Candidate Consent Request';

function reminderSweeperEnabled(): boolean {
  const flag = process.env.RELAY_CONSENT_REMIND;
  if (flag === '0' || flag === 'false') return false;
  return true;
}

function reminder1Hours(): number {
  const n = Number(process.env.CONSENT_REMINDER_1_HOURS || 5);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function reminder2Hours(): number {
  const n = Number(process.env.CONSENT_REMINDER_2_HOURS || 24);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

async function candidateRepliedAfterConsent(
  threadId: string,
  sentAt: Date,
): Promise<boolean> {
  const msgs = await db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.threadId, threadId));

  return msgs.some(
    (m) =>
      m.direction !== 'sent' &&
      m.date &&
      m.date.getTime() > sentAt.getTime(),
  );
}

export async function sweepConsentReminders(): Promise<{
  scanned: number;
  sent: number;
  skipped: number;
}> {
  if (!reminderSweeperEnabled()) {
    console.log('[Consent Reminder] Disabled (set RELAY_CONSENT_REMIND=0 to disable).');
    return { scanned: 0, sent: 0, skipped: 0 };
  }

  const r1 = reminder1Hours();
  const r2 = reminder2Hours();
  console.log(`[Consent Reminder] Scanning (1st @ ${r1}h, 2nd @ ${r2}h)...`);

  const threads = await db
    .select()
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.replyIntent, CONSENT_INTENT),
        eq(emailThreads.status, 'Awaiting Consent'),
      ),
    );

  let sent = 0;
  let skipped = 0;

  for (const thread of threads) {
    try {
      const ctx = (thread.workflowContext as Record<string, unknown>) || {};
      if (ctx.kind !== 'candidate_consent') {
        skipped++;
        continue;
      }

      if (ctx.consent_responded_at) {
        skipped++;
        continue;
      }

      const sentAtRaw = ctx.consent_sent_at || thread.latestDate?.toISOString();
      const sentAt = sentAtRaw ? new Date(String(sentAtRaw)) : null;
      if (!sentAt || Number.isNaN(sentAt.getTime())) {
        skipped++;
        continue;
      }

      if (await candidateRepliedAfterConsent(thread.threadId, sentAt)) {
        await db
          .update(emailThreads)
          .set({
            workflowContext: {
              ...ctx,
              consent_responded_at: new Date().toISOString(),
            },
            status: 'Consent Received',
          })
          .where(eq(emailThreads.threadId, thread.threadId));
        skipped++;
        continue;
      }

      const hoursElapsed = (Date.now() - sentAt.getTime()) / 3_600_000;
      const reminderCount = Number(ctx.reminder_count || 0);

      if (reminderCount >= 2) {
        skipped++;
        continue;
      }

      const shouldSendFirst = reminderCount === 0 && hoursElapsed >= r1;
      const shouldSendSecond = reminderCount === 1 && hoursElapsed >= r2;

      if (!shouldSendFirst && !shouldSendSecond) {
        skipped++;
        continue;
      }

      const candidateEmail = thread.latestSenderEmail;
      if (!candidateEmail) {
        skipped++;
        continue;
      }

      const nextReminder = (reminderCount + 1) as 1 | 2;
      const jobId = typeof ctx.jobId === 'string' ? ctx.jobId : null;
      const jobContext = jobId ? await fetchJobContextForConsent(jobId) : {};

      let candidateName = thread.latestSender || 'Candidate';
      if (thread.candidateId) {
        const cand = await findRegisteredCandidateById(String(thread.candidateId));
        if (cand?.name) candidateName = cand.name;
      }

      const { subject, body } = buildConsentReminderEmail(
        candidateName,
        jobContext,
        nextReminder,
      );

      if (shouldSkipOutboundSend('consent-reminder')) {
        skipped++;
        continue;
      }

      const lastSent = await db
        .select()
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.threadId, thread.threadId),
            eq(emailMessages.direction, 'sent'),
          ),
        );
      const lastMsg = lastSent.sort(
        (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0),
      )[0];

      const sender = EmailSenderFactory.getSender();
      const ok = await sender.sendEmail(
        candidateEmail,
        subject.startsWith('Re:') ? subject : `RE: ${thread.subject || subject}`,
        body,
        lastMsg?.providerMessageId || undefined,
      );

      if (!ok) {
        console.warn(`[Consent Reminder] send failed thread=${thread.threadId}`);
        skipped++;
        continue;
      }

      const messageId = uuidv4();
      await db.insert(emailMessages).values({
        id: messageId,
        threadId: thread.threadId,
        fromEmail: process.env.RELAY_SMTP_USER || process.env.GMAIL_USER || 'relay@local',
        fromName: process.env.RELAY_RECRUITER_NAME || 'Bench Sales',
        toEmail: candidateEmail,
        subject,
        rawBody: body,
        cleanedBody: body,
        direction: 'sent',
        date: new Date(),
      });

      await db
        .update(emailThreads)
        .set({
          workflowContext: {
            ...ctx,
            reminder_count: nextReminder,
            last_reminded_at: new Date().toISOString(),
            last_reminder_number: nextReminder,
          },
        })
        .where(eq(emailThreads.threadId, thread.threadId));

      sent++;
      console.log(
        `[Consent Reminder] sent #${nextReminder} to ${candidateEmail} thread=${thread.threadId} (${hoursElapsed.toFixed(1)}h elapsed)`,
      );
    } catch (err) {
      console.error(`[Consent Reminder] failed thread ${thread.threadId}:`, err);
      skipped++;
    }
  }

  return { scanned: threads.length, sent, skipped };
}
