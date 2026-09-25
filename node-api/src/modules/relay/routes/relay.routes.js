/**
 * Express Relay Router - Canonical In-Process Relay implementation for node-api.
 *
 * Replaces the HTTP reverse proxy (relayProxy.routes.js) and consolidates
 * all 24 Relay endpoints into the Express :4000 application.
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const log = require("../../../utils/logger");
const env = require("../../../config/env");
const { requireInternalSecret } = require("../../../middleware/internalSecret");

// Canonical DB Pool & Relay Services (zero ORM dependencies)
const { pool, query, sql, normalizeThread, normalizeMessage, normalizeFollowup } = require("../../../../../apps/relay/src/db/index.ts");
const { sweepSLA } = require("../../../../../apps/relay/src/followups/slaSweeper.ts");
const { sweepConsentTimeouts } = require("../../../../../apps/relay/src/followups/consentTimeoutSweeper.ts");
const { sweepConsentReminders } = require("../../../../../apps/relay/src/followups/consentReminderSweeper.ts");
const { EmailConnectorFactory } = require("../../../../../apps/relay/src/connectors/router.ts");
const { EmailSenderFactory } = require("../../../../../apps/relay/src/connectors/sender.ts");
const { getTemplateDraft, draftReplyFromContext, rewriteReplyText } = require("../../../../../apps/relay/src/drafting/replyDrafter.ts");
const { pickDisplayBody, cleanEmailSubject } = require("../../../../../apps/relay/src/utils/htmlText.ts");
const { findRegisteredCandidateByEmail, findRegisteredCandidateById } = require("../../../../../apps/relay/src/matching/candidateRegistry.ts");
const { clearRegisteredVendorCache } = require("../../../../../apps/relay/src/matching/vendorRegistry.ts");
const { listThreadsForInbox, getThreadDetail } = require("../../../../../apps/relay/src/inbox/threadsApi.ts");
const { classifyEmailMessage } = require("../../../../../apps/relay/src/classification/ruleClassifier.ts");
const { queueEmailForProcessing } = require("../../../../../apps/relay/src/jobs/worker.ts");
const { processEmail } = require("../../../../../apps/relay/src/agent/inboxAgent.ts");
const { pullMailbox, mailboxSyncRunning } = require("../../../../../apps/relay/src/buildRelayApp.ts");
const { buildConsentEmail, buildConsentReminderEmail, fetchJobContextForConsent } = require("../../../../../apps/relay/src/platform/consentEmail.ts");
const { buildInterviewEmailContent } = require("../../../../../apps/relay/src/platform/interviewEmail.ts");
const { internalHeaders } = require("../../../../../apps/relay/src/platform/internalSecret.ts");

const router = express.Router();

// Parsers: dedicated 50MB for email attachments, standard json for metadata
const largeJsonParser = express.json({ limit: "50mb" });
const stdJsonParser = express.json();

// ============================================================================
// Internal Helper Functions
// ============================================================================

const CONSENT_INTENT = "Candidate Consent Request";
const PROFILE_DRAFT_INTENT = "Profile Submission Draft";

function isPlaceholderEmail(email) {
  if (!email || !String(email).trim()) return true;
  const e = String(email).trim().toLowerCase();
  return /@email\.com$/i.test(e) || /@example\.com$/i.test(e) || /@test\.com$/i.test(e);
}

async function candidateBelongsToJobOwner(candidateId, jobId) {
  try {
    const rows = await sql`
      SELECT EXISTS (
        SELECT 1
          FROM core.people c
          JOIN core.requirements j ON j.id = ${jobId}::uuid
         WHERE c.id = ${candidateId}::uuid
           AND (j.created_by IS NULL OR c.created_by IS NULL OR c.created_by = j.created_by)
      ) AS ok
    `;
    return Boolean(rows[0]?.ok);
  } catch (e) {
    log.warn("[relay] candidateBelongsToJobOwner failed", { error: e.message });
    return false;
  }
}

async function hasConsentThreadForJob(candidateId, jobId) {
  const { rows } = await pool.query(
    `SELECT thread_id FROM relay.email_threads
     WHERE candidate_id = $1::uuid
       AND workflow_context->>'kind' = 'candidate_consent'
       AND workflow_context->>'jobId' = $2
     LIMIT 1`,
    [candidateId, jobId]
  );
  return rows.length > 0;
}

async function notifyConsentSent(args) {
  const base = `http://127.0.0.1:${env.PORT}`;
  try {
    const res = await fetch(`${base}/internal/pipeline/consent-sent`, {
      method: "POST",
      headers: internalHeaders(),
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn(`[relay] consent-sent activity log failed (${res.status}): ${text.slice(0, 120)}`);
    }
  } catch (err) {
    log.warn(`[relay] consent-sent activity unreachable: ${err.message}`);
  }
}

// ============================================================================
// Health Endpoints
// ============================================================================

router.get("/relay-health", (_req, res) => {
  return res.json({
    status: "ok",
    service: "relay",
    mode: "in-process",
    publicApi: `:${env.PORT}`,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Public / Recruiter Relay Routes
// ============================================================================

router.get("/threads", async (_req, res, next) => {
  try {
    const data = await listThreadsForInbox();
    return res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get("/threads/:threadId", async (req, res) => {
  const { threadId } = req.params;
  try {
    const data = await getThreadDetail(decodeURIComponent(threadId));
    if (!data) return res.status(404).json({ error: "Thread not found" });
    return res.json({ data });
  } catch (err) {
    log.error("getThreadDetail failed", { threadId, error: err.message });
    return res.status(500).json({ error: "thread_detail_failed", message: err.message });
  }
});

router.get("/followups/reminders", async (_req, res, next) => {
  try {
    const allFollowups = (await pool.query("SELECT * FROM relay.followups")).rows.map(normalizeFollowup);
    const allThreads = (await pool.query("SELECT * FROM relay.email_threads")).rows.map(normalizeThread);
    const threadById = new Map(allThreads.map((t) => [t.threadId, t]));

    let open = 0;
    let dueToday = 0;
    let overdue = 0;
    let highPriority = 0;
    const now = new Date();
    const actionItems = [];

    for (const f of allFollowups) {
      if (f.status !== "Open") continue;
      open++;
      if (f.priority === "High") highPriority++;
      const due = f.dueDate ? new Date(f.dueDate) : null;
      const isOverdue = due ? due < now : false;
      if (isOverdue) overdue++;
      else if (due && due.toDateString() === now.toDateString()) dueToday++;

      const thread = threadById.get(f.threadId || "");
      actionItems.push({
        followupId: f.id,
        threadId: f.threadId,
        subject: thread?.subject || "No subject",
        sender: thread?.latestSender || "Unknown",
        senderEmail: thread?.latestSenderEmail || "",
        replyType: f.replyType || thread?.replyIntent,
        priority: f.priority,
        dueDate: f.dueDate,
        isOverdue,
        suggestedReply: f.suggestedReply,
      });
    }

    for (const thread of allThreads) {
      if (!thread.requiresFollowup) continue;
      if (actionItems.some((a) => a.threadId === thread.threadId)) continue;
      open++;
      if (thread.priority === "High") highPriority++;
      actionItems.push({
        followupId: null,
        threadId: thread.threadId,
        subject: thread.subject || "No subject",
        sender: thread.latestSender || "Unknown",
        senderEmail: thread.latestSenderEmail || "",
        replyType: thread.replyIntent,
        priority: thread.priority,
        dueDate: null,
        isOverdue: false,
        suggestedReply: getTemplateDraft(thread.replyIntent || "Follow-Up Needed").body,
      });
    }

    actionItems.sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      return new Date(String(a.dueDate || 0)).getTime() - new Date(String(b.dueDate || 0)).getTime();
    });

    return res.json({ summary: { open, dueToday, overdue, highPriority }, items: allFollowups, actionItems });
  } catch (err) {
    next(err);
  }
});

router.get("/threads/:threadId/draft", async (req, res, next) => {
  const { threadId } = req.params;
  const force = req.query.force === "1";
  try {
    const threadRes = await pool.query("SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1", [threadId]);
    const thread = normalizeThread(threadRes.rows[0]);
    if (!thread) return res.status(404).json({ error: "Thread not found" });

    const msgRes = await pool.query("SELECT * FROM relay.email_messages WHERE thread_id = $1", [threadId]);
    const msgs = msgRes.rows.map(normalizeMessage);
    const sorted = msgs.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
    const latestInbound = [...sorted].reverse().find((m) => m.direction !== "sent");
    const contextMsg = latestInbound || sorted[sorted.length - 1];
    const inboundMessageId = latestInbound?.id || contextMsg?.id || null;

    if (
      !force &&
      thread.draftBody &&
      thread.draftMessageId &&
      inboundMessageId &&
      thread.draftMessageId === inboundMessageId
    ) {
      return res.json({
        body: thread.draftBody,
        subject: thread.draftSubject || cleanEmailSubject(thread.subject || ""),
        source: thread.draftSource || "cached",
        replyable: true,
        attachments: thread.draftAttachments || [],
      });
    }

    const display = pickDisplayBody(contextMsg?.cleanedBody || "", contextMsg?.rawBody || "", contextMsg?.htmlBody || null);
    const registeredCandidate = await findRegisteredCandidateByEmail(thread.latestSenderEmail || contextMsg?.fromEmail || "");

    const liveClassification = await classifyEmailMessage(
      {
        fromEmail: latestInbound?.fromEmail || thread.latestSenderEmail || "",
        fromName: latestInbound?.fromName || thread.latestSender || "",
        subject: thread.subject || "",
        fullBodyText: display.plain,
        direction: latestInbound?.direction || "received",
      },
      null,
    );
    const replyIntent = liveClassification.replyIntent || thread.replyIntent || "Follow-up";

    const threadHistory = sorted
      .slice(-6)
      .map((m) => {
        const d = pickDisplayBody(m.cleanedBody || "", m.rawBody || "", m.htmlBody || null);
        const who = m.direction === "sent" ? "You" : m.fromName || m.fromEmail;
        return `${who}: ${d.plain.slice(0, 450)}`;
      })
      .join("\n---\n");

    const draft = await draftReplyFromContext({
      subject: cleanEmailSubject(thread.subject || ""),
      body: display.plain,
      fromName: latestInbound?.fromName || thread.latestSender || "there",
      fromEmail: latestInbound?.fromEmail || thread.latestSenderEmail || undefined,
      replyIntent,
      requiresFollowup: Boolean(liveClassification.requiresFollowup ?? thread.requiresFollowup),
      priority: liveClassification.priority || thread.priority || "Low",
      candidate: registeredCandidate,
      threadHistory,
    });

    await db
      .update(emailThreads)
      .set({
        draftBody: draft.body,
        draftSubject: draft.subject,
        draftSource: draft.source,
        draftMessageId: inboundMessageId,
      })
      .where(eq(emailThreads.threadId, threadId));

    return res.json({ ...draft, attachments: thread.draftAttachments || [] });
  } catch (err) {
    next(err);
  }
});

router.put("/threads/:threadId/draft", largeJsonParser, async (req, res, next) => {
  const { threadId } = req.params;
  const body = req.body || {};
  try {
    const threadRes = await pool.query("SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1", [threadId]);
    const thread = normalizeThread(threadRes.rows[0]);
    if (!thread) return res.status(404).json({ error: "Thread not found" });

    await pool.query(
      `UPDATE relay.email_threads
          SET draft_body = $1,
              draft_subject = $2,
              draft_source = 'user',
              draft_attachments = $3
        WHERE thread_id = $4`,
      [
        body.body ?? thread.draftBody,
        body.subject ?? thread.draftSubject,
        JSON.stringify(body.attachments ?? thread.draftAttachments ?? []),
        threadId,
      ]
    );

    return res.json({ status: "saved", threadId });
  } catch (err) {
    next(err);
  }
});

router.post("/threads/:threadId/send", largeJsonParser, async (req, res, next) => {
  const { threadId } = req.params;
  const body = req.body || {};
  try {
    const threadRes = await pool.query("SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1", [threadId]);
    const thread = normalizeThread(threadRes.rows[0]);
    if (!thread) return res.status(404).json({ error: "Thread not found" });

    const msgRes = await pool.query("SELECT * FROM relay.email_messages WHERE thread_id = $1", [threadId]);
    const msgs = msgRes.rows.map(normalizeMessage);
    const sorted = msgs.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
    const latestInbound = [...sorted].reverse().find((m) => m.direction !== "sent");
    const toAddress = body.to || thread.latestSenderEmail || latestInbound?.fromEmail;
    const subject =
      body.subject ||
      thread.draftSubject ||
      (thread.subject?.startsWith("Re:") ? thread.subject : `Re: ${thread.subject || "Message"}`);
    const textBody = body.body || thread.draftBody || "";

    if (!toAddress?.trim() || !textBody.trim()) {
      return res.status(400).json({ error: "to and body required" });
    }

    const outboundAttachments = (body.attachments || []).map((att) => ({
      filename: att.filename,
      contentType: att.contentType || "application/octet-stream",
      content: att.contentBase64,
      encoding: "base64",
    }));

    const sender = EmailSenderFactory.getSender();
    const ok = await sender.sendEmail(
      toAddress,
      subject,
      textBody,
      latestInbound?.providerMessageId || undefined,
      outboundAttachments,
    );

    if (!ok) return res.status(502).json({ error: "send failed" });

    const messageId = uuidv4();
    await pool.query(
      `INSERT INTO relay.email_messages
         (id, thread_id, from_email, from_name, to_email, subject, raw_body, cleaned_body, direction, date, attachments)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        messageId,
        threadId,
        process.env.GMAIL_SENDER_EMAIL || process.env.RELAY_SMTP_USER || process.env.GMAIL_USER || "relay@local",
        process.env.RELAY_RECRUITER_NAME || "Bench Sales",
        toAddress,
        subject,
        textBody,
        textBody,
        "sent",
        new Date(),
        JSON.stringify((body.attachments || []).map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: Buffer.from(a.contentBase64 || "", "base64").length,
        }))),
      ]
    );

    await pool.query(
      `UPDATE relay.email_threads
          SET latest_date = $1,
              draft_body = $2,
              draft_subject = $3,
              draft_source = 'sent',
              draft_attachments = $4
        WHERE thread_id = $5`,
      [
        new Date(),
        textBody,
        subject,
        JSON.stringify(body.attachments ?? []),
        threadId,
      ]
    );

    return res.json({ status: "sent", threadId, messageId });
  } catch (err) {
    next(err);
  }
});

router.get("/threads/:threadId/matches", async (req, res, next) => {
  const { threadId } = req.params;
  try {
    const rows = await sql`
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
      return res.json({ jobId: null, topMatches: [], shortlistStatus: null });
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

    return res.json({
      jobId,
      jobTitle: rows[0].job_title,
      relayThreadId: threadId,
      shortlistStatus: rows[0].shortlist_status || "pending_approval",
      topMatches,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/threads/:threadId/rewrite", stdJsonParser, async (req, res, next) => {
  const { threadId } = req.params;
  const currentText = req.body?.body;
  if (!currentText?.trim()) return res.status(400).json({ error: "body required" });
  try {
    const threadRes = await pool.query("SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1", [threadId]);
    const thread = normalizeThread(threadRes.rows[0]);
    if (!thread) return res.status(404).json({ error: "Thread not found" });

    const rewritten = await rewriteReplyText(currentText, {
      subject: thread.subject || "",
      fromName: thread.latestSender || "there",
      replyIntent: thread.replyIntent || undefined,
    });
    return res.json({ body: rewritten });
  } catch (err) {
    next(err);
  }
});

router.post("/threads/:threadId/promote-to-jd", async (req, res, next) => {
  const { threadId } = req.params;
  try {
    const threadRes = await pool.query("SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1", [threadId]);
    const thread = normalizeThread(threadRes.rows[0]);
    if (!thread) return res.status(404).json({ error: "Thread not found" });

    const msgRes = await pool.query("SELECT * FROM relay.email_messages WHERE thread_id = $1", [threadId]);
    const msgs = msgRes.rows.map(normalizeMessage);
    if (!msgs.length) return res.status(400).json({ error: "No messages in thread" });

    const sorted = msgs.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
    const latestInbound = [...sorted].reverse().find((m) => m.direction !== "sent");
    const contextMsg = latestInbound || sorted[sorted.length - 1];
    const display = pickDisplayBody(
      contextMsg.cleanedBody || "",
      contextMsg.rawBody || "",
      contextMsg.htmlBody || null,
    );

    const fromEmail = latestInbound?.fromEmail || thread.latestSenderEmail || contextMsg.fromEmail || "";
    const base = `http://127.0.0.1:${env.PORT}`;

    const upstream = await fetch(`${base}/internal/astra/intake/email`, {
      method: "POST",
      headers: internalHeaders(),
      body: JSON.stringify({
        subject: thread.subject || contextMsg.subject || "",
        body: display.plain,
        from: fromEmail,
        from_email: fromEmail,
        message_id: latestInbound?.providerMessageId || latestInbound?.id || contextMsg.id,
        thread_id: threadId,
        relay_thread_id: threadId,
        reply_intent: thread.replyIntent || "Requirement Shared",
        vendor_id: thread.vendorId || undefined,
        manual_promote: true,
      }),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status).json(data);
    }
    if (data.rejected) {
      return res.status(422).json(data);
    }
    return res.json({
      ...data,
      threadId,
      promoted: true,
    });
  } catch (err) {
    next(err);
  }
});

// Webhook endpoint: accepts raw bytes or json and queues emails
router.post(
  "/webhooks/email",
  express.raw({ type: "*/*" }),
  async (req, res, next) => {
    try {
      const connector = EmailConnectorFactory.getConnector();
      const inbox = await connector.fetchUnreadEmails();
      const sent = connector.fetchSentEmails ? await connector.fetchSentEmails() : [];
      for (const email of [...inbox, ...sent]) {
        await queueEmailForProcessing(email);
        if (email.direction === "received") await connector.markAsRead(email.id);
      }
      return res.json({ success: true, count: inbox.length + sent.length });
    } catch (err) {
      next(err);
    }
  },
);

