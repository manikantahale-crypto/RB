import { FastifyInstance } from 'fastify';
import { query, sql, normalizeFollowup, normalizeThread, normalizeMessage } from './db';
import type { EmailMessage } from './db/schema';
import { sweepSLA } from './followups/slaSweeper';
import { sweepConsentTimeouts } from './followups/consentTimeoutSweeper';
import { sweepConsentReminders } from './followups/consentReminderSweeper';
import { EmailConnectorFactory } from './connectors/router';
import { getTemplateDraft, draftReplyFromContext, rewriteReplyText } from './drafting/replyDrafter';
import { pickDisplayBody, cleanEmailSubject } from './utils/htmlText';
import { findRegisteredCandidateByEmail } from './matching/candidateRegistry';
import { listThreadsForInbox, getThreadDetail } from './inbox/threadsApi';
import { classifyEmailMessage } from './classification/ruleClassifier';
import { registerInternalRoutes } from './platform/internalRoutes';
import { registerInternalSecret } from './platform/internalSecret';
import { queueEmailForProcessing } from './jobs/worker';
import { processEmail } from './agent/inboxAgent';
import { EmailSenderFactory, type OutboundAttachment } from './connectors/sender';
import { v4 as uuidv4 } from 'uuid';

export let mailboxSyncRunning = false;

export async function pullMailbox(log?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void }) {
  if (mailboxSyncRunning) {
    return { success: true, inbox: 0, sent: 0, total: 0, skipped: true };
  }
  mailboxSyncRunning = true;
  try {
    return await pullMailboxOnce(log);
  } finally {
    mailboxSyncRunning = false;
  }
}

async function pullMailboxOnce(log?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void }) {
  const info = (...args: unknown[]) => {
    if (log?.info) {
      try { log.info.apply(log, args); } catch { console.log(...args); }
    } else {
      console.log(...args);
    }
  };
  const warn = (...args: unknown[]) => {
    if (log?.warn) {
      try { log.warn.apply(log, args); } catch { console.warn(...args); }
    } else {
      console.warn(...args);
    }
  };

  try {
    const connector = EmailConnectorFactory.getConnector();
    const syncSent = ['1', 'true', 'yes'].includes(
      String(process.env.RELAY_SYNC_SENT || '0').toLowerCase(),
    );
    const inbox = connector.fetchInbox
      ? await connector.fetchInbox()
      : await connector.fetchUnreadEmails();
    const sent =
      syncSent && connector.fetchSentEmails ? await connector.fetchSentEmails() : [];
    if (!syncSent) {
      info('Mailbox sync skipping Sent folder (RELAY_SYNC_SENT is not enabled)');
    }
    const allEmails = [...inbox, ...sent];

    if (!allEmails.length) {
      return { success: true, inbox: 0, sent: 0, total: 0 };
    }

    // Bulk query existing messages in relay.email_messages by id and providerMessageId
    const candidateIds = allEmails.map((e) => e.id).filter(Boolean);
    const candidateProviderIds = allEmails.map((e) => e.providerMessageId).filter(Boolean);

    const existingIdSet = new Set<string>();
    if (candidateIds.length || candidateProviderIds.length) {
      const { rows: existingMessages } = await query(
        `SELECT id, provider_message_id FROM relay.email_messages
          WHERE ($1::text[] IS NOT NULL AND id = ANY($1))
             OR ($2::text[] IS NOT NULL AND provider_message_id = ANY($2))`,
        [candidateIds.length ? candidateIds : null, candidateProviderIds.length ? candidateProviderIds : null]
      );

      for (const em of existingMessages) {
        if (em.id) existingIdSet.add(em.id);
        if (em.provider_message_id) existingIdSet.add(em.provider_message_id);
      }
    }

    let enqueuedCount = 0;
    const INLINE_CAP = Math.max(1, parseInt(process.env.RELAY_INLINE_PROCESS_CAP || '5', 10));
    for (const email of allEmails) {
      const isAlreadyPersisted =
        (email.id && existingIdSet.has(email.id)) ||
        (email.providerMessageId && existingIdSet.has(email.providerMessageId));

      if (isAlreadyPersisted) {
        continue;
      }

      const priority = email.direction === 'received' ? 10 : 1;
      // pg-boss process-email often cannot fetch jobs (pool max 1). Persist threads here
      // so Smart Inbox is not empty while the queue is timing out.
      if (enqueuedCount < INLINE_CAP) {
        try {
          await processEmail(email);
        } catch (err) {
          warn({ err, id: email.id }, 'inline processEmail failed — queueing');
          try {
            await queueEmailForProcessing(email, { priority });
          } catch (queueErr) {
            warn({ err: queueErr, id: email.id }, 'queueEmailForProcessing failed');
          }
        }
      } else {
        try {
          await queueEmailForProcessing(email, { priority });
        } catch (queueErr) {
          warn({ err: queueErr, id: email.id }, 'queueEmailForProcessing failed');
        }
      }
      enqueuedCount++;
    }

    return { success: true, inbox: inbox.length, sent: sent.length, total: allEmails.length, enqueued: enqueuedCount };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warn({ err }, 'Mailbox sync failed');
    return { success: false, inbox: 0, sent: 0, total: 0, error: message };
  }
}

