export interface EmailAttachmentMeta {
  filename: string;
  contentType: string;
  size: number;
}

export interface EmailData {
  id: string;
  threadId: string | null;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName?: string;
  subject: string;
  date: Date;
  fullBodyText: string;
  htmlBody?: string;
  attachments?: EmailAttachmentMeta[];
  providerMessageId: string;
  inReplyTo: string;
  references: string;
  direction: 'received' | 'sent';
  isSent?: boolean;
}

export interface IEmailConnector {
  fetchUnreadEmails(): Promise<EmailData[]>;
  /** Single inbox fetch (today's mail). Prefer over separate recent + unread passes. */
  fetchInbox?(): Promise<EmailData[]>;
  fetchRecentInbox?(): Promise<EmailData[]>;
  fetchSentEmails?(): Promise<EmailData[]>;
  markAsRead(messageId: string): Promise<void>;
}