// Non-blocking fetch-now
const handleFetchNow = async (_req, res) => {
  if (mailboxSyncRunning) return res.json({ success: true, status: "already_syncing" });
  pullMailbox(log)
    .then((r) => log.info("Mailbox sync complete", { inbox: r.inbox, sent: r.sent, skipped: r.skipped }))
    .catch((err) => log.warn("Mailbox sync failed", { error: err.message }));
  return res.json({ success: true, status: "started" });
};

router.get("/fetch-now", handleFetchNow);
router.post("/fetch-now", handleFetchNow);

router.post("/reclassify-inbox", async (_req, res) => {
  try {
    const { reclassifyStoredMessages } = require("../../../../../apps/relay/src/agent/reclassifyInbox.ts");
    const count = await reclassifyStoredMessages();
    return res.json({ success: true, reclassified: count });
  } catch (error) {
    return res.json({ success: false, error: error.message });
  }
});

router.post("/test-sla", async (_req, res) => {
  try {
    await sweepSLA();
    return res.json({ success: true, message: "SLA sweep executed." });
  } catch (error) {
    return res.json({ success: false, error: error.message });
  }
});

router.post("/test-consent-timeout", async (_req, res) => {
  try {
    const result = await sweepConsentTimeouts();
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.json({ success: false, error: error.message });
  }
});

