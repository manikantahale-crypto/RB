import { google, gmail_v1 } from 'googleapis';
import { IEmailConnector, EmailData, EmailAttachmentMeta } from './connector.interface';
import { htmlToPlainText } from '../utils/htmlText';
import dotenv from 'dotenv';

dotenv.config();

function extractAddress(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].replace(/"/g, '').trim(), email: match[2].trim() };
  return { name: '', email: raw.replace(/[<>]/g, '').trim() };
}

function decodeBody(data?: string | null): string {
  if (!data) return '';
  return Buffer.from(data, 'base64url').toString('utf-8');
}

async function extractBodies(
  gmail: gmail_v1.Gmail,
  messageId: string,
  payload: any,
): Promise<{ text: string; html: string; attachments: EmailAttachmentMeta[] }> {
  let text = '';
  let html = '';
  const attachments: EmailAttachmentMeta[] = [];

  const readPartBody = async (part: any): Promise<string> => {
    if (part.body?.data) return decodeBody(part.body.data);
    if (!part.body?.attachmentId) return '';
    try {
      const att = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: part.body.attachmentId,
      });
      return decodeBody(att.data?.data);
    } catch {
      return '';
    }
  };

  const walk = async (part: any) => {
    if (!part) return;
    const mime = (part.mimeType || '').toLowerCase();
    const bodyData = await readPartBody(part);

    if (mime === 'text/plain' && bodyData) text += bodyData;
    if (mime === 'text/html' && bodyData) html += bodyData;
    if (part.filename && part.body?.size) {
      attachments.push({
        filename: part.filename,
        contentType: mime || 'application/octet-stream',
        size: part.body.size || 0,
      });
    }
    if (part.parts) {
      for (const p of part.parts) await walk(p);
    }
  };

  await walk(payload);
  return { text, html, attachments };
}

export class GmailConnector implements IEmailConnector {
  private oAuth2Client;

  constructor() {
    this.oAuth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI || 'http://localhost',
    );

    if (process.env.GMAIL_REFRESH_TOKEN) {
      this.oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    }
  }

  private fetchDays(): number {
    return parseInt(process.env.IMAP_FETCH_DAYS || '7', 10);
  }
  private maxMessages(): number {
    const n = parseInt(process.env.RELAY_MAILBOX_MAX_MESSAGES || '40', 10);
    return Number.isFinite(n) && n > 0 ? n : 40;
  }

  private async fetchFromQuery(
    query: string,
    direction: 'received' | 'sent',
    capOverride?: number,
  ): Promise<EmailData[]> {
    const gmail = google.gmail({ version: 'v1', auth: this.oAuth2Client });
    const emails: EmailData[] = [];
    const ownEmail = (process.env.GMAIL_SENDER_EMAIL || process.env.IMAP_USERNAME || '').toLowerCase();
    let pageToken: string | undefined;

    do {
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
        pageToken,
      });

      const messages = response.data.messages || [];
      pageToken = response.data.nextPageToken || undefined;

      for (const msg of messages) {
        if (!msg.id) continue;

        const fullMsg = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        });

        const headers = fullMsg.data.payload?.headers || [];
        const header = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        const subject = header('Subject');
        const from = extractAddress(header('From'));
        const to = extractAddress(header('To'));
        const dateHeader = header('Date');
        const messageId = header('Message-ID');
        const inReplyTo = header('In-Reply-To');
        const references = header('References');

        const { text, html, attachments } = await extractBodies(
          gmail,
          msg.id,
          fullMsg.data.payload,
        );
        let fullBodyText = text.trim();
        if (!fullBodyText && html) fullBodyText = htmlToPlainText(html);

        const isSent =
          direction === 'sent' || Boolean(ownEmail && from.email.toLowerCase() === ownEmail);

        emails.push({
          id: msg.id,
          threadId: fullMsg.data.threadId || msg.id,
          fromEmail: from.email,
          fromName: from.name,
          toEmail: to.email,
          toName: to.name,
          subject,
          date: new Date(dateHeader || Date.now()),
          fullBodyText,
          htmlBody: html || undefined,
          attachments: attachments.length ? attachments : undefined,
          providerMessageId: messageId || msg.id,
          inReplyTo,
          references,
          direction: isSent ? 'sent' : 'received',
          isSent,
        });
      }
    } while (pageToken && emails.length < 300);

    return emails;
  }

  /**
   * What fallback.ts calls for the inbox. It did not exist on the old project:
   * that deployment ran EMAIL_PROVIDER=imap, so the Gmail path was never taken
   * and its ReferenceError never fired (found by typechecking the port,
   * 2026-09-18). Same query as fetchUnreadEmails — Gmail has no cheaper
   * "recent" window than newer_than.
   */
  public async fetchRecentInbox(): Promise<EmailData[]> {
    return this.fetchUnreadEmails();
  }

  public async fetchUnreadEmails(): Promise<EmailData[]> {
    try {
      return await this.fetchFromQuery(`in:inbox newer_than:${this.fetchDays()}d`, 'received');
    } catch (error) {
      console.error('Error fetching inbox via Gmail API:', error);
      throw error;
    }
  }

  public async fetchSentEmails(): Promise<EmailData[]> {
    try {
      return await this.fetchFromQuery(`in:sent newer_than:${this.fetchDays()}d`, 'sent');
    } catch (error) {
      console.error('Error fetching sent via Gmail API:', error);
      throw error;
    }
  }

  public async markAsRead(messageId: string): Promise<void> {
    const gmail = google.gmail({ version: 'v1', auth: this.oAuth2Client });
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
  }
}
