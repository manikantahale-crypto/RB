/**
 * Relay Database Types and Schemas.
 * Pure TypeScript interfaces matching the relay PostgreSQL schema.
 * Zero ORM dependencies.
 */

export interface EmailThread {
  threadId: string;
  thread_id?: string;
  subject: string | null;
  latestSender: string | null;
  latest_sender?: string | null;
  latestSenderEmail: string | null;
  latest_sender_email?: string | null;
  latestDate: Date | null;
  latest_date?: Date | null;
  replyIntent: string | null;
  reply_intent?: string | null;
  requiresFollowup: boolean;
  requires_followup?: boolean;
  status: string | null;
  priority: string | null;
  candidateId: string | null;
  candidate_id?: string | null;
  vendorId: string | null;
  vendor_id?: string | null;
  correlationId: string | null;
  correlation_id?: string | null;
  workflowContext: Record<string, unknown>;
  workflow_context?: Record<string, unknown>;
  draftBody?: string | null;
  draft_body?: string | null;
  draftSubject?: string | null;
  draft_subject?: string | null;
  draftSource?: string | null;
  draft_source?: string | null;
  draftMessageId?: string | null;
  draft_message_id?: string | null;
  draftAttachments?: Array<{ filename: string; contentType: string; contentBase64: string; size?: number }>;
  draft_attachments?: Array<{ filename: string; contentType: string; contentBase64: string; size?: number }>;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  thread_id?: string;
  fromEmail: string | null;
  from_email?: string | null;
  fromName: string | null;
  from_name?: string | null;
  toEmail: string | null;
  to_email?: string | null;
  subject: string | null;
  rawBody: string | null;
  raw_body?: string | null;
  cleanedBody: string | null;
  cleaned_body?: string | null;
  htmlBody: string | null;
  html_body?: string | null;
  attachments: Array<{ filename: string; contentType: string; size: number }>;
  direction: string | null;
  date: Date | null;
  providerMessageId: string | null;
  provider_message_id?: string | null;
  isBounce: boolean;
  is_bounce?: boolean;
}

export interface EmailClassification {
  messageId: string;
  message_id?: string;
  threadId: string;
  thread_id?: string;
  mainBucket: string | null;
  main_bucket?: string | null;
  replyIntent: string | null;
  reply_intent?: string | null;
  senderType: string | null;
  sender_type?: string | null;
  priority: string | null;
  requiresFollowup: boolean;
  requires_followup?: boolean;
  candidateId: string | null;
  candidate_id?: string | null;
  vendorId: string | null;
  vendor_id?: string | null;
  classificationReason: string | null;
  classification_reason?: string | null;
  confidenceSource: string | null;
  confidence_source?: string | null;
}

export interface Followup {
  id: string;
  threadId: string;
  thread_id?: string;
  messageId: string | null;
  message_id?: string | null;
  candidateId: string | null;
  candidate_id?: string | null;
  vendorId: string | null;
  vendor_id?: string | null;
  mainCategory: string | null;
  main_category?: string | null;
  replyType: string | null;
  reply_type?: string | null;
  priority: string | null;
  status: string | null;
  dueDate: Date | null;
  due_date?: Date | null;
  suggestedReply: string | null;
  suggested_reply?: string | null;
  followupReason: string | null;
  followup_reason?: string | null;
}

export interface MlShadowLog {
  id: string;
  messageId: string;
  message_id?: string;
  ruleIntent: string | null;
  rule_intent?: string | null;
  mlIntent: string | null;
  ml_intent?: string | null;
  mlConfidence: string | null;
  ml_confidence?: string | null;
  llmIntent: string | null;
  llm_intent?: string | null;
  timestamp: Date | null;
}

// Compatibility shims for legacy type inferences like `typeof emailThreads.$inferSelect`
export const emailThreads = { $inferSelect: {} as EmailThread };
export const emailMessages = { $inferSelect: {} as EmailMessage };
export const followups = { $inferSelect: {} as Followup };
export const emailClassifications = { $inferSelect: {} as EmailClassification };
export const mlShadowLogs = { $inferSelect: {} as MlShadowLog };