router.post("/test-consent-reminders", async (_req, res) => {
  try {
    const result = await sweepConsentReminders();
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.json({ success: false, error: error.message });
  }
});

// ============================================================================
// Internal Orchestrator Routes (Guarded with requireInternalSecret)
// ============================================================================

router.use("/internal", requireInternalSecret, stdJsonParser);

router.post("/internal/shortlist/pending", async (req, res, next) => {
  const body = req.body || {};
  const threadId = body.relay_thread_id;
  const jobId = body.jobId || body.requirement_id;
  if (!threadId || !jobId) {
    return res.status(400).json({ error: "relay_thread_id and jobId required" });
  }

  try {
    const threadRes = await pool.query("SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1", [threadId]);
    const thread = normalizeThread(threadRes.rows[0]);
    if (!thread) {
      return res.status(404).json({ error: "thread not found", relay_thread_id: threadId });
    }

    const ctx = thread.workflowContext || {};
    const nextCtx = {
      ...ctx,
      kind: "vendor_jd_shortlist",
      jobId,
      shortlist_status: "pending_approval",
      match_job_id: body.match_job_id ?? ctx.match_job_id,
      result_count: body.result_count ?? body.top_candidates?.length ?? 0,
      top_candidates: body.top_candidates ?? [],
      vendor_email: body.vendor_email ?? thread.latestSenderEmail,
      updated_at: new Date().toISOString(),
    };

    await pool.query(
      "UPDATE relay.email_threads SET workflow_context = $1 WHERE thread_id = $2",
      [JSON.stringify(nextCtx), threadId]
    );

    return res.json({
      status: "pending_approval",
      relay_thread_id: threadId,
      jobId,
      top_count: body.top_candidates?.length ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/internal/shortlist/approved", requireInternalSecret, async (req, res, next) => {
  const body = req.body || {};
  const threadId = body.relay_thread_id;
  if (!threadId) return res.status(400).json({ error: "relay_thread_id required" });

  try {
    const threadRes = await pool.query("SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1", [threadId]);
    const thread = normalizeThread(threadRes.rows[0]);
    if (!thread) return res.status(404).json({ error: "thread not found" });

    const ctx = thread.workflowContext || {};
    const nextCtx = {
      ...ctx,
      shortlist_status: "approved",
      consent_sent_at: new Date().toISOString(),
      consent: body.consent ?? ctx.consent,
      top_candidates: body.top_candidates ?? ctx.top_candidates,
    };

    await pool.query(
      "UPDATE relay.email_threads SET workflow_context = $1 WHERE thread_id = $2",
      [JSON.stringify(nextCtx), threadId]
    );

    return res.json({ status: "approved", relay_thread_id: threadId, jobId: body.jobId ?? ctx.jobId });
  } catch (err) {
    next(err);
  }
});

router.post("/internal/consent/send", requireInternalSecret, async (req, res, next) => {
  const reqId = req.id || req.headers["x-request-id"] || "relay-consent";
  const tRouteStart = Date.now();
  const body = req.body || {};
  const jobId = body.jobId || body.requirement_id;
  const candidates = body.top_candidates || [];
  const force = Boolean(body.force);

  log.debug(
    `[request=${reqId}] [relay.consent.send] Request received jobId=${jobId} candidatesCount=${candidates.length} force=${force}`
  );

  if (!jobId || !candidates.length) {
    return res.status(400).json({ error: "jobId and top_candidates required" });
  }

  try {
    if (body.vendor_thread_id && !force) {
      const vRes = await pool.query("SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1", [body.vendor_thread_id]);
      const vendorThread = normalizeThread(vRes.rows[0]);
      const vCtx = vendorThread?.workflowContext || {};
      const priorIds = new Set(
        ((vCtx.consent?.consent_threads) || []).map((t) => t.candidate_id).filter(Boolean),
      );
      const allAlreadySent = candidates.every((raw) => {
        const id = typeof raw === "string" ? raw : raw.id;
        return priorIds.has(id);
      });
      if (
        allAlreadySent &&
        Number(vCtx.consent_sent_count ?? 0) > 0 &&
        vCtx.shortlist_status === "consent_sent"
      ) {
        return res.json({
          status: "already_sent",
          sent_count: 0,
          thread_ids: [],
          consent_threads: [],
          correlation_id: body.correlation_id || null,
          send_errors: [],
        });
      }
    }

    const sender = EmailSenderFactory.getSender();
    const threadIds = [];
    const consentThreads = [];
    const sendErrors = [];
    let sentCount = 0;
    const correlationId = body.correlation_id || uuidv4();
    const jobContext = jobId ? await fetchJobContextForConsent(jobId) : {};

    for (const raw of candidates.slice(0, 5)) {
      const candidateId = typeof raw === "string" ? raw : raw.id;
      const subId = typeof raw === "object" ? (raw.submissionId || raw.submission_id) : (body.submissionId || body.submission_id);
      const registered = await findRegisteredCandidateById(candidateId);
      const email = (registered?.email || (typeof raw === "object" ? raw.email : "") || "").trim();
      const candidateName =
        registered?.name || (typeof raw === "object" ? raw.name : null) || "Candidate";

      if (!email) {
        sendErrors.push({ candidate_id: candidateId, email: "", reason: "missing_email" });
        continue;
      }

      if (isPlaceholderEmail(email)) {
        sendErrors.push({
          candidate_id: candidateId,
          email,
          reason: "placeholder_email_update_candidate_in_resumes",
        });
        continue;
      }

      if (!force && (await hasConsentThreadForJob(candidateId, jobId))) {
        sendErrors.push({
          candidate_id: candidateId,
          email,
          reason: "consent_already_sent_for_job",
        });
        continue;
      }

      if (!(await candidateBelongsToJobOwner(candidateId, jobId))) {
        sendErrors.push({
          candidate_id: candidateId,
          email,
          reason: "candidate_not_in_recruiter_pool",
        });
        continue;
      }

      const threadId = uuidv4();
      const messageId = uuidv4();

      let subject = body.subject;
      let bodyText = body.body || body.bodyText;

      if (!subject || !bodyText) {
        const canonical = buildConsentEmail(candidateName, jobContext);
        subject = subject || canonical.subject;
        bodyText = bodyText || canonical.body;
      }

      let ok = false;
      const tSend = Date.now();
      log.debug(`[request=${reqId}] [relay.consent.send] EmailSenderFactory dispatching candidateId=${candidateId}`);
      try {
        ok = await sender.sendEmail(email, subject, bodyText);
      } catch (sendErr) {
        log.debug(`[request=${reqId}] [relay.consent.send] EmailSenderFactory threw candidateId=${candidateId} error=${sendErr?.message}`);
        sendErrors.push({
          candidate_id: candidateId,
          email,
          reason: sendErr instanceof Error ? sendErr.message : "send_exception",
        });
        continue;
      }
      log.debug(`[request=${reqId}] [relay.consent.send] EmailSenderFactory finished ok=${ok} candidateId=${candidateId} duration=${Date.now() - tSend}ms`);
      if (!ok) {
        sendErrors.push({ candidate_id: candidateId, email, reason: "smtp_or_gmail_send_failed" });
        continue;
      }

      sentCount++;
      const matchScore =
        typeof raw === "object" && raw !== null && "score" in raw
          ? Number(raw.score)
          : undefined;
      await notifyConsentSent({
        candidateId,
        jobId,
        email,
        correlationId,
        matchScore: Number.isFinite(matchScore) ? matchScore : undefined,
      });

      threadIds.push(threadId);
      consentThreads.push({
        candidate_id: candidateId,
        thread_id: threadId,
        email,
        submission_id: subId || undefined,
      });

      await pool.query(
        `INSERT INTO relay.email_threads
           (thread_id, subject, latest_sender, latest_sender_email, latest_date,
            reply_intent, requires_followup, status, priority, candidate_id, correlation_id, workflow_context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (thread_id) DO UPDATE SET
           subject = EXCLUDED.subject,
           latest_sender = EXCLUDED.latest_sender,
           latest_sender_email = EXCLUDED.latest_sender_email,
           latest_date = EXCLUDED.latest_date,
           reply_intent = EXCLUDED.reply_intent,
           requires_followup = EXCLUDED.requires_followup,
           status = EXCLUDED.status,
           priority = EXCLUDED.priority,
           candidate_id = EXCLUDED.candidate_id,
           correlation_id = EXCLUDED.correlation_id,
           workflow_context = EXCLUDED.workflow_context`,
        [
          threadId,
          subject,
          candidateName || email,
          email,
          new Date(),
          CONSENT_INTENT,
          true,
          "Awaiting Consent",
          "High",
          candidateId,
          correlationId,
          JSON.stringify({
            kind: "candidate_consent",
            jobId,
            submissionId: subId || null,
            vendor_thread_id: body.vendor_thread_id,
            vendor_email: body.vendor_email,
            correlation_id: correlationId,
            consent_sent_at: new Date().toISOString(),
            reminder_count: 0,
          }),
        ]
      );

      await pool.query(
        `INSERT INTO relay.email_messages
           (id, thread_id, from_email, from_name, to_email, subject, raw_body, cleaned_body, direction, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          messageId,
          threadId,
          process.env.GMAIL_SENDER_EMAIL || process.env.SMTP_USERNAME || process.env.RELAY_SMTP_USER || "relay@local",
          process.env.RELAY_RECRUITER_NAME || "Bench Sales",
          email,
          subject,
          bodyText,
          bodyText,
          "sent",
          new Date(),
        ]
      );

      await pool.query(
        `INSERT INTO relay.followups
           (id, thread_id, message_id, candidate_id, reply_type, priority, status, due_date, suggested_reply, followup_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          uuidv4(),
          threadId,
          messageId,
          candidateId,
          CONSENT_INTENT,
          "High",
          "Open",
          new Date(Date.now() + 48 * 60 * 60 * 1000),
          bodyText,
          `Consent request for job ${jobId}`,
        ]
      );
    }

    if (sentCount > 0 && body.vendor_thread_id) {
      const vRes = await pool.query("SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1", [body.vendor_thread_id]);
      const vendorThread = normalizeThread(vRes.rows[0]);
      if (vendorThread) {
        const vCtx = vendorThread.workflowContext || {};
        const prevCount = Number(vCtx.consent_sent_count ?? 0);
        const prevThreads = vCtx.consent?.consent_threads || [];
        const nextWorkflowContext = {
          ...vCtx,
          shortlist_status: "consent_sent",
          consent_sent_at: new Date().toISOString(),
          consent_sent_count: prevCount + sentCount,
          consent: {
            status: "sent",
            sent_count: prevCount + sentCount,
            consent_threads: [...prevThreads, ...consentThreads],
            correlation_id: correlationId,
            send_errors: sendErrors,
          },
        };
        await pool.query(
          "UPDATE relay.email_threads SET workflow_context = $1 WHERE thread_id = $2",
          [JSON.stringify(nextWorkflowContext), body.vendor_thread_id]
        );
      }
    }

    log.debug(
      `[request=${reqId}] [relay.consent.send] Completed sentCount=${sentCount} duration=${Date.now() - tRouteStart}ms`
    );

    return res.json({
      status: sentCount ? "sent" : "no_recipients",
      sent_count: sentCount,
      thread_ids: threadIds,
      consent_threads: consentThreads,
      correlation_id: correlationId,
      send_errors: sendErrors,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/internal/consent/remind", requireInternalSecret, async (req, res, next) => {
  const body = req.body || {};
  if (!body.thread_id) return res.status(400).json({ error: "thread_id required" });

  try {
    const threadRes = await pool.query("SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1", [body.thread_id]);
    const thread = normalizeThread(threadRes.rows[0]);
    if (!thread?.latestSenderEmail) return res.status(404).json({ error: "thread not found" });

    const ctx = thread.workflowContext || {};
    const jobId = typeof ctx.jobId === "string" ? ctx.jobId : null;
    const jobContext = jobId ? await fetchJobContextForConsent(jobId) : {};
    const reminderNum = (body.reminder_count ?? Number(ctx.reminder_count ?? 0) + 1);

    let candidateName = thread.latestSender || "Candidate";
    if (thread.candidateId) {
      const reg = await findRegisteredCandidateById(String(thread.candidateId));
      if (reg?.name) candidateName = reg.name;
    }

    const { subject, body: reminderBody } = buildConsentReminderEmail(candidateName, jobContext, reminderNum);

    const msgRes = await pool.query(
      "SELECT * FROM relay.email_messages WHERE thread_id = $1 ORDER BY date DESC LIMIT 1",
      [body.thread_id]
    );
    const lastMessage = normalizeMessage(msgRes.rows[0]);

    const sender = EmailSenderFactory.getSender();
    const ok = await sender.sendEmail(
      thread.latestSenderEmail,
      subject.startsWith("Re:") ? subject : `RE: ${thread.subject || subject}`,
      reminderBody,
      lastMessage?.providerMessageId || undefined,
    );

    if (ok) {
      const nextWorkflowContext = {
        ...ctx,
        reminder_count: reminderNum,
        last_reminded_at: new Date().toISOString(),
        last_reminder_number: reminderNum,
      };
      await pool.query(
        "UPDATE relay.email_threads SET workflow_context = $1 WHERE thread_id = $2",
        [JSON.stringify(nextWorkflowContext), body.thread_id]
      );
    }

    return res.json({
      status: ok ? "reminded" : "send_failed",
      thread_id: body.thread_id,
      reminder_count: reminderNum,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/internal/profile/draft", requireInternalSecret, async (req, res, next) => {
  const body = req.body || {};
  const vendorEmail = body.vendor_email;
  if (!body.candidate_id || (!vendorEmail && !body.vendor_thread_id)) {
    return res.status(400).json({ error: "candidate_id and vendor destination required" });
  }

  let toEmail = vendorEmail || "";
  let subject = `Profile submission — ${body.jobId || "requirement"}`;
  let inReplyTo = undefined;

  try {
    if (body.vendor_thread_id) {
      const vRes = await pool.query("SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1", [body.vendor_thread_id]);
      const vendorThread = normalizeThread(vRes.rows[0]);
      if (vendorThread) {
        toEmail = toEmail || vendorThread.latestSenderEmail || "";
        subject = `RE: ${vendorThread.subject || subject}`;
      }
      const msgRes = await pool.query(
        "SELECT * FROM relay.email_messages WHERE thread_id = $1 ORDER BY date DESC LIMIT 1",
        [body.vendor_thread_id]
      );
      const lastMsg = normalizeMessage(msgRes.rows[0]);
      inReplyTo = lastMsg?.providerMessageId || undefined;
    }

    if (!toEmail) return res.status(400).json({ error: "vendor email not found" });

    const candidate =
      (await findRegisteredCandidateById(body.candidate_id)) ||
      { id: body.candidate_id, name: "Candidate" };

    const draft = await draftReplyFromContext({
      subject,
      body: `Submitting profile for ${candidate.name || "candidate"} against job ${body.jobId}.`,
      fromName: "Vendor",
      replyIntent: "Need Resume",
      requiresFollowup: false,
      priority: "High",
    });

    const draftId = uuidv4();
    const threadId = uuidv4();
    const messageId = uuidv4();

    await pool.query(
      `INSERT INTO relay.email_threads
         (thread_id, subject, latest_sender, latest_sender_email, latest_date,
          reply_intent, requires_followup, status, priority, candidate_id, correlation_id, workflow_context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        threadId,
        draft.subject,
        toEmail,
        toEmail,
        new Date(),
        PROFILE_DRAFT_INTENT,
        false,
        "Draft — Recruiter Review",
        "High",
        body.candidate_id,
        body.correlation_id || null,
        JSON.stringify({
          kind: "profile_submission_draft",
          draft_id: draftId,
          jobId: body.jobId,
          candidate_id: body.candidate_id,
          vendor_thread_id: body.vendor_thread_id,
          vendor_email: toEmail,
          in_reply_to: inReplyTo,
          status: "pending_recruiter_review",
        }),
      ]
    );

    await pool.query(
      `INSERT INTO relay.email_messages
         (id, thread_id, from_email, from_name, to_email, subject, raw_body, cleaned_body, direction, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        messageId,
        threadId,
        process.env.GMAIL_SENDER_EMAIL || process.env.EMAIL_FROM || "relay@local",
        process.env.RELAY_RECRUITER_NAME || "Bench Sales",
        toEmail,
        draft.subject,
        draft.body,
        draft.body,
        "draft",
        new Date(),
      ]
    );

    return res.json({
      status: "draft_ready",
      draft_id: draftId,
      thread_id: threadId,
      candidate_id: body.candidate_id,
      vendor_email: toEmail,
      subject: draft.subject,
      body_preview: draft.body.slice(0, 500),
      requires_recruiter_review: true,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/internal/profile/send", requireInternalSecret, async (req, res, next) => {
  const body = req.body || {};
  const vendorEmail = body.vendor_email;
  const submissionId = body.submissionId || body.submission_id;
  const candidateId = body.candidate_id || body.candidateId;
  const jobId = body.jobId || body.job_id || "Requirement";

  if (!candidateId || (!vendorEmail && !body.vendor_thread_id)) {
    return res.status(400).json({ error: "candidate_id and vendor destination required" });
  }

  let toEmail = vendorEmail || "";
  let inReplyTo = undefined;

  try {
    if (body.vendor_thread_id) {
      const vRes = await pool.query("SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1", [body.vendor_thread_id]);
      const vendorThread = normalizeThread(vRes.rows[0]);
      if (vendorThread) {
        toEmail = toEmail || vendorThread.latestSenderEmail || "";
      }
      const msgRes = await pool.query(
        "SELECT * FROM relay.email_messages WHERE thread_id = $1 ORDER BY date DESC LIMIT 1",
        [body.vendor_thread_id]
      );
      const lastMsg = normalizeMessage(msgRes.rows[0]);
      inReplyTo = lastMsg?.providerMessageId || undefined;
    }

    if (!toEmail) return res.status(400).json({ error: "vendor email not found" });

    const jobTitle = body.job_title || "Open Position";
    const vendorName = body.vendor_name || "Hiring Team";
    const masked = body.masked_profile || {};
    const candidateIdRef = masked.maskedCandidateId || `CAND-${String(candidateId).slice(0, 8).toUpperCase()}`;
    const candidateRole = masked.headline || masked.role || jobTitle;
    const experienceYears = masked.totalExperience || masked.experience_years || "Relevant";
    const skills = Array.isArray(masked.skills) ? masked.skills.join(", ") : (masked.skills || "Specified in profile");
    const location = masked.location || "Remote / Open";
    const rateDisplay = body.rate ? `$${body.rate}/${(body.rate_type || "HOURLY").toLowerCase() === "hourly" ? "hr" : "yr"}` : (masked.rate ? `$${masked.rate}/hr` : "Negotiable / Market Rate");
    const availability = body.availability || masked.availability || "Immediate / 2 Weeks";
    const summary = masked.summary || masked.profile_summary || "Experienced professional qualified and available for the position.";

    const subject = `Candidate Submission: ${jobTitle} — ${candidateIdRef} [SUB-REF: ${submissionId || candidateId}]`;

    const bodyText = `Hi ${vendorName},

We have an available candidate who is well-matched for the ${jobTitle} position.

--- Candidate Summary ---
• Candidate ID: ${candidateIdRef}
• Role: ${candidateRole}
• Experience: ${experienceYears} Years
• Key Skills: ${skills}
• Location: ${location}
• Rate: ${rateDisplay} (${body.rate_type || "C2C"})
• Availability: ${availability}

--- Profile Overview ---
${summary}

Please let us know if you would like to proceed with this candidate for the ${jobTitle} position.

Best regards,
Recruiting Team`;

    const sender = EmailSenderFactory.getSender();
    const ok = await sender.sendEmail(toEmail, subject, bodyText, inReplyTo);
    if (!ok) {
      return res.status(500).json({ error: "Failed to dispatch email via provider", status: "send_failed" });
    }

    const threadId = body.vendor_thread_id || uuidv4();
    const messageId = uuidv4();

    const wfCtx = {
      kind: "vendor_submission",
      submissionId: submissionId || null,
      submission_id: submissionId || null,
      jobId: jobId,
      job_id: jobId,
      candidateId: candidateId,
      vendorEmail: toEmail,
      vendorName: vendorName,
      jobTitle: jobTitle,
    };

    await pool.query(
      `INSERT INTO relay.email_threads
         (thread_id, subject, latest_sender, latest_sender_email, latest_date,
          reply_intent, requires_followup, status, priority, candidate_id, correlation_id, workflow_context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (thread_id) DO UPDATE SET
         workflow_context = EXCLUDED.workflow_context,
         status = EXCLUDED.status`,
      [
        threadId,
        subject,
        vendorName,
        toEmail,
        new Date(),
        "Vendor Profile Submission",
        true,
        "Submitted to Vendor",
        "High",
        candidateId.length === 36 ? candidateId : null,
        submissionId || candidateId,
        JSON.stringify(wfCtx),
      ]
    );

    await pool.query(
      `INSERT INTO relay.email_messages
         (id, thread_id, from_email, from_name, to_email, subject, raw_body, cleaned_body, direction, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        messageId,
        threadId,
        process.env.RELAY_SMTP_USER || process.env.GMAIL_USER || "relay@local",
        process.env.RELAY_RECRUITER_NAME || "Bench Sales",
        toEmail,
        subject,
        bodyText,
        bodyText,
        "sent",
        new Date(),
      ]
    );

    return res.json({
      status: "sent",
      submissionId: submissionId,
      candidate_id: candidateId,
      vendor_email: toEmail,
      thread_id: threadId,
      message_id: messageId,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/internal/vendors/cache-clear", requireInternalSecret, async (_req, res) => {
  clearRegisteredVendorCache();
  return res.json({ ok: true });
});

router.post("/internal/interview/send", requireInternalSecret, async (req, res, next) => {
  const body = req.body || {};
  if (!body.to?.trim()) {
    return res.status(400).json({ error: "to required" });
  }

  const template = body.template;
  if (
    template !== "session_invite" &&
    template !== "session_completed" &&
    template !== "retake_invite"
  ) {
    return res.status(400).json({
      error: "template must be session_invite | session_completed | retake_invite",
    });
  }

  try {
    const { subject, html, text } = buildInterviewEmailContent(
      template,
      body.data || {},
    );

    const sender = EmailSenderFactory.getSender();
    const ok = await sender.sendEmail(
      body.to.trim(),
      subject,
      text,
      undefined,
      [],
      html,
    );

    if (!ok) {
      const senderDetail = sender.lastError?.trim() || "";
      const hint = !process.env.GMAIL_REFRESH_TOKEN
        ? "Gmail OAuth not configured — set GMAIL_REFRESH_TOKEN, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET"
        : !process.env.GMAIL_SENDER_EMAIL
          ? "GMAIL_SENDER_EMAIL is missing"
          : senderDetail ||
            "Gmail API and SMTP both failed — check token expiry, network connectivity, or Gmail send quota";
      return res.status(502).json({
        error: "send_failed",
        ok: false,
        hint,
        detail: senderDetail || undefined,
      });
    }

    return res.json({
      ok: true,
      messageId: `relay-interview-${Date.now()}`,
      template,
      to: body.to.trim(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
