import { db } from '../db';
import { emailMessages, emailClassifications, emailThreads, followups } from '../db/schema';
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
import { eq, desc } from 'drizzle-orm';

async function findOpenConsentThread(opts: {
  fromEmail: string;
  candId: string | null;
  subject: string;
  existing?: typeof emailThreads.$inferSelect | null;
}) {
  const existingCtx = (opts.existing?.workflowContext as Record<string, unknown>) || {};
  if (existingCtx.kind === 'candidate_consent' && opts.existing?.correlationId) {
    if (opts.existing.status === 'Awaiting Consent' || opts.existing.replyIntent === 'Candidate Consent Request') {
      return opts.existing;
    }
  }

  const from = String(opts.fromEmail || '').trim().toLowerCase();
  const subj = subjectKey(opts.subject || '');

  const open = await db
    .select()
    .from(emailThreads)
    .where(eq(emailThreads.status, 'Awaiting Consent'))
    .orderBy(desc(emailThreads.latestDate))
    .limit(200);

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

  let [existingThread] = await db
    .select()
    .from(emailThreads)
    .where(eq(emailThreads.threadId, resolvedThreadId))
    .limit(1);

  // If not found by direct threadId and message is inbound, correlate via headers / subject / job / sender
  if (!existingThread && isInbound) {
    // Strategy 1: Correlate via In-Reply-To / References against existing email_messages
    const refIds = [emailData.inReplyTo, emailData.references].filter(Boolean);
    for (const refId of refIds) {
      const [parentMsg] = await db
        .select({ threadId: emailMessages.threadId })
        .from(emailMessages)
        .where(eq(emailMessages.providerMessageId, refId))
        .limit(1);
      if (parentMsg?.threadId) {
        const [t] = await db
          .select()
          .from(emailThreads)
          .where(eq(emailThreads.threadId, parentMsg.threadId))
          .limit(1);
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

      const candidateThreads = await db
        .select()
        .from(emailThreads)
        .where(eq(emailThreads.latestSenderEmail, from))
        .orderBy(desc(emailThreads.latestDate))
        .limit(20);

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
              t.subject.toLowerCase().includes(jobPrefix)
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

  await db.insert(emailThreads).values({
    threadId,
    subject: cleanEmailSubject(emailData.subject || ''),
    latestSender: displayName,
    latestSenderEmail: displayEmail,
    latestDate: new Date(emailData.date || Date.now()),
    replyIntent: replyIntentToStore,
    requiresFollowup: requiresFollowupToStore,
    status: statusToStore,
    priority: priorityToStore,
    candidateId: candId ?? existingThread?.candidateId ?? null,
    vendorId: vendorId ?? existingThread?.vendorId ?? null,
    correlationId: orchCorrelationId,
  }).onConflictDoUpdate({
    target: emailThreads.threadId,
    set: {
      latestSender: displayName,
      latestSenderEmail: displayEmail,
      latestDate: new Date(emailData.date || Date.now()),
      replyIntent: replyIntentToStore,
      requiresFollowup: requiresFollowupToStore,
      status: statusToStore,
      priority: priorityToStore,
      candidateId: candId ?? existingThread?.candidateId ?? undefined,
      vendorId: vendorId ?? existingThread?.vendorId ?? undefined,
      correlationId: orchCorrelationId,
    },
  });

  // 4. Upsert Message — store full body for sent mail (no quote stripping)
  const messageId = emailData.id || uuidv4();
  const plainBody = isSent
    ? stripHtmlToText(emailData.fullBodyText || htmlToPlainText(emailData.htmlBody || ''))
    : stripHtmlToText(
        classification.latestBody || emailData.fullBodyText || htmlToPlainText(emailData.htmlBody || ''),
      );
  const rawStore = emailData.htmlBody || emailData.fullBodyText || '';
  await db.insert(emailMessages).values({
    id: messageId,
    threadId,
    fromEmail: emailData.fromEmail,
    fromName: emailData.fromName,
    toEmail: emailData.toEmail,
    subject: emailData.subject,
    rawBody: rawStore,
    cleanedBody: plainBody,
    htmlBody: emailData.htmlBody || null,
    attachments: emailData.attachments || [],
    direction: emailData.direction,
    date: new Date(emailData.date || Date.now()),
    providerMessageId: emailData.providerMessageId,
    isBounce: classification.mainBucket === 'Bounces'
  }).onConflictDoUpdate({
    target: emailMessages.id,
    set: {
      threadId,
      rawBody: rawStore,
      cleanedBody: plainBody,
      htmlBody: emailData.htmlBody || null,
      attachments: emailData.attachments || [],
    },
  });

  // 5. Upsert Classification
  await db.insert(emailClassifications).values({
    messageId,
    threadId,
    mainBucket: classification.mainBucket,
    replyIntent: classification.replyIntent,
    senderType: classification.senderType,
    priority: classification.priority,
    requiresFollowup: classification.requiresFollowup,
    candidateId: candId,
    vendorId: vendorId,
    classificationReason: classification.classificationReason,
    confidenceSource: classification.confidenceSource === 'llm' ? 'llm' : 'rule'
  } as any).onConflictDoNothing();

  // 6. Follow-up Tracking — never auto-chase portal/marketing mail
  const isPortalIntent =
    classification.replyIntent === 'Portal Notifications' ||
    classification.mainBucket === 'Portal Notifications';

  if (isInbound && requiresFollowupToStore && !isPortalIntent) {
    const dueDate = calculateDueDate(String(classification.replyIntent || ''));
    const draft = await generateSuggestedReply(String(classification.replyIntent || ''), candidate);

    await db.insert(followups).values({
      id: uuidv4(),
      threadId,
      messageId,
      candidateId: candId,
      vendorId: vendorId,
      mainCategory: classification.mainBucket,
      replyType: classification.replyIntent,
      priority: classification.priority,
      status: 'Open',
      dueDate: dueDate,
      suggestedReply: draft.body,
      followupReason: classification.classificationReason
    } as any).onConflictDoNothing();
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
        await db
          .update(emailThreads)
          .set({
            status: decision === 'approved' ? 'Consent Received' : 'Consent Declined',
            replyIntent: 'Candidate Response',
            workflowContext: {
              ...cCtx,
              consent_responded_at: new Date().toISOString(),
              consent_decision: decision,
            },
          })
          .where(eq(emailThreads.threadId, consentThread.threadId));

        await db
          .update(followups)
          .set({ status: 'Closed', followupReason: `Candidate replied: ${decision}` })
          .where(eq(followups.threadId, consentThread.threadId));

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
    let vendorThread = null as typeof emailThreads.$inferSelect | null;

    if (existingThread?.workflowContext && (existingThread.workflowContext as any).kind === 'vendor_submission') {
      vendorThread = existingThread;
    } else {
      const [byThread] = await db
        .select()
        .from(emailThreads)
        .where(eq(emailThreads.threadId, threadId))
        .limit(1);
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
    const priorMsgs = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.threadId, threadId));
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
