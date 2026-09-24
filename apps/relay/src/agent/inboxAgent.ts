import { query, normalizeThread, normalizeMessage } from '../db';
import type { EmailThread, EmailMessage } from '../db/schema';
import { classify } from '../classification/classify';
import { findCandidateForEmail } from '../matching/candidateMatcher';
import { generateSuggestedReply } from '../drafting/replyDrafter';
import { calculateDueDate } from '../followups/followupService';
import { loadRegisteredVendorMap } from '../matching/vendorRegistry';
import { stripHtmlToText, cleanEmailSubject, htmlToPlainText } from '../utils/htmlText';
import { v4 as uuidv4 } from 'uuid';
import {
  emitConsentDecided,
  emitEmailClassified,
} from '../platform/platformBridge';
import { parseCandidateConsent } from '../platform/consentParser';
import { parseVendorResponse } from '../platform/vendorParser';
import { forwardConsentToPrism, forwardVendorResponseToPrism } from '../platform/prismClient';
import { tryAutonomousReply } from '../platform/autoReply';
import { relayThreadCorrelationId } from '../platform/relayIds';
import { extractEmail, resolveThreadIdForEmail, subjectKey } from '../inbox/threadResolver';
import { tryDirectVendorJdIntake } from '../platform/jdIntake';
import { buildConversationSummary } from '../platform/conversationGuard';

async function findOpenConsentThread(opts: {
  fromEmail: string;
  candId: string | null;
  subject: string;
  existing?: EmailThread | null;
}) {
  const existingCtx = (opts.existing?.workflowContext as Record<string, unknown>) || {};
  if (existingCtx.kind === 'candidate_consent' && opts.existing?.correlationId) {
    if (opts.existing.status === 'Awaiting Consent' || opts.existing.replyIntent === 'Candidate Consent Request') {
      return opts.existing;
    }
  }

  const from = String(opts.fromEmail || '').trim().toLowerCase();
  const subj = subjectKey(opts.subject || '');

  const { rows } = await query(
    `SELECT * FROM relay.email_threads WHERE status = 'Awaiting Consent' ORDER BY latest_date DESC LIMIT 200`
  );
  const open = rows.map(normalizeThread).filter(Boolean) as EmailThread[];

  const consents = open.filter((t) => {
    const ctx = (t.workflowContext as Record<string, unknown>) || {};
    return (
      t.replyIntent === 'Candidate Consent Request' &&
      ctx.kind === 'candidate_consent' &&
      Boolean(t.correlationId)
    );
  });

  if (!consents.length) return null;

  const bySubject = consents.filter((t) => subjectKey(t.subject || '') === subj);
  const byCandidate = opts.candId ? consents.filter((t) => t.candidateId === opts.candId) : [];
  const byEmail = consents.filter((t) => extractEmail(t.latestSenderEmail) === from);

  const subjectAndCandidate = bySubject.filter((t) => opts.candId && t.candidateId === opts.candId);
  if (subjectAndCandidate.length === 1) return subjectAndCandidate[0];
  if (byCandidate.length === 1) return byCandidate[0];
  if (bySubject.length === 1) return bySubject[0];
  if (byEmail.length === 1) return byEmail[0];

  if (bySubject.length > 1 || byCandidate.length > 1 || byEmail.length > 1) {
    console.warn(
      `[RELAY] Ambiguous consent thread for ${from} subject="${subj}" candidates=${byCandidate.length} subjects=${bySubject.length}`,
    );
  }
  return null;
}

