import { pgSchema, text, boolean, timestamp, varchar, uuid, jsonb } from 'drizzle-orm/pg-core';

const relay = pgSchema('relay');

export const emailThreads = relay.table('email_threads', {
  threadId: varchar('thread_id', { length: 255 }).primaryKey(),
  subject: text('subject'),
  latestSender: text('latest_sender'),
  latestSenderEmail: varchar('latest_sender_email', { length: 255 }),
  latestDate: timestamp('latest_date', { withTimezone: true }),
  replyIntent: varchar('reply_intent', { length: 100 }),
  requiresFollowup: boolean('requires_followup').default(false),
  status: varchar('status', { length: 50 }),
  priority: varchar('priority', { length: 50 }),
  candidateId: uuid('candidate_id'),
  vendorId: uuid('vendor_id'),
  correlationId: varchar('correlation_id', { length: 255 }),
  workflowContext: jsonb('workflow_context').$type<Record<string, unknown>>().default({}),
  draftBody: text('draft_body'),
  draftSubject: text('draft_subject'),
  draftSource: varchar('draft_source', { length: 50 }),
  draftMessageId: varchar('draft_message_id', { length: 255 }),
  draftAttachments: jsonb('draft_attachments')
    .$type<Array<{ filename: string; contentType: string; contentBase64: string; size?: number }>>()
    .default([]),
});

export const emailMessages = relay.table('email_messages', {
  id: varchar('id', { length: 255 }).primaryKey(),
  threadId: varchar('thread_id', { length: 255 }).references(() => emailThreads.threadId),
  fromEmail: varchar('from_email', { length: 255 }),
  fromName: text('from_name'),
  toEmail: varchar('to_email', { length: 255 }),
  subject: text('subject'),
  rawBody: text('raw_body'),
  cleanedBody: text('cleaned_body'),
  htmlBody: text('html_body'),
  attachments: jsonb('attachments').$type<Array<{ filename: string; contentType: string; size: number }>>().default([]),
  direction: varchar('direction', { length: 50 }),
  date: timestamp('date', { withTimezone: true }),
  providerMessageId: varchar('provider_message_id', { length: 255 }),
  isBounce: boolean('is_bounce').default(false),
});

export const emailClassifications = relay.table('email_classifications', {
  messageId: varchar('message_id', { length: 255 }).primaryKey().references(() => emailMessages.id),
  threadId: varchar('thread_id', { length: 255 }).references(() => emailThreads.threadId),
  mainBucket: varchar('main_bucket', { length: 100 }),
  replyIntent: varchar('reply_intent', { length: 100 }),
  senderType: varchar('sender_type', { length: 50 }),
  priority: varchar('priority', { length: 50 }),
  requiresFollowup: boolean('requires_followup').default(false),
  candidateId: uuid('candidate_id'),
  vendorId: uuid('vendor_id'),
  classificationReason: text('classification_reason'),
  confidenceSource: varchar('confidence_source', { length: 50 }),
});

export const followups = relay.table('followups', {
  id: varchar('id', { length: 255 }).primaryKey(),
  threadId: varchar('thread_id', { length: 255 }).references(() => emailThreads.threadId),
  messageId: varchar('message_id', { length: 255 }).references(() => emailMessages.id),
  candidateId: uuid('candidate_id'),
  vendorId: uuid('vendor_id'),
  mainCategory: varchar('main_category', { length: 100 }),
  replyType: varchar('reply_type', { length: 100 }),
  priority: varchar('priority', { length: 50 }),
  status: varchar('status', { length: 50 }),
  dueDate: timestamp('due_date', { withTimezone: true }),
  suggestedReply: text('suggested_reply'),
  followupReason: text('followup_reason'),
});

/** Shadow-mode classifier comparison (rule vs ML vs LLM). */
export const mlShadowLogs = relay.table('ml_shadow_logs', {
  id: varchar('id', { length: 255 }).primaryKey(),
  messageId: varchar('message_id', { length: 255 }).references(() => emailMessages.id),
  ruleIntent: varchar('rule_intent', { length: 100 }),
  mlIntent: varchar('ml_intent', { length: 100 }),
  mlConfidence: varchar('ml_confidence', { length: 50 }),
  llmIntent: varchar('llm_intent', { length: 100 }),
  timestamp: timestamp('timestamp', { withTimezone: true }),
});
