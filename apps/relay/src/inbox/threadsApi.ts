import { db, sql } from '../db';
import { emailThreads, followups, emailMessages } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { pickDisplayBody, cleanEmailSubject } from '../utils/htmlText';
import { isMarketingOrPortalEmail } from '../classification/staffingSignals';
import { getTemplateDraft } from '../drafting/replyDrafter';
import { loadRegisteredCandidateMap } from '../matching/candidateRegistry';
import { loadRegisteredVendorMap } from '../matching/vendorRegistry';
import { getOwnMailbox, isSelfMessage } from '../utils/mailbox';

type FollowupRow = typeof followups.$inferSelect;

/** postgres.js returns snake_case; drizzle returns camelCase — normalize before body reads. */
function normalizeMessageRow(raw: any): typeof emailMessages.$inferSelect {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.cleanedBody != null || raw.rawBody != null || raw.htmlBody != null || raw.fromEmail != null) {
    return raw as typeof emailMessages.$inferSelect;
  }
  return {
    id: raw.id,
    threadId: raw.thread_id ?? raw.threadId,
    fromEmail: raw.from_email ?? raw.fromEmail,
    fromName: raw.from_name ?? raw.fromName,
    toEmail: raw.to_email ?? raw.toEmail,
    subject: raw.subject,
    rawBody: raw.raw_body ?? raw.rawBody,
    cleanedBody: raw.cleaned_body ?? raw.cleanedBody,
    htmlBody: raw.html_body ?? raw.htmlBody,
    attachments: raw.attachments ?? [],
    direction: raw.direction,
    date: raw.date,
    providerMessageId: raw.provider_message_id ?? raw.providerMessageId,
    isBounce: raw.is_bounce ?? raw.isBounce ?? false,
  } as typeof emailMessages.$inferSelect;
}

function messagePlainSources(m: typeof emailMessages.$inferSelect | any) {
  const n = normalizeMessageRow(m);
  return {
    cleaned: n.cleanedBody || '',
    raw: n.rawBody || '',
    html: n.htmlBody || null,
    row: n,
  };
}

