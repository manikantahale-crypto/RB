import { resolve } from 'node:path';
import dotenv from 'dotenv';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { EmailThread, EmailMessage, Followup } from './schema';

dotenv.config({ path: resolve(__dirname, '../../../../.env') });

// Canonical node-api database pool and transaction helper
const { pool, withTransaction } = require(resolve(__dirname, '../../../../node-api/src/config/db'));

export { pool, withTransaction };

/**
 * Standard query function matching node-postgres / node-api repository convention.
 * e.g. const { rows } = await query('SELECT * FROM relay.email_threads WHERE thread_id = $1', [threadId]);
 */
export async function query<T extends QueryResultRow = any>(text: string, params: any[] = []): Promise<QueryResult<T>> {
  return pool.query(text, params);
}

/**
 * Tagged template literal helper for parameterized SQL execution on canonical pool.
 * Automatically translates template expressions into $1, $2, ... parameters.
 * Returns result.rows for direct iteration while exposing .rows and .rowCount.
 * e.g. const rows = await sql`SELECT * FROM core.people WHERE id = ${id}::uuid`;
 */
export async function sql<T = any>(
  strings: TemplateStringsArray,
  ...values: any[]
): Promise<(T extends any[] ? T : T[]) & { rows: any[]; rowCount: number }> {
  let text = strings[0];
  const params: any[] = [];
  for (let i = 0; i < values.length; i++) {
    params.push(values[i]);
    text += `$${i + 1}${strings[i + 1]}`;
  }
  const result = await pool.query(text, params);
  const rows: any = result.rows;
  rows.rows = result.rows;
  rows.rowCount = result.rowCount;
  return rows;
}

/**
 * Normalizes email_threads rows so callers can access both camelCase and snake_case properties.
 */
export function normalizeThread(row: any): EmailThread | null {
  if (!row) return null;
  return {
    ...row,
    threadId: row.thread_id ?? row.threadId,
    thread_id: row.thread_id ?? row.threadId,
    subject: row.subject ?? null,
    latestSender: row.latest_sender ?? row.latestSender ?? null,
    latest_sender: row.latest_sender ?? row.latestSender ?? null,
    latestSenderEmail: row.latest_sender_email ?? row.latestSenderEmail ?? null,
    latest_sender_email: row.latest_sender_email ?? row.latestSenderEmail ?? null,
    latestDate: row.latest_date ? new Date(row.latest_date) : row.latestDate ?? null,
    latest_date: row.latest_date ? new Date(row.latest_date) : row.latestDate ?? null,
    replyIntent: row.reply_intent ?? row.replyIntent ?? null,
    reply_intent: row.reply_intent ?? row.replyIntent ?? null,
    requiresFollowup: Boolean(row.requires_followup ?? row.requiresFollowup),
    requires_followup: Boolean(row.requires_followup ?? row.requiresFollowup),
    status: row.status ?? null,
    priority: row.priority ?? null,
    candidateId: row.candidate_id ?? row.candidateId ?? null,
    candidate_id: row.candidate_id ?? row.candidateId ?? null,
    vendorId: row.vendor_id ?? row.vendorId ?? null,
    vendor_id: row.vendor_id ?? row.vendorId ?? null,
    correlationId: row.correlation_id ?? row.correlationId ?? null,
    correlation_id: row.correlation_id ?? row.correlationId ?? null,
    workflowContext: row.workflow_context ?? row.workflowContext ?? {},
    workflow_context: row.workflow_context ?? row.workflowContext ?? {},
    draftBody: row.draft_body ?? row.draftBody ?? null,
    draft_body: row.draft_body ?? row.draftBody ?? null,
    draftSubject: row.draft_subject ?? row.draftSubject ?? null,
    draft_subject: row.draft_subject ?? row.draftSubject ?? null,
    draftSource: row.draft_source ?? row.draftSource ?? null,
    draft_source: row.draft_source ?? row.draftSource ?? null,
    draftMessageId: row.draft_message_id ?? row.draftMessageId ?? null,
    draft_message_id: row.draft_message_id ?? row.draftMessageId ?? null,
    draftAttachments: row.draft_attachments ?? row.draftAttachments ?? [],
    draft_attachments: row.draft_attachments ?? row.draftAttachments ?? [],
  };
}

/**
 * Normalizes email_messages rows so callers can access both camelCase and snake_case properties.
 */
export function normalizeMessage(row: any): EmailMessage | null {
  if (!row) return null;
  return {
    ...row,
    id: row.id,
    threadId: row.thread_id ?? row.threadId,
    thread_id: row.thread_id ?? row.threadId,
    fromEmail: row.from_email ?? row.fromEmail ?? null,
    from_email: row.from_email ?? row.fromEmail ?? null,
    fromName: row.from_name ?? row.fromName ?? null,
    from_name: row.from_name ?? row.fromName ?? null,
    toEmail: row.to_email ?? row.toEmail ?? null,
    to_email: row.to_email ?? row.toEmail ?? null,
    subject: row.subject ?? null,
    rawBody: row.raw_body ?? row.rawBody ?? null,
    raw_body: row.raw_body ?? row.rawBody ?? null,
    cleanedBody: row.cleaned_body ?? row.cleanedBody ?? null,
    cleaned_body: row.cleaned_body ?? row.cleanedBody ?? null,
    htmlBody: row.html_body ?? row.htmlBody ?? null,
    html_body: row.html_body ?? row.htmlBody ?? null,
    attachments: row.attachments ?? [],
    direction: row.direction ?? null,
    date: row.date ? new Date(row.date) : null,
    providerMessageId: row.provider_message_id ?? row.providerMessageId ?? null,
    provider_message_id: row.provider_message_id ?? row.providerMessageId ?? null,
    isBounce: Boolean(row.is_bounce ?? row.isBounce),
    is_bounce: Boolean(row.is_bounce ?? row.isBounce),
  };
}

/**
 * Normalizes followups rows so callers can access both camelCase and snake_case properties.
 */
export function normalizeFollowup(row: any): Followup | null {
  if (!row) return null;
  return {
    ...row,
    id: row.id,
    threadId: row.thread_id ?? row.threadId,
    thread_id: row.thread_id ?? row.threadId,
    messageId: row.message_id ?? row.messageId ?? null,
    message_id: row.message_id ?? row.messageId ?? null,
    candidateId: row.candidate_id ?? row.candidateId ?? null,
    candidate_id: row.candidate_id ?? row.candidateId ?? null,
    vendorId: row.vendor_id ?? row.vendorId ?? null,
    vendor_id: row.vendor_id ?? row.vendorId ?? null,
    mainCategory: row.main_category ?? row.mainCategory ?? null,
    main_category: row.main_category ?? row.mainCategory ?? null,
    replyType: row.reply_type ?? row.replyType ?? null,
    reply_type: row.reply_type ?? row.replyType ?? null,
    priority: row.priority ?? null,
    status: row.status ?? null,
    dueDate: row.due_date ? new Date(row.due_date) : row.dueDate ? new Date(row.dueDate) : null,
    due_date: row.due_date ? new Date(row.due_date) : row.dueDate ? new Date(row.dueDate) : null,
    suggestedReply: row.suggested_reply ?? row.suggestedReply ?? null,
    suggested_reply: row.suggested_reply ?? row.suggestedReply ?? null,
    followupReason: row.followup_reason ?? row.followupReason ?? null,
    followup_reason: row.followup_reason ?? row.followupReason ?? null,
  };
}

export default { pool, withTransaction, query, sql, normalizeThread, normalizeMessage, normalizeFollowup };
