import { FastifyInstance } from 'fastify';
import { db, sql } from '../db';
import { emailThreads, emailMessages, followups } from '../db/schema';
import { eq, desc, and, sql as dsql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { EmailSenderFactory } from '../connectors/sender';
import { draftReplyFromContext } from '../drafting/replyDrafter';
import { calculateDueDate } from '../followups/followupService';
import { findRegisteredCandidateByEmail, findRegisteredCandidateById } from '../matching/candidateRegistry';
import { clearRegisteredVendorCache } from '../matching/vendorRegistry';
import { buildConsentEmail, buildConsentReminderEmail, fetchJobContextForConsent } from './consentEmail';
import { buildInterviewEmailContent, type InterviewEmailTemplate } from './interviewEmail';

const CONSENT_INTENT = 'Candidate Consent Request';
const PROFILE_DRAFT_INTENT = 'Profile Submission Draft';

function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email || !String(email).trim()) return true;
  const e = String(email).trim().toLowerCase();
  return /@email\.com$/i.test(e) || /@example\.com$/i.test(e) || /@test\.com$/i.test(e);
}

async function candidateBelongsToJobOwner(candidateId: string, jobId: string): Promise<boolean> {
  try {
    const rows = await sql<{ ok: boolean }[]>`
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
    console.warn('[relay] candidateBelongsToJobOwner failed:', e);
    return false;
  }
}

async function hasConsentThreadForJob(candidateId: string, jobId: string): Promise<boolean> {
  const rows = await db
    .select({ threadId: emailThreads.threadId })
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.candidateId, candidateId as any),
        // drizzle's sql, not postgres.js's: this is inside a drizzle where()
        dsql`${emailThreads.workflowContext}->>'kind' = 'candidate_consent'`,
        dsql`${emailThreads.workflowContext}->>'jobId' = ${jobId}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function notifyConsentSent(args: {
  candidateId: string;
  jobId: string;
  email?: string;
  correlationId?: string;
  matchScore?: number;
}) {
  const base = (process.env.SYNTRA_API_URL || 'http://localhost:4000').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/internal/pipeline/consent-sent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(
        `[relay] consent-sent activity log failed (${res.status}): ${text.slice(0, 120)}`,
      );
    }
  } catch (err) {
    console.warn(
      `[relay] consent-sent activity unreachable: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/** Orchestrator-facing internal API for consent / profile automation. */
export function registerInternalRoutes(app: FastifyInstance) {
  app.post('/internal/shortlist/pending', async (request, reply) => {
    const body = request.body as {
      jobId?: string;
      requirement_id?: string;
      relay_thread_id?: string;
      vendor_email?: string;
      match_job_id?: string;
      result_count?: number;
      top_candidates?: Array<Record<string, unknown>>;
    };

    const threadId = body.relay_thread_id;
    const jobId = body.jobId || body.requirement_id;
    if (!threadId || !jobId) {
      return reply.status(400).send({ error: 'relay_thread_id and jobId required' });
    }

    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.threadId, threadId)).limit(1);
    if (!thread) {
      return reply.status(404).send({ error: 'thread not found', relay_thread_id: threadId });
    }

    const ctx = (thread.workflowContext as Record<string, unknown>) || {};
    await db
      .update(emailThreads)
      .set({
        workflowContext: {
          ...ctx,
          kind: 'vendor_jd_shortlist',
          jobId,
          shortlist_status: 'pending_approval',
          match_job_id: body.match_job_id ?? ctx.match_job_id,
          result_count: body.result_count ?? body.top_candidates?.length ?? 0,
          top_candidates: body.top_candidates ?? [],
          vendor_email: body.vendor_email ?? thread.latestSenderEmail,
          updated_at: new Date().toISOString(),
        },
      })
      .where(eq(emailThreads.threadId, threadId));

    return {
      status: 'pending_approval',
      relay_thread_id: threadId,
      jobId,
      top_count: body.top_candidates?.length ?? 0,
    };
  });

  app.post('/internal/shortlist/approved', async (request, reply) => {
    const body = request.body as {
      jobId?: string;
      relay_thread_id?: string;
      top_candidates?: Array<Record<string, unknown>>;
      consent?: Record<string, unknown>;
    };

    const threadId = body.relay_thread_id;
    if (!threadId) return reply.status(400).send({ error: 'relay_thread_id required' });

    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.threadId, threadId)).limit(1);
    if (!thread) return reply.status(404).send({ error: 'thread not found' });

    const ctx = (thread.workflowContext as Record<string, unknown>) || {};
    await db
      .update(emailThreads)
      .set({
        workflowContext: {
          ...ctx,
          shortlist_status: 'approved',
          consent_sent_at: new Date().toISOString(),
          consent: body.consent ?? ctx.consent,
          top_candidates: body.top_candidates ?? ctx.top_candidates,
        },
      })
      .where(eq(emailThreads.threadId, threadId));

    return { status: 'approved', relay_thread_id: threadId, jobId: body.jobId ?? ctx.jobId };
  });

  app.post('/internal/consent/send', async (request, reply) => {
    const body = request.body as {
      jobId?: string;
      requirement_id?: string;
      submissionId?: string;
      submission_id?: string;
      correlation_id?: string;
      subject?: string;
      body?: string;
      bodyText?: string;
      top_candidates?: Array<string | { id: string; email?: string; name?: string; score?: number; submissionId?: string; submission_id?: string }>;
      vendor_thread_id?: string;
      vendor_email?: string;
      force?: boolean;
    };

    const jobId = body.jobId || body.requirement_id;
    const candidates = body.top_candidates || [];
    const force = Boolean(body.force);
    if (!jobId || !candidates.length) {
      return reply.status(400).send({ error: 'jobId and top_candidates required' });
    }

    if (body.vendor_thread_id && !force) {
      const [vendorThread] = await db
        .select()
        .from(emailThreads)
        .where(eq(emailThreads.threadId, body.vendor_thread_id))
        .limit(1);
      const vCtx = (vendorThread?.workflowContext as Record<string, unknown>) || {};
      const priorIds = new Set(
        (
          (vCtx.consent as { consent_threads?: Array<{ candidate_id?: string }> })?.consent_threads ||
          []
        ).map((t) => t.candidate_id).filter(Boolean),
      );
      const allAlreadySent = candidates.every((raw) => {
        const id = typeof raw === 'string' ? raw : raw.id;
        return priorIds.has(id);
      });
      if (
        allAlreadySent &&
        Number(vCtx.consent_sent_count ?? 0) > 0 &&
        vCtx.shortlist_status === 'consent_sent'
      ) {
        return {
          status: 'already_sent',
          sent_count: 0,
          thread_ids: [],
          consent_threads: [],
          correlation_id: body.correlation_id || null,
          send_errors: [],
        };
      }
    }

    const sender = EmailSenderFactory.getSender();
    const threadIds: string[] = [];
    const consentThreads: Array<{ candidate_id: string; thread_id: string; email?: string; submission_id?: string }> = [];
    const sendErrors: Array<{ candidate_id: string; email: string; reason: string }> = [];
    let sentCount = 0;
    const correlationId = body.correlation_id || uuidv4();
    const jobContext = jobId ? await fetchJobContextForConsent(jobId) : {};

    for (const raw of candidates.slice(0, 5)) {
      const candidateId = typeof raw === 'string' ? raw : raw.id;
      const subId = typeof raw === 'object' ? (raw.submissionId || raw.submission_id) : (body.submissionId || body.submission_id);
      const registered = await findRegisteredCandidateById(candidateId);
      const email = (registered?.email || (typeof raw === 'object' ? raw.email : '') || '').trim();
      const candidateName =
        registered?.name || (typeof raw === 'object' ? raw.name : null) || 'Candidate';

      if (!email) {
        sendErrors.push({ candidate_id: candidateId, email: '', reason: 'missing_email' });
        continue;
      }

      if (isPlaceholderEmail(email)) {
        sendErrors.push({
          candidate_id: candidateId,
          email,
          reason: 'placeholder_email_update_candidate_in_resumes',
        });
        continue;
      }

      if (!force && (await hasConsentThreadForJob(candidateId, jobId))) {
        sendErrors.push({
          candidate_id: candidateId,
          email,
          reason: 'consent_already_sent_for_job',
        });
        continue;
      }

      if (!(await candidateBelongsToJobOwner(candidateId, jobId))) {
        sendErrors.push({
          candidate_id: candidateId,
          email,
          reason: 'candidate_not_in_recruiter_pool',
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
      try {
        ok = await sender.sendEmail(email, subject, bodyText);
      } catch (sendErr) {
        sendErrors.push({
          candidate_id: candidateId,
          email,
          reason: sendErr instanceof Error ? sendErr.message : 'send_exception',
        });
        continue;
      }
      if (!ok) {
        sendErrors.push({ candidate_id: candidateId, email, reason: 'smtp_or_gmail_send_failed' });
        continue;
      }

      sentCount++;
      const matchScore =
        typeof raw === 'object' && raw !== null && 'score' in raw
          ? Number((raw as { score?: number }).score)
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

      await db.insert(emailThreads).values({
        threadId,
        subject,
        latestSender: candidateName || email,
        latestSenderEmail: email,
        latestDate: new Date(),
        replyIntent: CONSENT_INTENT,
        requiresFollowup: true,
        status: 'Awaiting Consent',
        priority: 'High',
        candidateId: candidateId as any,
        correlationId,
        workflowContext: {
          kind: 'candidate_consent',
          jobId,
          submissionId: subId || null,
          vendor_thread_id: body.vendor_thread_id,
          vendor_email: body.vendor_email,
          correlation_id: correlationId,
          consent_sent_at: new Date().toISOString(),
          reminder_count: 0,
        },
      });

      await db.insert(emailMessages).values({
        id: messageId,
        threadId,
        fromEmail: process.env.GMAIL_SENDER_EMAIL || process.env.SMTP_USERNAME || process.env.RELAY_SMTP_USER || 'relay@local',
        fromName: process.env.RELAY_RECRUITER_NAME || 'Bench Sales',
        toEmail: email,
        subject,
        rawBody: bodyText,
        cleanedBody: bodyText,
        direction: 'sent',
        date: new Date(),
      });

      await db.insert(followups).values({
        id: uuidv4(),
        threadId,
        messageId,
        candidateId: candidateId as any,
        replyType: CONSENT_INTENT,
        priority: 'High',
        status: 'Open',
        dueDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
        suggestedReply: bodyText,
        followupReason: `Consent request for job ${jobId}`,
      });
    }

    if (sentCount > 0 && body.vendor_thread_id) {
      const [vendorThread] = await db
        .select()
        .from(emailThreads)
        .where(eq(emailThreads.threadId, body.vendor_thread_id))
        .limit(1);
      if (vendorThread) {
        const vCtx = (vendorThread.workflowContext as Record<string, unknown>) || {};
        const prevCount = Number(vCtx.consent_sent_count ?? 0);
        const prevThreads =
          (vCtx.consent as { consent_threads?: typeof consentThreads })?.consent_threads || [];
        await db
          .update(emailThreads)
          .set({
            workflowContext: {
              ...vCtx,
              shortlist_status: 'consent_sent',
              consent_sent_at: new Date().toISOString(),
              consent_sent_count: prevCount + sentCount,
              consent: {
                status: 'sent',
                sent_count: prevCount + sentCount,
                consent_threads: [...prevThreads, ...consentThreads],
                correlation_id: correlationId,
                send_errors: sendErrors,
              },
            },
          })
          .where(eq(emailThreads.threadId, body.vendor_thread_id));
      }
    }

    return {
      status: sentCount ? 'sent' : 'no_recipients',
      sent_count: sentCount,
      thread_ids: threadIds,
      consent_threads: consentThreads,
      correlation_id: correlationId,
      send_errors: sendErrors,
    };
  });

  app.post('/internal/consent/remind', async (request, reply) => {
    const body = request.body as {
      thread_id?: string;
      candidate_id?: string;
      reminder_count?: number;
    };
    if (!body.thread_id) return reply.status(400).send({ error: 'thread_id required' });

    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.threadId, body.thread_id)).limit(1);
    if (!thread?.latestSenderEmail) return reply.status(404).send({ error: 'thread not found' });

    const ctx = (thread.workflowContext as Record<string, unknown>) || {};
    const jobId = typeof ctx.jobId === 'string' ? ctx.jobId : null;
    const jobContext = jobId ? await fetchJobContextForConsent(jobId) : {};
    const reminderNum = (body.reminder_count ?? Number(ctx.reminder_count ?? 0) + 1) as 1 | 2;

    let candidateName = thread.latestSender || 'Candidate';
    if (thread.candidateId) {
      const reg = await findRegisteredCandidateById(String(thread.candidateId));
      if (reg?.name) candidateName = reg.name;
    }

    const { subject, body: reminderBody } = buildConsentReminderEmail(candidateName, jobContext, reminderNum);

    const lastMessages = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.threadId, body.thread_id))
      .orderBy(desc(emailMessages.date))
      .limit(1);
    const lastMessage = lastMessages[0];

    const sender = EmailSenderFactory.getSender();
    const ok = await sender.sendEmail(
      thread.latestSenderEmail,
      subject.startsWith('Re:') ? subject : `RE: ${thread.subject || subject}`,
      reminderBody,
      lastMessage?.providerMessageId || undefined,
    );

    if (ok) {
      await db
        .update(emailThreads)
        .set({
          workflowContext: {
            ...ctx,
            reminder_count: reminderNum,
            last_reminded_at: new Date().toISOString(),
            last_reminder_number: reminderNum,
          },
        })
        .where(eq(emailThreads.threadId, body.thread_id));
    }

    return {
      status: ok ? 'reminded' : 'send_failed',
      thread_id: body.thread_id,
      reminder_count: reminderNum,
    };
  });

  app.post('/internal/profile/draft', async (request, reply) => {
    const body = request.body as {
      jobId?: string;
      candidate_id?: string;
      vendor_thread_id?: string;
      vendor_email?: string;
      correlation_id?: string;
    };

    const vendorEmail = body.vendor_email;
    if (!body.candidate_id || (!vendorEmail && !body.vendor_thread_id)) {
      return reply.status(400).send({ error: 'candidate_id and vendor destination required' });
    }

    let toEmail = vendorEmail || '';
    let subject = `Profile submission — ${body.jobId || 'requirement'}`;
    let inReplyTo: string | undefined;

    if (body.vendor_thread_id) {
      const [vendorThread] = await db
        .select()
        .from(emailThreads)
        .where(eq(emailThreads.threadId, body.vendor_thread_id))
        .limit(1);
      if (vendorThread) {
        toEmail = toEmail || vendorThread.latestSenderEmail || '';
        subject = `RE: ${vendorThread.subject || subject}`;
      }
      const msgs = await db
        .select()
        .from(emailMessages)
        .where(eq(emailMessages.threadId, body.vendor_thread_id))
        .orderBy(desc(emailMessages.date))
        .limit(1);
      inReplyTo = msgs[0]?.providerMessageId || undefined;
    }

    if (!toEmail) return reply.status(400).send({ error: 'vendor email not found' });

    const candidate =
      (await findRegisteredCandidateById(body.candidate_id)) ||
      ({ id: body.candidate_id, name: 'Candidate' } as { id: string; name: string });

    const draft = await draftReplyFromContext({
      subject,
      body: `Submitting profile for ${(candidate as any).name || 'candidate'} against job ${body.jobId}.`,
      fromName: 'Vendor',
      replyIntent: 'Need Resume',
      requiresFollowup: false,
      priority: 'High',
    });

    const draftId = uuidv4();
    const threadId = uuidv4();
    const messageId = uuidv4();

    await db.insert(emailThreads).values({
      threadId,
      subject: draft.subject,
      latestSender: toEmail,
      latestSenderEmail: toEmail,
      latestDate: new Date(),
      replyIntent: PROFILE_DRAFT_INTENT,
      requiresFollowup: false,
      status: 'Draft — Recruiter Review',
      priority: 'High',
      candidateId: body.candidate_id as any,
      correlationId: body.correlation_id || null,
      workflowContext: {
        kind: 'profile_submission_draft',
        draft_id: draftId,
        jobId: body.jobId,
        candidate_id: body.candidate_id,
        vendor_thread_id: body.vendor_thread_id,
        vendor_email: toEmail,
        in_reply_to: inReplyTo,
        status: 'pending_recruiter_review',
      },
    });

    await db.insert(emailMessages).values({
      id: messageId,
      threadId,
      fromEmail: process.env.GMAIL_SENDER_EMAIL || process.env.EMAIL_FROM || 'relay@local',
      fromName: process.env.RELAY_RECRUITER_NAME || 'Bench Sales',
      toEmail,
      subject: draft.subject,
      rawBody: draft.body,
      cleanedBody: draft.body,
      direction: 'draft',
      date: new Date(),
    });

    return {
      status: 'draft_ready',
      draft_id: draftId,
      thread_id: threadId,
      candidate_id: body.candidate_id,
      vendor_email: toEmail,
      subject: draft.subject,
      body_preview: draft.body.slice(0, 500),
      requires_recruiter_review: true,
    };
  });

  app.post('/internal/profile/send', async (request, reply) => {
    const body = request.body as {
      jobId?: string;
      job_id?: string;
      submissionId?: string;
      submission_id?: string;
      candidate_id?: string;
      candidateId?: string;
      vendor_thread_id?: string;
      vendor_email?: string;
      vendor_name?: string;
      job_title?: string;
      masked_profile?: Record<string, any>;
      rate?: number | string;
      rate_type?: string;
      availability?: string;
    };

    const vendorEmail = body.vendor_email;
    const submissionId = body.submissionId || body.submission_id;
    const candidateId = body.candidate_id || body.candidateId;
    const jobId = body.jobId || body.job_id || 'Requirement';

    if (!candidateId || (!vendorEmail && !body.vendor_thread_id)) {
      return reply.status(400).send({ error: 'candidate_id and vendor destination required' });
    }

    let toEmail = vendorEmail || '';
    let inReplyTo: string | undefined;

    if (body.vendor_thread_id) {
      const [vendorThread] = await db
        .select()
        .from(emailThreads)
        .where(eq(emailThreads.threadId, body.vendor_thread_id))
        .limit(1);
      if (vendorThread) {
        toEmail = toEmail || vendorThread.latestSenderEmail || '';
      }
      const msgs = await db
        .select()
        .from(emailMessages)
        .where(eq(emailMessages.threadId, body.vendor_thread_id))
        .orderBy(desc(emailMessages.date))
        .limit(1);
      inReplyTo = msgs[0]?.providerMessageId || undefined;
    }

    if (!toEmail) return reply.status(400).send({ error: 'vendor email not found' });

    const jobTitle = body.job_title || 'Open Position';
    const vendorName = body.vendor_name || 'Hiring Team';
    const masked = body.masked_profile || {};
    const candidateIdRef = masked.maskedCandidateId || `CAND-${String(candidateId).slice(0, 8).toUpperCase()}`;
    const candidateRole = masked.headline || masked.role || jobTitle;
    const experienceYears = masked.totalExperience || masked.experience_years || 'Relevant';
    const skills = Array.isArray(masked.skills) ? masked.skills.join(', ') : (masked.skills || 'Specified in profile');
    const location = masked.location || 'Remote / Open';
    const rateDisplay = body.rate ? `$${body.rate}/${(body.rate_type || 'HOURLY').toLowerCase() === 'hourly' ? 'hr' : 'yr'}` : (masked.rate ? `$${masked.rate}/hr` : 'Negotiable / Market Rate');
    const availability = body.availability || masked.availability || 'Immediate / 2 Weeks';
    const summary = masked.summary || masked.profile_summary || 'Experienced professional qualified and available for the position.';

    const subject = `Candidate Submission: ${jobTitle} — ${candidateIdRef} [SUB-REF: ${submissionId || candidateId}]`;

    const bodyText = `Hi ${vendorName},

We have an available candidate who is well-matched for the ${jobTitle} position.

--- Candidate Summary ---
• Candidate ID: ${candidateIdRef}
• Role: ${candidateRole}
• Experience: ${experienceYears} Years
• Key Skills: ${skills}
• Location: ${location}
• Rate: ${rateDisplay} (${body.rate_type || 'C2C'})
• Availability: ${availability}

--- Profile Overview ---
${summary}

Please let us know if you would like to proceed with this candidate for the ${jobTitle} position.

Best regards,
Recruiting Team`;

    const sender = EmailSenderFactory.getSender();
    const ok = await sender.sendEmail(toEmail, subject, bodyText, inReplyTo);
    if (!ok) {
      return reply.status(500).send({ error: 'Failed to dispatch email via provider', status: 'send_failed' });
    }

    const threadId = body.vendor_thread_id || uuidv4();
    const messageId = uuidv4();

    await db
      .insert(emailThreads)
      .values({
        threadId,
        subject,
        latestSender: vendorName,
        latestSenderEmail: toEmail,
        latestDate: new Date(),
        replyIntent: 'Vendor Profile Submission',
        requiresFollowup: true,
        status: 'Submitted to Vendor',
        priority: 'High',
        candidateId: (candidateId.length === 36 ? candidateId : null) as any,
        correlationId: submissionId || candidateId,
        workflowContext: {
          kind: 'vendor_submission',
          submissionId: submissionId || null,
          submission_id: submissionId || null,
          jobId: jobId,
          job_id: jobId,
          candidateId: candidateId,
          vendorEmail: toEmail,
          vendorName: vendorName,
          jobTitle: jobTitle,
        },
      } as any)
      .onConflictDoUpdate({
        target: emailThreads.threadId,
        set: {
          workflowContext: {
            kind: 'vendor_submission',
            submissionId: submissionId || null,
            submission_id: submissionId || null,
            jobId: jobId,
            job_id: jobId,
            candidateId: candidateId,
            vendorEmail: toEmail,
            vendorName: vendorName,
            jobTitle: jobTitle,
          },
          status: 'Submitted to Vendor',
        },
      });

    await db.insert(emailMessages).values({
      id: messageId,
      threadId,
      fromEmail: process.env.RELAY_SMTP_USER || process.env.GMAIL_USER || 'relay@local',
      fromName: process.env.RELAY_RECRUITER_NAME || 'Bench Sales',
      toEmail: toEmail,
      subject,
      rawBody: bodyText,
      cleanedBody: bodyText,
      direction: 'sent',
      date: new Date(),
    });

    return {
      status: 'sent',
      submissionId: submissionId,
      candidate_id: candidateId,
      vendor_email: toEmail,
      thread_id: threadId,
      message_id: messageId,
    };
  });

  /** Bust in-process vendor registry after onboarding / approval in Syntra UI. */
  app.post('/internal/vendors/cache-clear', async () => {
    clearRegisteredVendorCache();
    return { ok: true };
  });

  /**
   * Practice interview outbound mail — same Gmail API path as Smart Inbox.
   * Called by interview-api via INTERVIEW_EMAIL_PROVIDER=relay (through :4000 proxy).
   */
  app.post('/internal/interview/send', async (request, reply) => {
    const body = request.body as {
      to?: string;
      template?: InterviewEmailTemplate;
      data?: Record<string, unknown>;
    };

    if (!body.to?.trim()) {
      return reply.status(400).send({ error: 'to required' });
    }

    const template = body.template;

    if (
      template !== 'session_invite' &&
      template !== 'session_completed' &&
      template !== 'retake_invite'
    ) {
      return reply
        .status(400)
        .send({
          error:
            'template must be session_invite | session_completed | retake_invite',
        });
    }

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
      const senderDetail =
        (sender as { lastError?: string | null }).lastError?.trim() || '';
      const hint = !process.env.GMAIL_REFRESH_TOKEN
        ? 'Gmail OAuth not configured — set GMAIL_REFRESH_TOKEN, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET'
        : !process.env.GMAIL_SENDER_EMAIL
          ? 'GMAIL_SENDER_EMAIL is missing'
          : senderDetail ||
            'Gmail API and SMTP both failed — check token expiry, network connectivity, or Gmail send quota';
      return reply.status(502).send({
        error: 'send_failed',
        ok: false,
        hint,
        detail: senderDetail || undefined,
      });
    }

    return {
      ok: true,
      messageId: `relay-interview-${Date.now()}`,
      template,
      to: body.to.trim(),
    };
  });
}