/** postgres.js / mixed sources may return date as string — never call .getTime() directly. */
function dateMs(value: Date | string | number | null | undefined): number {
  if (value == null) return 0;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function pickOpenFollowup(allFollowups: FollowupRow[], threadId: string) {
  const open = allFollowups.filter((f) => f.threadId === threadId && f.status === 'Open');
  if (!open.length) return null;
  return open.sort((a, b) => dateMs(a.dueDate) - dateMs(b.dueDate))[0];
}

function formatAttachments(m: { id: string; attachments?: unknown }) {
  const atts = (m.attachments as Array<{ filename: string; contentType: string; size: number }>) || [];
  return atts.map((a, idx) => ({
    id: `${m.id}-att-${idx}`,
    name: a.filename,
    type: a.contentType,
    size: a.size >= 1048576 ? `${(a.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(a.size / 1024))} KB`,
  }));
}

function formatTimestamp(date?: Date | null) {
  return date
    ? new Date(date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
}

function formatThreadMessage(
  m: typeof emailMessages.$inferSelect,
  ownEmail: string,
  display?: { plain: string; html: string | null },
) {
  const src = messagePlainSources(m);
  const self = isSelfMessage(src.row, ownEmail);
  const picked = display || pickDisplayBody(src.cleaned, src.raw, src.html);
  // Prefer any stored text — some sent rows only have html_body populated
  let plain = (picked.plain || '').trim();
  if (!plain) {
    plain = (src.cleaned || src.raw || '').trim();
  }
  if (!plain && picked.html) {
    plain = pickDisplayBody('', '', picked.html).plain;
  }
  return {
    id: src.row.id,
    senderName: self ? 'You' : src.row.fromName || src.row.fromEmail || 'Unknown',
    senderEmail: src.row.fromEmail || '',
    toEmail: src.row.toEmail || '',
    isSelf: self,
    body: plain,
    bodyHtml: picked.html || src.html || null,
    timestamp: formatTimestamp(src.row.date),
    attachments: formatAttachments(src.row),
  };
}

async function findRelatedInboundForSent(
  sentMessages: Array<typeof emailMessages.$inferSelect>,
  threadSubject: string,
  fallbackRecipient?: string | null,
) {
  if (!sentMessages.length) return null;

  const latestSent = [...sentMessages].sort(
    (a, b) => dateMs(b.date) - dateMs(a.date),
  )[0];
  const toEmail = extractEmail(latestSent.toEmail || fallbackRecipient || '');
  const subjectNorm = subjectKey(latestSent.subject || threadSubject);
  if (!subjectNorm) return null;

const domain = toEmail.includes('@') ? toEmail.split('@')[1] : '';
// Scoped lookup — never pull the entire inbound mailbox into memory.
const candidates = await sql<Array<typeof emailMessages.$inferSelect>>`
  SELECT id, thread_id, from_email, from_name, to_email, subject, cleaned_body, raw_body, html_body, direction, date, provider_message_id, attachments
  FROM relay.email_messages
  WHERE COALESCE(direction, 'received') <> 'sent'
    AND (
      ${toEmail ? sql`lower(COALESCE(from_email, '')) = ${toEmail}` : sql`false`}
      OR ${domain ? sql`lower(COALESCE(from_email, '')) LIKE ${'%@' + domain}` : sql`false`}
      OR lower(COALESCE(subject, '')) LIKE ${'%' + subjectNorm.slice(0, 48) + '%'}
    )
  ORDER BY date DESC NULLS LAST
  LIMIT 80
`;

  const subjectMatches = (m: typeof emailMessages.$inferSelect) => {
    const mKey = subjectKey(m.subject || '');
    if (mKey === subjectNorm) return true;
    const core = subjectNorm.slice(0, 40);
    return core.length > 12 && (mKey.includes(core) || subjectNorm.includes(mKey.slice(0, 40)));
  };

  const partyMatches = (m: typeof emailMessages.$inferSelect) => {
    if (!toEmail) return true;
    const from = extractEmail(m.fromEmail || '');
    if (from === toEmail) return true;
    if (domain && from.endsWith(`@${domain}`)) return true;
    if (domain && (from.includes('foundit') || from.includes('monster')) && domain.includes('monster')) return true;
    return false;
  };

  const ranked = candidates
    .map(normalizeMessageRow)
    .filter((m) => subjectMatches(m))
    .sort((a, b) => {
      const aParty = partyMatches(a) ? 1 : 0;
      const bParty = partyMatches(b) ? 1 : 0;
      if (aParty !== bParty) return bParty - aParty;
      return dateMs(b.date) - dateMs(a.date);
    });

  if (ranked[0]) return normalizeMessageRow(ranked[0]);

  // Portal alerts often live in a separate thread from auto-sent follow-ups — match by subject + portal sender
  const portalMatch = candidates
    .map(normalizeMessageRow)
    .filter((m) =>
      isMarketingOrPortalEmail(
        m.fromEmail || '',
        m.fromName || '',
        m.subject || '',
        m.cleanedBody || m.rawBody || '',
      ),
    )
    .filter((m) => subjectMatches(m))
    .sort((a, b) => dateMs(b.date) - dateMs(a.date))[0];

  return portalMatch || null;
}

function pickLatestInbound<T extends { direction?: string | null; fromEmail?: string | null; date?: Date | null }>(
  messages: T[],
): T | null {
  const ownEmail = getOwnMailbox();
  const inbound = messages.filter((m) => !isSelfMessage(m, ownEmail));
  if (!inbound.length) return null;
  return inbound.sort((a, b) => dateMs(b.date) - dateMs(a.date))[0];
}

function extractEmail(raw: string | null | undefined): string {
  if (!raw) return '';
  const match = raw.match(/<([^>]+)>/);
  const email = (match ? match[1] : raw).trim().toLowerCase();
  return email.replace(/^to:\s*/i, '');
}

function subjectKey(subject: string): string {

  let subj = cleanEmailSubject(subject || '').toLowerCase();

  const prefix = /^(re|fwd|fw|aw|wg|reply):\s*/i;

  while (prefix.test(subj)) {
    subj = subj.replace(prefix, '').trim();
  }

  subj = subj.replace(/^subject:\s*/i, '').trim();

  return subj.replace(/\s+/g, ' ');
}

function conversationKey(t: {
  subject?: string | null;
  latestSenderEmail?: string | null;
  replyIntent?: string | null;
  hasInbound?: boolean;
}): string {
  const party = extractEmail(t.latestSenderEmail || '');
  const subject = subjectKey(t.subject || '');
  const sentOnly = t.replyIntent === 'Sent' && !t.hasInbound;
  return sentOnly ? `sent::${party}::${subject}` : `${party}::${subject}`;
}

type InboxListRow = Awaited<ReturnType<typeof buildThreadListRows>>[number] & {
  threadGroupCount?: number;
  groupedThreadIds?: string[];
};

function consolidateThreadList(items: InboxListRow[]): InboxListRow[] {
  const groups = new Map<string, InboxListRow>();

  for (const t of items) {
    const key = conversationKey({
      subject: t.subject,
      latestSenderEmail: t.latestSenderEmail,
      replyIntent: t.replyIntent,
      hasInbound: Boolean(t.hasInbound ?? t.preview),
    });

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...t,
        threadGroupCount: 1,
        groupedThreadIds: [t.threadId],
      });
      continue;
    }

    existing.threadGroupCount = (existing.threadGroupCount || 1) + 1;
    existing.messageCount = (existing.messageCount || 0) + (t.messageCount || 0);
    existing.groupedThreadIds = [...(existing.groupedThreadIds || [existing.threadId]), t.threadId];

    const tDate = new Date(t.latestDate || 0).getTime();
    const eDate = new Date(existing.latestDate || 0).getTime();
    const tHasInbound = Boolean(t.preview);
    const eHasInbound = Boolean(existing.preview);

    if (tHasInbound && !eHasInbound) {
      const counts = {
        threadGroupCount: existing.threadGroupCount,
        messageCount: existing.messageCount,
        groupedThreadIds: existing.groupedThreadIds,
      };
      Object.assign(existing, t, counts);
    } else if (tDate > eDate) {
      const counts = {
        threadGroupCount: existing.threadGroupCount,
        messageCount: existing.messageCount,
        groupedThreadIds: existing.groupedThreadIds,
        preview: eHasInbound && !tHasInbound ? existing.preview : t.preview || existing.preview,
        latestSender: tHasInbound || !eHasInbound ? t.latestSender : existing.latestSender,
        latestSenderEmail: tHasInbound || !eHasInbound ? t.latestSenderEmail : existing.latestSenderEmail,
      };
      Object.assign(existing, t, counts);
    }
  }

  return Array.from(groups.values()).sort(
    (a, b) => new Date(b.latestDate || 0).getTime() - new Date(a.latestDate || 0).getTime(),
  );
}

