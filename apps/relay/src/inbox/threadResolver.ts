import { query, normalizeThread } from '../db';
import { v4 as uuidv4 } from 'uuid';
import type { EmailData } from '../connectors/connector.interface';
import { cleanEmailSubject } from '../utils/htmlText';
import { getOwnMailbox } from '../utils/mailbox';
import { relayThreadCorrelationId } from '../platform/relayIds';

export function extractEmail(raw: string | null | undefined): string {
  if (!raw) return '';
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase().replace(/^to:\s*/i, '');
}

export function subjectKey(subject: string): string {
  let subj = cleanEmailSubject(subject || '').toLowerCase();
  const prefix = /^(re|fwd|fw|aw|wg|reply):\s*/i;
  while (prefix.test(subj)) {
    subj = subj.replace(prefix, '').trim();
  }
  return subj.replace(/^subject:\s*/i, '').replace(/\s+/g, ' ').trim();
}

function normalizeMessageId(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/^<|>$/g, '').trim().toLowerCase();
}

function counterpartyEmail(emailData: EmailData): string {
  const own = getOwnMailbox();
  const from = extractEmail(emailData.fromEmail);
  const to = extractEmail(emailData.toEmail);
  if (emailData.direction === 'sent' || emailData.isSent) return to;
  if (from && from !== own) return from;
  return to || from;
}

function referenceIds(emailData: EmailData): string[] {
  const ids = new Set<string>();
  const add = (raw?: string) => {
    const norm = normalizeMessageId(raw);
    if (norm) ids.add(norm);
    if (raw?.includes('@')) {
      ids.add(raw.trim().toLowerCase());
      ids.add(`<${norm}>`);
    }
  };
  add(emailData.inReplyTo);
  for (const part of (emailData.references || '').split(/\s+/)) add(part);
  return [...ids];
}

/** Resolve relay thread_id so replies land in the same conversation as the original JD or consent email. */
export async function resolveThreadIdForEmail(emailData: EmailData): Promise<string> {
  const refs = referenceIds(emailData);

  if (refs.length) {
    for (const ref of refs) {
      const { rows } = await query(
        `SELECT thread_id FROM relay.email_messages
          WHERE lower(provider_message_id) = $1
             OR lower(id) = $1
             OR lower(provider_message_id) = $2
          LIMIT 1`,
        [ref, ref.replace(/^<|>$/g, '')]
      );
      if (rows[0]?.thread_id) return rows[0].thread_id;
    }
  }

  const party = counterpartyEmail(emailData);
  const subj = subjectKey(emailData.subject || '');

  if (party && subj) {
    const { rows: threadRows } = await query(`SELECT * FROM relay.email_threads`);
    const threads = threadRows.map(normalizeThread).filter(Boolean);
    const sameConversation = threads.filter((t) => {
      if (!t) return false;
      if (subjectKey(t.subject || '') !== subj) return false;
      return extractEmail(t.latestSenderEmail || '') === party;
    });
    const consentHit = sameConversation.find((t) => {
      const ctx = (t?.workflowContext as Record<string, unknown>) || {};
      return ctx.kind === 'candidate_consent';
    });
    if (consentHit) return consentHit.threadId;
    if (sameConversation[0]) return sameConversation[0].threadId;
  }

  // Gmail native thread id (hex) — stable across messages in one Gmail thread
  if (emailData.threadId && !emailData.threadId.includes('@')) {
    const { rows } = await query(
      `SELECT thread_id FROM relay.email_threads WHERE thread_id = $1 LIMIT 1`,
      [emailData.threadId]
    );
    if (rows[0]?.thread_id) return rows[0].thread_id;
    return emailData.threadId;
  }

  const fallback = emailData.threadId || emailData.id || uuidv4();
  return relayThreadCorrelationId(fallback, emailData.id);
}