export async function processEmail(emailData: any): Promise<void> {
  const vendorsMap = await loadRegisteredVendorMap();
  const classification = await classify(emailData, vendorsMap);

  // 2. Candidate Matching
  const bodyContent = emailData.fullBodyText || emailData.htmlBody || emailData.bodyPreview || '';
  const candidate = await findCandidateForEmail(emailData.fromEmail, emailData.subject, bodyContent);

  const candId = candidate ? candidate.id : null;
  const vendorId = classification.vendor ? (classification.vendor as { id?: string }).id || null : null;

  // 3. Resolve Target Thread
  const resolvedThreadId = await resolveThreadIdForEmail(emailData);
  const isSent = classification.direction === 'sent' || emailData.direction === 'sent';
  const isInbound = emailData.direction !== 'sent' && classification.direction !== 'sent';

  let existingThread: EmailThread | null = null;
  const { rows: existRows } = await query(
    'SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1',
    [resolvedThreadId]
  );
  existingThread = (normalizeThread(existRows[0]) as EmailThread) || null;

  // If not found by direct threadId and message is inbound, correlate via headers / subject / job / sender
  if (!existingThread && isInbound) {
    // Strategy 1: Correlate via In-Reply-To / References against existing email_messages
    const refIds = [emailData.inReplyTo, emailData.references].filter(Boolean);
    for (const refId of refIds) {
      const { rows: parentRows } = await query(
        'SELECT thread_id FROM relay.email_messages WHERE provider_message_id = $1 LIMIT 1',
        [refId]
      );
      const parentThreadId = parentRows[0]?.thread_id;
      if (parentThreadId) {
        const { rows: tRows } = await query(
          'SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1',
          [parentThreadId]
        );
        const t = (normalizeThread(tRows[0]) as EmailThread) || null;
        if (t) {
          existingThread = t;
          break;
        }
      }
    }

    // Strategy 2: Correlate via sender email + job/submission identifier in subject/body
    if (!existingThread && emailData.fromEmail) {
      const from = String(emailData.fromEmail).trim().toLowerCase();
      const subjectText = `${emailData.subject || ''} ${emailData.fullBodyText || ''}`;
      const jobMatch = subjectText.match(/([0-9a-fA-F]{8})/);
      const jobPrefix = jobMatch ? jobMatch[1].toLowerCase() : null;

      const { rows: candRows } = await query(
        'SELECT * FROM relay.email_threads WHERE latest_sender_email = $1 ORDER BY latest_date DESC LIMIT 20',
        [from]
      );
      const candidateThreads = candRows.map(normalizeThread).filter(Boolean) as EmailThread[];

      if (jobPrefix) {
        existingThread =
          candidateThreads.find((t) => {
            const wf = (t.workflowContext as any) || {};
            const jId = String(wf.jobId || '').toLowerCase();
            const subId = String(wf.submissionId || '').toLowerCase();
            const maskedId = String(wf.maskedCandidateId || '').toLowerCase();
            return (
              jId.startsWith(jobPrefix) ||
              subId.startsWith(jobPrefix) ||
              maskedId.includes(jobPrefix) ||
              (t.subject || '').toLowerCase().includes(jobPrefix)
            );
          }) || null;
      }

      if (!existingThread) {
        existingThread =
          candidateThreads.find((t) => {
            const wf = (t.workflowContext as any) || {};
            return (
              (wf.kind === 'candidate_consent' && t.status === 'Awaiting Consent') ||
              (wf.kind === 'vendor_submission' &&
                (t.status === 'Submitted to Vendor' || t.status === 'Awaiting Vendor Response'))
            );
          }) ||
          candidateThreads[0] ||
          null;
      }
    }
  }

  const threadId = existingThread?.threadId || resolvedThreadId;
  const orchCorrelationId = relayThreadCorrelationId(threadId, emailData.correlationId);

  let replyIntentToStore = String(classification.replyIntent || '');
  let requiresFollowupToStore = Boolean(classification.requiresFollowup);
  let statusToStore = String(classification.status || 'New');
  let priorityToStore = String(classification.priority || 'Low');

  if (isSent && existingThread?.replyIntent && existingThread.replyIntent !== 'Sent') {
    replyIntentToStore = existingThread.replyIntent;
    requiresFollowupToStore = Boolean(existingThread.requiresFollowup);
    statusToStore = existingThread.status || statusToStore;
    priorityToStore = existingThread.priority || priorityToStore;
  }

  const displayName = isSent ? (emailData.toName || emailData.toEmail || 'Recipient') : emailData.fromName;
  const displayEmail = isSent ? emailData.toEmail : emailData.fromEmail;

  await query(
    `INSERT INTO relay.email_threads (
      thread_id, subject, latest_sender, latest_sender_email, latest_date,
      reply_intent, requires_followup, status, priority, candidate_id, vendor_id, correlation_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (thread_id) DO UPDATE SET
      latest_sender = EXCLUDED.latest_sender,
      latest_sender_email = EXCLUDED.latest_sender_email,
      latest_date = EXCLUDED.latest_date,
      reply_intent = EXCLUDED.reply_intent,
      requires_followup = EXCLUDED.requires_followup,
      status = EXCLUDED.status,
      priority = EXCLUDED.priority,
      candidate_id = COALESCE(EXCLUDED.candidate_id, relay.email_threads.candidate_id),
      vendor_id = COALESCE(EXCLUDED.vendor_id, relay.email_threads.vendor_id),
      correlation_id = EXCLUDED.correlation_id`,
    [
      threadId,
      cleanEmailSubject(emailData.subject || ''),
      displayName,
      displayEmail,
      new Date(emailData.date || Date.now()),
      replyIntentToStore,
      requiresFollowupToStore,
      statusToStore,
      priorityToStore,
      candId ?? existingThread?.candidateId ?? null,
      vendorId ?? existingThread?.vendorId ?? null,
      orchCorrelationId,
    ]
  );

  // 4. Upsert Message — store full body for sent mail (no quote stripping)
  const messageId = emailData.id || uuidv4();
  const plainBody = isSent
    ? stripHtmlToText(emailData.fullBodyText || htmlToPlainText(emailData.htmlBody || ''))
    : stripHtmlToText(
        classification.latestBody || emailData.fullBodyText || htmlToPlainText(emailData.htmlBody || ''),
      );
  const rawStore = emailData.htmlBody || emailData.fullBodyText || '';
  await query(
    `INSERT INTO relay.email_messages (
      id, thread_id, from_email, from_name, to_email, subject,
      raw_body, cleaned_body, html_body, attachments, direction, date, provider_message_id, is_bounce
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (id) DO UPDATE SET
      thread_id = EXCLUDED.thread_id,
      raw_body = EXCLUDED.raw_body,
      cleaned_body = EXCLUDED.cleaned_body,
      html_body = EXCLUDED.html_body,
      attachments = EXCLUDED.attachments`,
    [
      messageId,
      threadId,
      emailData.fromEmail || null,
      emailData.fromName || null,
      emailData.toEmail || null,
      emailData.subject || null,
      rawStore,
      plainBody,
      emailData.htmlBody || null,
      JSON.stringify(emailData.attachments || []),
      emailData.direction || 'received',
      new Date(emailData.date || Date.now()),
      emailData.providerMessageId || null,
      classification.mainBucket === 'Bounces',
    ]
  );

  // 5. Upsert Classification
  await query(
    `INSERT INTO relay.email_classifications (
      message_id, thread_id, main_bucket, reply_intent, sender_type,
      priority, requires_followup, candidate_id, vendor_id, classification_reason, confidence_source
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (message_id) DO NOTHING`,
    [
      messageId,
      threadId,
      classification.mainBucket || null,
      classification.replyIntent || null,
      classification.senderType || null,
      classification.priority || null,
      Boolean(classification.requiresFollowup),
      candId || null,
      vendorId || null,
      classification.classificationReason || null,
      classification.confidenceSource === 'llm' ? 'llm' : 'rule',
    ]
  );

  // 6. Follow-up Tracking — never auto-chase portal/marketing mail
  const isPortalIntent =
    classification.replyIntent === 'Portal Notifications' ||
    classification.mainBucket === 'Portal Notifications';

  if (isInbound && requiresFollowupToStore && !isPortalIntent) {
    const dueDate = calculateDueDate(String(classification.replyIntent || ''));
    const draft = await generateSuggestedReply(String(classification.replyIntent || ''), candidate);

    await query(
      `INSERT INTO relay.followups (
        id, thread_id, message_id, candidate_id, vendor_id,
        main_category, reply_type, priority, status, due_date, suggested_reply, followup_reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO NOTHING`,
      [
        uuidv4(),
        threadId,
        messageId,
        candId,
        vendorId,
        classification.mainBucket || null,
        classification.replyIntent || null,
        classification.priority || null,
        'Open',
        dueDate,
        draft.body,
        classification.classificationReason || null,
      ]
    );
  }

  const replyIntent = replyIntentToStore;

  // --- SINGLE orchestration front door (classify → relay.email.classified → intake graph) ---
  if (isInbound) {
    await emitEmailClassified({
      threadId,
      messageId,
      replyIntent,
      subject: emailData.subject || '',
      body: plainBody,
      fromEmail: emailData.fromEmail || '',
      fromName: emailData.fromName,
      requiresFollowup: Boolean(classification.requiresFollowup),
      vendorId: vendorId,
      candidateId: candId,
      confidenceSource: String(classification.confidenceSource || 'rule'),
      correlationId: orchCorrelationId,
    });

    if (replyIntent === 'Requirement Shared') {
      await tryDirectVendorJdIntake({
        threadId,
        messageId,
        subject: emailData.subject || '',
        plainBody,
        htmlBody: emailData.htmlBody || null,
        rawBody: emailData.fullBodyText || emailData.bodyPreview || '',
        fromEmail: emailData.fromEmail || '',
        replyIntent,
        vendorId: vendorId ?? null,
        providerMessageId: emailData.providerMessageId || null,
      });
    }
  }

  // --- Consent reply detection & forwarding to PRISM ---
  // Gmail copies of the same reply can land as sent (own mailbox). Still apply.
  if (emailData.fromEmail && (isInbound || isSent)) {
    const consentThread = await findOpenConsentThread({
      fromEmail: emailData.fromEmail,
      candId,
      subject: emailData.subject || '',
      existing: existingThread,
    });

    if (consentThread?.correlationId) {
      const decision = parseCandidateConsent(plainBody, emailData.subject || '');
      const threadCandidateId = consentThread.candidateId || null;
      const sender = String(emailData.fromEmail).trim().toLowerCase();
      const threadEmail = extractEmail(consentThread.latestSenderEmail);
      const senderMatchesThread = Boolean(sender && threadEmail && sender === threadEmail);
      if (candId && threadCandidateId && candId !== threadCandidateId && !senderMatchesThread) {
        console.warn(
          `[RELAY] Consent thread candidate ${threadCandidateId} does not match inbound candidate ${candId} — skipping`,
        );
      } else {
      const resolvedCandidateId = threadCandidateId || candId;
      console.log(`[RELAY] Inbound email matched consultant consent thread: ${consentThread.threadId} (sender: ${emailData.fromEmail}, decision: ${decision})`);
      if (decision !== 'unknown' && resolvedCandidateId) {
        const cCtx = (consentThread.workflowContext as Record<string, unknown>) || {};
        const nextCtx = {
          ...cCtx,
          consent_responded_at: new Date().toISOString(),
          consent_decision: decision,
        };
        await query(
          `UPDATE relay.email_threads
              SET status = $1, reply_intent = 'Candidate Response', workflow_context = $2
            WHERE thread_id = $3`,
          [
            decision === 'approved' ? 'Consent Received' : 'Consent Declined',
            JSON.stringify(nextCtx),
            consentThread.threadId,
          ]
        );

        await query(
          `UPDATE relay.followups
              SET status = 'Closed', followup_reason = $1
            WHERE thread_id = $2`,
          [`Candidate replied: ${decision}`, consentThread.threadId]
        );

        await emitConsentDecided({
          threadId: consentThread.threadId,
          candidateId: resolvedCandidateId,
          decision: decision === 'approved' ? 'approved' : 'rejected',
          correlationId: consentThread.correlationId,
          bodySnippet: plainBody.slice(0, 500),
          jobId: (consentThread.workflowContext as { jobId?: string })?.jobId,
        });

        const wfCtx = (consentThread.workflowContext as Record<string, any>) || {};
        console.log(`[RELAY] Forwarding candidate consent decision '${decision}' to PRISM (submission: ${wfCtx.submissionId || wfCtx.submission_id || 'unspecified'})`);
        await forwardConsentToPrism({
          submissionId: wfCtx.submissionId || wfCtx.submission_id || null,
          candidateId: resolvedCandidateId,
          jobId: wfCtx.jobId || wfCtx.job_id || null,
          senderEmail: threadEmail || emailData.fromEmail,
          decision: decision === 'approved' ? 'approved' : 'rejected',
          notes: plainBody.slice(0, 500),
          messageId,
          threadId: consentThread.threadId,
        });
      }
      }
    }
  }

  // --- Vendor submission reply detection & forwarding to PRISM ---
  if (isInbound && emailData.fromEmail) {
    let vendorThread: EmailThread | null = null;

    if (existingThread?.workflowContext && (existingThread.workflowContext as any).kind === 'vendor_submission') {
      vendorThread = existingThread;
    } else {
      const { rows: byRows } = await query(
        'SELECT * FROM relay.email_threads WHERE thread_id = $1 LIMIT 1',
        [threadId]
      );
      const byThread = (normalizeThread(byRows[0]) as EmailThread) || null;
      if (byThread?.workflowContext && (byThread.workflowContext as any).kind === 'vendor_submission') {
        vendorThread = byThread;
      }
    }

    if (vendorThread?.correlationId) {
      const decision = parseVendorResponse(plainBody, emailData.subject || '');
      console.log(`[RELAY] Inbound email matched vendor submission thread: ${vendorThread.threadId} (sender: ${emailData.fromEmail}, decision: ${decision})`);
      if (decision !== 'unknown') {
        const wfCtx = (vendorThread.workflowContext as Record<string, any>) || {};
        console.log(`[RELAY] Forwarding vendor response '${decision}' to PRISM (submission: ${wfCtx.submissionId || wfCtx.submission_id || vendorThread.correlationId})`);
        await forwardVendorResponseToPrism({
          submissionId: wfCtx.submissionId || wfCtx.submission_id || vendorThread.correlationId || null,
          candidateId: wfCtx.candidateId || (vendorThread.candidateId as any) || null,
          jobId: wfCtx.jobId || wfCtx.job_id || null,
          senderEmail: emailData.fromEmail,
          decision: decision === 'accepted' ? 'accepted' : 'rejected',
          notes: plainBody.slice(0, 500),
          messageId,
          threadId: vendorThread.threadId,
        });
      }
    }
  }

  // --- Autonomous recruiter replies (JD ack, interview, candidate responses) ---
  if (isInbound && requiresFollowupToStore && !isPortalIntent) {
    const { rows: priorRows } = await query(
      'SELECT * FROM relay.email_messages WHERE thread_id = $1',
      [threadId]
    );
    const priorMsgs = priorRows.map(normalizeMessage).filter((m): m is EmailMessage => Boolean(m));
    const sortedMsgs = priorMsgs.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
    const threadHistory = buildConversationSummary(sortedMsgs, 10);
    const workflowContext = (existingThread?.workflowContext || {}) as Record<string, unknown>;

    const auto = await tryAutonomousReply({
      threadId,
      messageId,
      replyIntent,
      subject: emailData.subject || '',
      body: plainBody,
      fromName: emailData.fromName || '',
      fromEmail: emailData.fromEmail || '',
      candidate: replyIntent === 'Requirement Shared' ? undefined : candidate || undefined,
      inReplyTo: emailData.providerMessageId,
      threadHistory,
      workflowContext,
      priorMessages: sortedMsgs.map((m) => ({ direction: m.direction, date: m.date })),
    });
    if (auto.sent) {
      console.log(`[inboxAgent] auto-reply sent for ${threadId}: ${replyIntent}`);
    } else if (auto.reason !== 'RELAY_AUTO_REPLY disabled') {
      console.log(`[inboxAgent] auto-reply skipped for ${threadId}: ${auto.reason}`);
    }
  }
}