async function buildThreadListRows() {
  const rows = await sql<
    Array<{
      thread_id: string;
      subject: string | null;
      latest_sender: string | null;
      latest_sender_email: string | null;
      latest_date: Date | null;
      reply_intent: string | null;
      requires_followup: boolean | null;
      status: string | null;
      priority: string | null;
      candidate_id: string | null;
      vendor_id: string | null;
      correlation_id: string | null;
      workflow_context: Record<string, any> | null;
      inbound_from_name: string | null;
      inbound_from_email: string | null;
      inbound_preview: string | null;
      sent_to_email: string | null;
      sent_preview: string | null;
      message_count: number | null;
      fu_id: string | null;
      fu_status: string | null;
      fu_due_date: Date | null;
      fu_priority: string | null;
      fu_reply_type: string | null;
      fu_suggested_reply: string | null;
    }>
  >`
    SELECT
      t.thread_id,
      t.subject,
      t.latest_sender,
      t.latest_sender_email,
      COALESCE(agg.latest_date, t.latest_date) AS latest_date,
      t.reply_intent,
      t.requires_followup,
      t.status,
      t.priority,
      t.candidate_id,
      t.vendor_id,
      t.correlation_id,
      t.workflow_context,
      inbound.from_name AS inbound_from_name,
      inbound.from_email AS inbound_from_email,
      inbound.preview AS inbound_preview,
      sent.to_email AS sent_to_email,
      sent.preview AS sent_preview,
      COALESCE(agg.cnt, 0) AS message_count,
      fu.id AS fu_id,
      fu.status AS fu_status,
      fu.due_date AS fu_due_date,
      fu.priority AS fu_priority,
      fu.reply_type AS fu_reply_type,
      fu.suggested_reply AS fu_suggested_reply
    FROM relay.email_threads t
    LEFT JOIN LATERAL (
      SELECT from_name, from_email,
        LEFT(COALESCE(NULLIF(BTRIM(cleaned_body), ''), NULLIF(BTRIM(raw_body), '')), 140) AS preview
      FROM relay.email_messages m
      WHERE m.thread_id = t.thread_id
        AND COALESCE(m.direction, 'received') <> 'sent'
      ORDER BY m.date DESC NULLS LAST
      LIMIT 1
    ) inbound ON true
    LEFT JOIN LATERAL (
      SELECT to_email,
        LEFT(COALESCE(NULLIF(BTRIM(cleaned_body), ''), NULLIF(BTRIM(raw_body), '')), 140) AS preview
      FROM relay.email_messages m
      WHERE m.thread_id = t.thread_id
        AND COALESCE(m.direction, 'received') = 'sent'
      ORDER BY m.date DESC NULLS LAST
      LIMIT 1
    ) sent ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt, MAX(date) AS latest_date
      FROM relay.email_messages m
      WHERE m.thread_id = t.thread_id
    ) agg ON true
    LEFT JOIN LATERAL (
      SELECT id, status, due_date, priority, reply_type, suggested_reply
      FROM relay.followups f
      WHERE f.thread_id = t.thread_id AND f.status = 'Open'
      ORDER BY f.due_date ASC NULLS LAST
      LIMIT 1
    ) fu ON true
    ORDER BY COALESCE(agg.latest_date, t.latest_date) DESC NULLS LAST
    LIMIT 200
  `;

  const data = rows.map((row) => {
    const thread = {
      threadId: row.thread_id,
      subject: row.subject,
      latestSender: row.latest_sender,
      latestSenderEmail: row.latest_sender_email,
      latestDate: row.latest_date,
      replyIntent: row.reply_intent,
      requiresFollowup: row.requires_followup,
      status: row.status,
      priority: row.priority,
      candidateId: row.candidate_id,
      vendorId: row.vendor_id,
      correlationId: row.correlation_id,
      workflowContext: row.workflow_context,
    };
    const inbound = {
      from_name: row.inbound_from_name,
      from_email: row.inbound_from_email,
      preview: row.inbound_preview,
    };
    const sent = { to_email: row.sent_to_email, preview: row.sent_preview };
    const hasInbound = Boolean(inbound?.preview?.trim());
    const isSentOnly = !hasInbound && Boolean(sent?.preview?.trim());
    const openFollowup = row.fu_id
      ? ({
          id: row.fu_id,
          threadId: row.thread_id,
          status: row.fu_status,
          dueDate: row.fu_due_date,
          priority: row.fu_priority,
          replyType: row.fu_reply_type,
          suggestedReply: row.fu_suggested_reply,
        } as FollowupRow)
      : null;
    const preview = (hasInbound ? inbound?.preview || '' : sent?.preview || '').trim();
    const needsFollowup = Boolean(thread.requiresFollowup && thread.replyIntent !== 'Portal Notifications');
    const suggestedReply =
      openFollowup?.suggestedReply ||
      (needsFollowup ? getTemplateDraft(thread.replyIntent || 'Follow-Up Needed').body : null);
    const latestActivity = thread.latestDate;

    const wfCtx = (thread.workflowContext as Record<string, any>) || {};
    const isCandWorkflow = wfCtx.kind === 'candidate_consent' || Boolean(thread.candidateId);
    const isVendWorkflow = wfCtx.kind === 'vendor_submission' || Boolean(thread.vendorId);

    return {
      ...thread,
      subject: cleanEmailSubject(thread.subject || ''),
      preview,
      body: preview,
      bodyHtml: null,
      hasInbound,
      isSentOnly,
      messageCount: row.message_count || 0,
      requiresFollowup: thread.requiresFollowup,
      priority: thread.priority,
      direction: isSentOnly ? 'sent' : 'received',
      latestSender: hasInbound
        ? inbound?.from_name || thread.latestSender
        : isSentOnly
          ? `To: ${extractEmail(sent?.to_email || thread.latestSenderEmail || '')}`
          : thread.latestSender,
      latestSenderEmail: hasInbound
        ? inbound?.from_email || thread.latestSenderEmail
        : isSentOnly
          ? extractEmail(sent?.to_email || thread.latestSenderEmail || '')
          : thread.latestSenderEmail,
      latestDate: latestActivity,
      replyIntent: thread.replyIntent,
      registeredCandidate: isCandWorkflow
        ? { id: thread.candidateId, name: thread.latestSender || 'Candidate' }
        : null,
      registeredVendor: isVendWorkflow
        ? { id: thread.vendorId || wfCtx.vendorId, name: thread.latestSender || 'Vendor' }
        : null,
      vendorId: thread.vendorId || wfCtx.vendorId || null,
      sentToRecipient: isSentOnly ? extractEmail(sent?.to_email || thread.latestSenderEmail || '') : null,
      recruiterAction: needsFollowup ? openFollowup?.replyType || thread.replyIntent : null,
      suggestedReply,
      followup: openFollowup
        ? {
            id: openFollowup.id,
            status: openFollowup.status,
            dueDate: openFollowup.dueDate,
            priority: openFollowup.priority,
            replyType: openFollowup.replyType,
          }
        : needsFollowup
          ? { status: 'Open', dueDate: null, priority: thread.priority, replyType: thread.replyIntent }
          : null,
      threadMessages: [],
    };
  });

  data.sort((a, b) => {
    const ta = new Date(a.latestDate || 0).getTime();
    const tb = new Date(b.latestDate || 0).getTime();
    return tb - ta;
  });

  return data;
}