/** Register all Smart Inbox HTTP routes on a Fastify instance. */
export function registerRelayRoutes(app: FastifyInstance): void {
  // Before the routes themselves, so a route added later is covered too.
  registerInternalSecret(app as never);
  registerInternalRoutes(app);

  app.get('/health', async () => ({ status: 'ok', service: 'relay', timestamp: new Date().toISOString() }));

  app.get('/threads', async () => ({ data: await listThreadsForInbox() }));

  app.get('/threads/:threadId', async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    try {
      const data = await getThreadDetail(decodeURIComponent(threadId));
      if (!data) return reply.status(404).send({ error: 'Thread not found' });
      return { data };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      request.log.error({ err, threadId }, 'getThreadDetail failed');
      return reply.status(500).send({ error: 'thread_detail_failed', message });
    }
  });

  app.get('/followups/reminders', async () => {
    const allFollowups = (await query('SELECT * FROM relay.followups')).rows.map(normalizeFollowup).filter(Boolean);
    const allThreads = (await query('SELECT * FROM relay.email_threads')).rows.map(normalizeThread).filter(Boolean);
    const threadById = new Map(allThreads.map((t) => [t?.threadId, t]));

    let open = 0;
    let dueToday = 0;
    let overdue = 0;
    let highPriority = 0;
    const now = new Date();
    const actionItems: Record<string, unknown>[] = [];

    for (const f of allFollowups) {
      if (!f || f.status !== 'Open') continue;
      open++;
      if (f.priority === 'High') highPriority++;
      const due = f.dueDate ? new Date(f.dueDate) : null;
      const isOverdue = due ? due < now : false;
      if (isOverdue) overdue++;
      else if (due && due.toDateString() === now.toDateString()) dueToday++;

      const thread = threadById.get(f.threadId || '');
      actionItems.push({
        followupId: f.id,
        threadId: f.threadId,
        subject: thread?.subject || 'No subject',
        sender: thread?.latestSender || 'Unknown',
        senderEmail: thread?.latestSenderEmail || '',
        replyType: f.replyType || thread?.replyIntent,
        priority: f.priority,
        dueDate: f.dueDate,
        isOverdue,
        suggestedReply: f.suggestedReply,
      });
    }

    for (const thread of allThreads) {
      if (!thread || !thread.requiresFollowup) continue;
      if (actionItems.some((a) => a.threadId === thread.threadId)) continue;
      open++;
      if (thread.priority === 'High') highPriority++;
      actionItems.push({
        followupId: null,
        threadId: thread.threadId,
        subject: thread.subject || 'No subject',
        sender: thread.latestSender || 'Unknown',
        senderEmail: thread.latestSenderEmail || '',
        replyType: thread.replyIntent,
        priority: thread.priority,
        dueDate: null,
        isOverdue: false,
        suggestedReply: getTemplateDraft(thread.replyIntent || 'Follow-Up Needed').body,
      });
    }

    actionItems.sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      return new Date(String(a.dueDate || 0)).getTime() - new Date(String(b.dueDate || 0)).getTime();
    });

    return { summary: { open, dueToday, overdue, highPriority }, items: allFollowups, actionItems };
  });

  app.get('/threads/:threadId/draft', async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const force = (request.query as { force?: string })?.force === '1';
    const { rows: threadRows } = await query('SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1', [threadId]);
    const thread = normalizeThread(threadRows[0]);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });

    const { rows: msgRows } = await query('SELECT * FROM relay.email_messages WHERE thread_id = $1', [threadId]);
    const msgs = msgRows.map(normalizeMessage).filter((m): m is EmailMessage => Boolean(m));
    const sorted = msgs.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
    const latestInbound = [...sorted].reverse().find((m) => m.direction !== 'sent');
    const contextMsg = latestInbound || sorted[sorted.length - 1];
    const inboundMessageId = latestInbound?.id || contextMsg?.id || null;

    if (
      !force &&
      thread.draftBody &&
      thread.draftMessageId &&
      inboundMessageId &&
      thread.draftMessageId === inboundMessageId
    ) {
      return {
        body: thread.draftBody,
        subject: thread.draftSubject || cleanEmailSubject(thread.subject || ''),
        source: thread.draftSource || 'cached',
        replyable: true,
        attachments: thread.draftAttachments || [],
      };
    }

    const display = pickDisplayBody(contextMsg?.cleanedBody || '', contextMsg?.rawBody || '', (contextMsg as { htmlBody?: string }).htmlBody || null);
    const registeredCandidate = await findRegisteredCandidateByEmail(thread.latestSenderEmail || contextMsg?.fromEmail || '');

    const liveClassification = await classifyEmailMessage(
      {
        fromEmail: latestInbound?.fromEmail || thread.latestSenderEmail || '',
        fromName: latestInbound?.fromName || thread.latestSender || '',
        subject: thread.subject || '',
        fullBodyText: display.plain,
        direction: latestInbound?.direction || 'received',
      },
      null,
    );
    const replyIntent = liveClassification.replyIntent || thread.replyIntent || 'Follow-up';

    const threadHistory = sorted
      .slice(-6)
      .map((m) => {
        const d = pickDisplayBody(m.cleanedBody || '', m.rawBody || '', (m as { htmlBody?: string }).htmlBody || null);
        const who = m.direction === 'sent' ? 'You' : m.fromName || m.fromEmail;
        return `${who}: ${d.plain.slice(0, 450)}`;
      })
      .join('\n---\n');

    const draft = await draftReplyFromContext({
      subject: cleanEmailSubject(thread.subject || ''),
      body: display.plain,
      fromName: latestInbound?.fromName || thread.latestSender || 'there',
      fromEmail: latestInbound?.fromEmail || thread.latestSenderEmail || undefined,
      replyIntent,
      requiresFollowup: Boolean(liveClassification.requiresFollowup ?? thread.requiresFollowup),
      priority: liveClassification.priority || thread.priority || 'Low',
      candidate: registeredCandidate,
      threadHistory,
    });

    await query(
      `UPDATE relay.email_threads
          SET draft_body = $1, draft_subject = $2, draft_source = $3, draft_message_id = $4
        WHERE thread_id = $5`,
      [draft.body, draft.subject, draft.source, inboundMessageId, threadId]
    );

    return { ...draft, attachments: thread.draftAttachments || [] };
  });

  app.put('/threads/:threadId/draft', async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const body = request.body as {
      body?: string;
      subject?: string;
      attachments?: Array<{ filename: string; contentType: string; contentBase64: string; size?: number }>;
    };

    const { rows: threadRows } = await query('SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1', [threadId]);
    const thread = normalizeThread(threadRows[0]);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });

    await query(
      `UPDATE relay.email_threads
          SET draft_body = $1, draft_subject = $2, draft_source = 'user', draft_attachments = $3
        WHERE thread_id = $4`,
      [
        body.body ?? thread.draftBody,
        body.subject ?? thread.draftSubject,
        JSON.stringify(body.attachments ?? thread.draftAttachments ?? []),
        threadId,
      ]
    );

    return { status: 'saved', threadId };
  });

  app.post('/threads/:threadId/send', async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const body = request.body as {
      to?: string;
      subject?: string;
      body?: string;
      attachments?: Array<{ filename: string; contentType: string; contentBase64: string }>;
    };

    const { rows: threadRows } = await query('SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1', [threadId]);
    const thread = normalizeThread(threadRows[0]);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });

    const { rows: msgRows } = await query('SELECT * FROM relay.email_messages WHERE thread_id = $1', [threadId]);
    const msgs = msgRows.map(normalizeMessage).filter(Boolean);
    const sorted = msgs.sort((a, b) => (a!.date?.getTime() || 0) - (b!.date?.getTime() || 0));
    const latestInbound = [...sorted].reverse().find((m) => m!.direction !== 'sent');
    const toAddress = body.to || thread.latestSenderEmail || latestInbound?.fromEmail;
    const subject =
      body.subject ||
      thread.draftSubject ||
      (thread.subject?.startsWith('Re:') ? thread.subject : `Re: ${thread.subject || 'Message'}`);
    const textBody = body.body || thread.draftBody || '';

    if (!toAddress?.trim() || !textBody.trim()) {
      return reply.status(400).send({ error: 'to and body required' });
    }

    const outboundAttachments: OutboundAttachment[] = (body.attachments || []).map((att) => ({
      filename: att.filename,
      contentType: att.contentType || 'application/octet-stream',
      content: att.contentBase64,
      encoding: 'base64',
    }));

    const sender = EmailSenderFactory.getSender();
    const ok = await sender.sendEmail(
      toAddress,
      subject,
      textBody,
      latestInbound?.providerMessageId || undefined,
      outboundAttachments,
    );

    if (!ok) return reply.status(502).send({ error: 'send failed' });

    const messageId = uuidv4();
    await query(
      `INSERT INTO relay.email_messages
         (id, thread_id, from_email, from_name, to_email, subject, raw_body, cleaned_body, direction, date, attachments)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        messageId,
        threadId,
        process.env.GMAIL_SENDER_EMAIL || process.env.RELAY_SMTP_USER || process.env.GMAIL_USER || 'relay@local',
        process.env.RELAY_RECRUITER_NAME || 'Bench Sales',
        toAddress,
        subject,
        textBody,
        textBody,
        'sent',
        new Date(),
        JSON.stringify((body.attachments || []).map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: Buffer.from(a.contentBase64, 'base64').length,
        }))),
      ]
    );

    await query(
      `UPDATE relay.email_threads
          SET latest_date = $1, draft_body = $2, draft_subject = $3, draft_source = 'sent', draft_attachments = $4
        WHERE thread_id = $5`,
      [new Date(), textBody, subject, JSON.stringify(body.attachments ?? []), threadId]
    );

    return { status: 'sent', threadId, messageId };
  });

  app.get('/threads/:threadId/matches', async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const rows = await sql<
      Array<{
        job_id: string;
        job_title: string;
        relay_thread_id: string | null;
        match_id: string | null;
        candidate_id: string | null;
        candidate_name: string | null;
        email: string | null;
        score: number | null;
        tier: string | null;
        shortlist_status: string | null;
      }>
    >`
      SELECT j.id AS job_id,
             j.title AS job_title,
             j.relay_thread_id,
             m.id AS match_id,
             m.person_id AS candidate_id,
             c.full_name AS candidate_name,
             c.email::text AS email,
             m.score,
             m.tier,
             et.workflow_context->>'shortlist_status' AS shortlist_status
        FROM core.requirements j
        LEFT JOIN relay.email_threads et ON et.thread_id = j.relay_thread_id
        LEFT JOIN core.matches m ON m.requirement_id = j.id
        LEFT JOIN core.people c ON c.id = m.person_id
       WHERE j.relay_thread_id = ${threadId}
       ORDER BY m.score DESC NULLS LAST
       LIMIT 10
    `;

    if (!rows.length) {
      return { jobId: null, topMatches: [], shortlistStatus: null };
    }

    const jobId = rows[0].job_id;
    const topMatches = rows
      .filter((r) => r.match_id)
      .map((r) => ({
        matchId: r.match_id,
        candidateId: r.candidate_id,
        candidateName: r.candidate_name,
        email: r.email,
        score: r.score != null ? Number(r.score) : 0,
        tier: r.tier,
      }));

    return {
      jobId,
      jobTitle: rows[0].job_title,
      relayThreadId: threadId,
      shortlistStatus: rows[0].shortlist_status || 'pending_approval',
      topMatches,
    };
  });

  app.post('/threads/:threadId/rewrite', async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const { body: currentText } = request.body as { body?: string };
    if (!currentText?.trim()) return reply.status(400).send({ error: 'body required' });

    const { rows: threadRows } = await query('SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1', [threadId]);
    const thread = normalizeThread(threadRows[0]);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });

    const rewritten = await rewriteReplyText(currentText, {
      subject: thread.subject || '',
      fromName: thread.latestSender || 'there',
      replyIntent: thread.replyIntent || undefined,
    });
    return { body: rewritten };
  });

  /** Recruiter manually adds a Smart Inbox thread to the JD library (non-vendor allowed). */
  app.post('/threads/:threadId/promote-to-jd', async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const { rows: threadRows } = await query('SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1', [threadId]);
    const thread = normalizeThread(threadRows[0]);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });

    const { rows: msgRows } = await query('SELECT * FROM relay.email_messages WHERE thread_id = $1', [threadId]);
    const msgs = msgRows.map(normalizeMessage).filter((m): m is EmailMessage => Boolean(m));
    if (!msgs.length) return reply.status(400).send({ error: 'No messages in thread' });

    const sorted = msgs.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
    const latestInbound = [...sorted].reverse().find((m) => m.direction !== 'sent');
    const contextMsg = latestInbound || sorted[sorted.length - 1];
    if (!contextMsg) return reply.status(400).send({ error: 'No messages in thread' });
    const display = pickDisplayBody(
      contextMsg.cleanedBody || '',
      contextMsg.rawBody || '',
      contextMsg.htmlBody || null,
    );

    const fromEmail = latestInbound?.fromEmail || thread.latestSenderEmail || contextMsg.fromEmail || '';
    const base = (process.env.SYNTRA_API_URL || 'http://localhost:4000').replace(/\/$/, '');

    const upstream = await fetch(`${base}/internal/astra/intake/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: thread.subject || contextMsg.subject || '',
        body: display.plain,
        from: fromEmail,
        from_email: fromEmail,
        message_id: latestInbound?.providerMessageId || latestInbound?.id || contextMsg.id,
        thread_id: threadId,
        relay_thread_id: threadId,
        reply_intent: thread.replyIntent || 'Requirement Shared',
        vendor_id: thread.vendorId || undefined,
        manual_promote: true,
      }),
    });

    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    if (!upstream.ok) {
      return reply.status(upstream.status).send(data);
    }
    if (data.rejected) {
      return reply.status(422).send(data);
    }
    return {
      ...data,
      threadId,
      promoted: true,
    };
  });

  app.post('/webhooks/email', async () => {
    const connector = EmailConnectorFactory.getConnector();
    const inbox = await connector.fetchUnreadEmails();
    const sent = connector.fetchSentEmails ? await connector.fetchSentEmails() : [];
    for (const email of [...inbox, ...sent]) {
      await queueEmailForProcessing(email);
      if (email.direction === 'received') await connector.markAsRead(email.id);
    }
    return { success: true, count: inbox.length + sent.length };
  });

  const handleFetchNow = async () => {
    if (mailboxSyncRunning) return { success: true, status: 'already_syncing' };
    pullMailbox(app.log)
      .then((r) => app.log.info({ inbox: r.inbox, sent: r.sent, skipped: (r as any).skipped }, 'Mailbox sync complete'))
      .catch((err) => app.log.warn({ err }, 'Mailbox sync failed'));
    return { success: true, status: 'started' };
  };

  app.get('/fetch-now', handleFetchNow);
  app.post('/fetch-now', handleFetchNow);

  app.post('/reclassify-inbox', async () => {
    try {
      const { reclassifyStoredMessages } = await import('./agent/reclassifyInbox.js');
      const count = await reclassifyStoredMessages();
      return { success: true, reclassified: count };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  app.post('/test-sla', async () => {
    try {
      await sweepSLA();
      return { success: true, message: 'SLA sweep executed.' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  app.post('/test-consent-timeout', async () => {
    try {
      const result = await sweepConsentTimeouts();
      return { success: true, ...result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  app.post('/test-consent-reminders', async () => {
    try {
      const result = await sweepConsentReminders();
      return { success: true, ...result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });
}
