/**
 * Direct Syntra ASTRA intake for Requirement Shared emails.
 * Runs even when RELAY_PLATFORM_EVENTS=0 / orchestrator worker is down.
 * Dedupe is handled by ASTRA (message_id / content hash).
 */

import { pickDisplayBody } from '../utils/htmlText';

function allowExternalStaffingIntake(): boolean {
  const raw = process.env.JD_INTAKE_ALLOW_STAFFING_EXTERNAL;
  if (raw === undefined || raw === '') return true;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export async function triggerJdMatchConsentPipeline(args: {
  jobId: string;
  relayThreadId: string;
}): Promise<{ ok: boolean; skipped?: string; reason?: string }> {
  const base = (process.env.SYNTRA_API_URL || `http://127.0.0.1:${process.env.SYNTRA_PORT || '4000'}`).replace(/\/$/, '');

  try {
    const res = await fetch(`${base}/internal/jobs/${args.jobId}/pipeline/match-consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relay_thread_id: args.relayThreadId,
        jobId: args.jobId,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const reason = String(data.error || data.message || res.status);
      console.warn(`[relay/jdIntake] match-consent pipeline failed: ${reason}`);
      return { ok: false, reason };
    }

    console.log(
      `[relay/jdIntake] match+consent pipeline job=${args.jobId} thread=${args.relayThreadId}`,
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[relay/jdIntake] match-consent request failed: ${message}`);
    return { ok: false, reason: message };
  }
}

export async function tryDirectVendorJdIntake(args: {
  threadId: string;
  messageId: string;
  subject: string;
  plainBody: string;
  htmlBody?: string | null;
  rawBody?: string;
  fromEmail: string;
  replyIntent: string;
  vendorId?: string | null;
  providerMessageId?: string | null;
}): Promise<{ ok: boolean; skipped?: string; jobId?: string; reason?: string }> {
  if (args.replyIntent !== 'Requirement Shared') {
    return { ok: false, skipped: 'not_requirement_shared' };
  }
  if (!args.vendorId && !allowExternalStaffingIntake()) {
    return { ok: false, skipped: 'no_registered_vendor' };
  }

  if (process.env.RELAY_DIRECT_JD_INTAKE === '0') {
    return { ok: false, skipped: 'RELAY_DIRECT_JD_INTAKE=0' };
  }

  const display = pickDisplayBody(
    args.plainBody || '',
    args.rawBody || args.plainBody || '',
    args.htmlBody || null,
  );

  const base = (process.env.SYNTRA_API_URL || `http://127.0.0.1:${process.env.SYNTRA_PORT || '4000'}`).replace(/\/$/, '');

  try {
    const res = await fetch(`${base}/internal/astra/intake/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: args.subject || '',
        body: display.plain,
        from: args.fromEmail,
        from_email: args.fromEmail,
        message_id: args.providerMessageId || args.messageId,
        thread_id: args.threadId,
        relay_thread_id: args.threadId,
        reply_intent: 'Requirement Shared',
        vendor_id: args.vendorId || undefined,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const reason = String(data.rejectReason || data.error || data.message || res.status);
      console.warn(`[relay/jdIntake] Syntra rejected vendor JD: ${reason}`);
      return { ok: false, reason };
    }

    if (data.rejected) {
      return { ok: false, reason: String(data.rejectReason || 'rejected') };
    }

    const jobId = String(data.jobId || (data.job as { id?: string } | undefined)?.id || data.requirement_id || '');
    const isDuplicate = Boolean(data.duplicate);
    if (jobId) {
      console.log(
        `[relay/jdIntake] JD ${isDuplicate ? 'duplicate' : 'ingested'} job=${jobId} thread=${args.threadId}`,
      );
      await triggerJdMatchConsentPipeline({ jobId, relayThreadId: args.threadId });
    }
    return { ok: true, jobId: jobId || undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[relay/jdIntake] Syntra intake failed: ${message}`);
    return { ok: false, reason: message };
  }
}