/** Fast inbox list — no html_body; merges duplicate threads by counterparty + subject. */
export async function listThreadsForInbox() {
  const data = await buildThreadListRows();
  return consolidateThreadList(data);
}

/** Full thread detail — loads html; merges sibling threads (same counterparty + subject). */
export async function getThreadDetail(threadId: string) {
  const [thread] = await db
    .select({
      threadId: emailThreads.threadId,
      subject: emailThreads.subject,
      latestSender: emailThreads.latestSender,
      latestSenderEmail: emailThreads.latestSenderEmail,
      latestDate: emailThreads.latestDate,
      replyIntent: emailThreads.replyIntent,
      requiresFollowup: emailThreads.requiresFollowup,
      status: emailThreads.status,
      priority: emailThreads.priority,
      candidateId: emailThreads.candidateId,
      vendorId: emailThreads.vendorId,
      correlationId: emailThreads.correlationId,
      workflowContext: emailThreads.workflowContext,
    })
    .from(emailThreads)
    .where(eq(emailThreads.threadId, threadId))
    .limit(1);
  if (!thread) return null;

  const partyEmail = extractEmail(thread.latestSenderEmail || '');
  const nearbyThreads = partyEmail
    ? await db
        .select({
          threadId: emailThreads.threadId,
          subject: emailThreads.subject,
          latestSenderEmail: emailThreads.latestSenderEmail,
          replyIntent: emailThreads.replyIntent,
        })
        .from(emailThreads)
        .where(eq(emailThreads.latestSenderEmail, thread.latestSenderEmail || ''))
    : [
        {
          threadId: thread.threadId,
          subject: thread.subject,
          latestSenderEmail: thread.latestSenderEmail,
          replyIntent: thread.replyIntent,
        },
      ];

  const nearbyIds = nearbyThreads.map((t) => t.threadId);
  const inboundThreadRows = nearbyIds.length
    ? await db
        .select({ threadId: emailMessages.threadId, direction: emailMessages.direction })
        .from(emailMessages)
        .where(inArray(emailMessages.threadId, nearbyIds))
    : [];
  const hasInboundByThread = new Set(
    inboundThreadRows
      .filter((r) => (r.direction || 'received') !== 'sent')
      .map((r) => r.threadId),
  );

  const keyFor = (t: { threadId: string; subject?: string | null; latestSenderEmail?: string | null; replyIntent?: string | null }) =>
    conversationKey({
      subject: t.subject,
      latestSenderEmail: t.latestSenderEmail,
      replyIntent: t.replyIntent,
      hasInbound: hasInboundByThread.has(t.threadId),
    });

  const key = keyFor(thread);
  const siblingIds = nearbyThreads.filter((t) => keyFor(t) === key).map((t) => t.threadId);
  const loadIds = siblingIds.length > 1 ? siblingIds : [threadId];

  const [allFollowups, candidateMap, vendorMap, threadMsgs] = await Promise.all([
    db.select().from(followups).where(inArray(followups.threadId, loadIds)),
    loadRegisteredCandidateMap(),
    thread.vendorId ? loadRegisteredVendorMap() : Promise.resolve(new Map()),
    db.select().from(emailMessages).where(inArray(emailMessages.threadId, loadIds)),
  ]);

  const sorted = threadMsgs.sort((a, b) => dateMs(a.date) - dateMs(b.date));
  const ownEmail = getOwnMailbox();
  const latestInbound = pickLatestInbound(sorted);
  const sentMessages = sorted.filter((m) => isSelfMessage(m, ownEmail));
  const isSentOnly = !latestInbound && sentMessages.length > 0;
  const relatedInboundRow = isSentOnly
    ? await findRelatedInboundForSent(sentMessages, thread.subject || '', thread.latestSenderEmail)
    : null;
  const latestSent = sentMessages.sort((a, b) => dateMs(b.date) - dateMs(a.date))[0];

  const openFollowup = pickOpenFollowup(allFollowups, threadId);

  const relatedInboundDisplay = relatedInboundRow
    ? (() => {
        const src = messagePlainSources(relatedInboundRow);
        return pickDisplayBody(src.cleaned, src.raw, src.html);
      })()
    : null;

  const latestSentDisplay = latestSent
    ? (() => {
        const src = messagePlainSources(latestSent);
        return pickDisplayBody(src.cleaned, src.raw, src.html);
      })()
    : { plain: '', html: null };

  const latestDisplay = latestInbound
    ? (() => {
        const src = messagePlainSources(latestInbound);
        return pickDisplayBody(src.cleaned, src.raw, src.html);
      })()
    : isSentOnly
      ? latestSentDisplay
      : { plain: '', html: null };

  const isPortal = thread.replyIntent === 'Portal Notifications';
  const inboundEmail = (latestInbound?.fromEmail || '').trim().toLowerCase();
  const registeredCandidate =
    !isPortal && latestInbound && inboundEmail && inboundEmail !== ownEmail
      ? candidateMap.get(inboundEmail) || null
      : null;
  const registeredVendor =
    !isPortal && thread.vendorId && inboundEmail ? vendorMap.get(inboundEmail) || null : null;
  const needsFollowup = Boolean(thread.requiresFollowup && thread.replyIntent !== 'Portal Notifications');

  return {
    ...thread,
    subject: cleanEmailSubject(thread.subject || latestInbound?.subject || ''),
    preview: latestDisplay.plain.slice(0, 280),
    body: latestDisplay.plain,
    bodyHtml: latestDisplay.html,
    messageCount: sorted.length + (relatedInboundRow ? 1 : 0),
    threadGroupCount: loadIds.length,
    groupedThreadIds: loadIds,
    isSentOnly,
    sentToRecipient: isSentOnly
      ? extractEmail(latestSent?.toEmail || thread.latestSenderEmail || '')
      : null,
    relatedInboundMessage: relatedInboundRow
      ? formatThreadMessage(relatedInboundRow, ownEmail, relatedInboundDisplay || undefined)
      : null,
    requiresFollowup: thread.requiresFollowup,
    priority: thread.priority,
    direction: isSentOnly ? 'sent' : latestInbound?.direction || 'received',
    latestSender: isSentOnly
      ? `To: ${extractEmail(latestSent?.toEmail || thread.latestSenderEmail || '') || 'Recipient'}`
      : latestInbound?.fromName || thread.latestSender,
    latestSenderEmail: isSentOnly
      ? extractEmail(latestSent?.toEmail || thread.latestSenderEmail || '')
      : latestInbound?.fromEmail || thread.latestSenderEmail,
    latestDate: isSentOnly ? latestSent?.date || thread.latestDate : latestInbound?.date || thread.latestDate,
    replyIntent: thread.replyIntent,
    registeredCandidate,
    registeredVendor: registeredVendor ? { name: registeredVendor.name, email: inboundEmail } : null,
    recruiterAction: needsFollowup ? openFollowup?.replyType || thread.replyIntent : null,
    suggestedReply:
      openFollowup?.suggestedReply ||
      (needsFollowup ? getTemplateDraft(thread.replyIntent || 'Follow-Up Needed').body : null),
    followup: openFollowup
      ? {
          id: openFollowup.id,
          status: openFollowup.status,
          dueDate: openFollowup.dueDate,
          priority: openFollowup.priority,
          replyType: openFollowup.replyType,
        }
      : needsFollowup
        ? { status: 'Open', dueDate: null, priority: thread.priority, replyType: thread.replyIntent }
        : null,
    threadMessages: sorted.map((m) => {
      const src = messagePlainSources(m);
      const self = isSelfMessage(src.row, ownEmail);
      const isPrimary = latestInbound
        ? src.row.id === latestInbound.id
        : isSentOnly && latestSent && src.row.id === latestSent.id;
      const display = isPrimary
        ? latestDisplay
        : pickDisplayBody(src.cleaned, src.raw, src.html);
      return formatThreadMessage(src.row, ownEmail, isPrimary ? latestDisplay : display);
    }),
  };
}
