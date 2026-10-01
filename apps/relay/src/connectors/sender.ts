import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import {
  formatSendError,
  logSendFailure,
  relayOutboundEnabled,
  shouldSkipOutboundSend,
} from './relayOutbound';

dotenv.config();

let _google: any = null;
function getGoogle(): any {
  if (!_google) {
    _google = require('googleapis').google;
  }
  return _google;
}

export type OutboundAttachment = {
  filename: string;
  contentType: string;
  content: Buffer | string;
  encoding?: 'base64' | 'utf8';
};

export interface ISender {
  lastError?: string | null;
  sendEmail(
    to: string,
    subject: string,
    body: string,
    inReplyToMessageId?: string,
    attachments?: OutboundAttachment[],
    html?: string,
  ): Promise<boolean>;
}

function buildMimeMessage(
  from: string,
  to: string,
  subject: string,
  body: string,
  inReplyToMessageId?: string,
  attachments: OutboundAttachment[] = [],
  html?: string,
): string {
  const boundary = `relay_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const altBoundary = `alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${utf8Subject}`,
    'MIME-Version: 1.0',
  ];

  if (inReplyToMessageId) {
    headers.push(`In-Reply-To: ${inReplyToMessageId}`);
    headers.push(`References: ${inReplyToMessageId}`);
  }

  if (!attachments.length && !html) {
    headers.push('Content-Type: text/plain; charset=utf-8');
    return [...headers, '', body].join('\n');
  }

  if (!attachments.length && html) {
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    const parts: string[] = [...headers, ''];
    parts.push(`--${altBoundary}`);
    parts.push('Content-Type: text/plain; charset=utf-8');
    parts.push('Content-Transfer-Encoding: 7bit');
    parts.push('');
    parts.push(body);
    parts.push(`--${altBoundary}`);
    parts.push('Content-Type: text/html; charset=utf-8');
    parts.push('Content-Transfer-Encoding: 7bit');
    parts.push('');
    parts.push(html);
    parts.push(`--${altBoundary}--`);
    return parts.join('\n');
  }

  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts: string[] = [...headers, ''];

  if (html) {
    parts.push(`--${boundary}`);
    parts.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    parts.push('');
    parts.push(`--${altBoundary}`);
    parts.push('Content-Type: text/plain; charset=utf-8');
    parts.push('');
    parts.push(body);
    parts.push(`--${altBoundary}`);
    parts.push('Content-Type: text/html; charset=utf-8');
    parts.push('');
    parts.push(html);
    parts.push(`--${altBoundary}--`);
  } else {
    parts.push(`--${boundary}`);
    parts.push('Content-Type: text/plain; charset=utf-8');
    parts.push('Content-Transfer-Encoding: 7bit');
    parts.push('');
    parts.push(body);
  }

  for (const att of attachments) {
    const raw =
      typeof att.content === 'string' && att.encoding === 'base64'
        ? att.content.replace(/\s/g, '')
        : Buffer.isBuffer(att.content)
          ? att.content.toString('base64')
          : Buffer.from(String(att.content)).toString('base64');
    parts.push(`--${boundary}`);
    parts.push(
      `Content-Type: ${att.contentType || 'application/octet-stream'}; name="${att.filename}"`,
    );
    parts.push('Content-Transfer-Encoding: base64');
    parts.push(`Content-Disposition: attachment; filename="${att.filename}"`);
    parts.push('');
    parts.push(raw.replace(/(.{76})/g, '$1\n').trim());
  }

  parts.push(`--${boundary}--`);
  return parts.join('\n');
}

export class NodemailerSmtpSender implements ISender {
  private transporter;
  public lastError: string | null = null;

  constructor() {
    const smtpPass = (process.env.SMTP_PASSWORD || '').replace(/\s+/g, '');
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '465', 10),
      secure: true,
      auth: {
        user: process.env.SMTP_USERNAME,
        pass: smtpPass,
      },
    });
  }

  public async sendEmail(
    to: string,
    subject: string,
    body: string,
    inReplyToMessageId?: string,
    attachments: OutboundAttachment[] = [],
    html?: string,
  ): Promise<boolean> {
    this.lastError = null;
    try {
      const mailOptions: Record<string, unknown> = {
        from:
          process.env.EMAIL_FROM ||
          process.env.GMAIL_SENDER_EMAIL ||
          process.env.SMTP_USERNAME ||
          '',
        to,
        subject,
        text: body,
      };
      if (html) mailOptions.html = html;

      if (inReplyToMessageId) {
        mailOptions.inReplyTo = inReplyToMessageId;
        mailOptions.references = inReplyToMessageId;
      }

      if (attachments.length) {
        mailOptions.attachments = attachments.map((att) => ({
          filename: att.filename,
          content:
            att.encoding === 'base64'
              ? Buffer.from(String(att.content), 'base64')
              : att.content,
          contentType: att.contentType,
        }));
      }

      await this.transporter.sendMail(mailOptions);
      console.log(`[relay][SMTP] sent → ${to} | "${subject.slice(0, 60)}"`);
      return true;
    } catch (error: unknown) {
      const short = logSendFailure('SMTP', to, subject, error);
      this.lastError = `SMTP send failed: ${short}`;
      return false;
    }
  }
}

export class GmailApiSender implements ISender {
  private oAuth2Client: any = null;
  public lastError: string | null = null;

  constructor() {}

  private getOAuth2Client() {
    if (!this.oAuth2Client) {
      const google = getGoogle();
      this.oAuth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI || 'http://localhost',
      );

      if (process.env.GMAIL_REFRESH_TOKEN) {
        this.oAuth2Client.setCredentials({
          refresh_token: process.env.GMAIL_REFRESH_TOKEN,
        });
      }
    }
    return this.oAuth2Client;
  }

  private async ensureAccessToken(): Promise<boolean> {
    try {
      const client = this.getOAuth2Client();
      const token = await client.getAccessToken();
      if (!token?.token) {
        this.lastError =
          'Gmail OAuth: no access token (invalid_grant or revoked refresh token)';
        console.warn(`[relay][Gmail API] ${this.lastError}`);
        return false;
      }
      return true;
    } catch (error: unknown) {
      this.lastError = `Gmail OAuth refresh failed: ${formatSendError(error)}`;
      console.warn(`[relay][Gmail API] ${this.lastError}`);
      return false;
    }
  }

  public async sendEmail(
    to: string,
    subject: string,
    body: string,
    inReplyToMessageId?: string,
    attachments: OutboundAttachment[] = [],
    html?: string,
  ): Promise<boolean> {
    this.lastError = null;
    if (!process.env.GMAIL_REFRESH_TOKEN) {
      this.lastError = 'GMAIL_REFRESH_TOKEN is not set';
      return false;
    }
    if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
      this.lastError = 'GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET is missing';
      return false;
    }

    const tokenOk = await this.ensureAccessToken();
    if (!tokenOk) return false;

    try {
      const google = getGoogle();
      const gmail = google.gmail({ version: 'v1', auth: this.getOAuth2Client() });
      const from =
        process.env.GMAIL_SENDER_EMAIL || process.env.SMTP_USERNAME || 'me';
      const rawMessage = buildMimeMessage(
        from,
        to,
        subject,
        body,
        inReplyToMessageId,
        attachments,
        html,
      );
      const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage },
      });

      console.log(`[relay][Gmail API] sent → ${to} | "${subject.slice(0, 60)}"`);
      return true;
    } catch (error: unknown) {
      const short = logSendFailure('Gmail API', to, subject, error);
      this.lastError = `Gmail send failed: ${short}`;
      return false;
    }
  }
}

function smtpConfigured(): boolean {
  const host = process.env.SMTP_HOST || '';
  const user = process.env.SMTP_USERNAME || '';
  const pass = (process.env.SMTP_PASSWORD || '').replace(/\s+/g, '');

  return Boolean(host.trim() && user.trim() && pass);
}

/** Gmail API send first; SMTP fallback. Force SMTP with EMAIL_SEND_PROVIDER=smtp. */
export class FallbackEmailSender implements ISender {
  private gmail = new GmailApiSender();
  private smtp = new NodemailerSmtpSender();
  public lastError: string | null = null;

  public async sendEmail(
    to: string,
    subject: string,
    body: string,
    inReplyToMessageId?: string,
    attachments: OutboundAttachment[] = [],
    html?: string,
  ): Promise<boolean> {
    this.lastError = null;

    if (shouldSkipOutboundSend(`to=${to}`)) {
      this.lastError = 'Outbound send disabled or Gmail quota cooldown active';
      return false;
    }

    const sendProvider = (
      process.env.EMAIL_SEND_PROVIDER || 'gmail_api'
    ).toLowerCase();
    const forceSmtp = sendProvider === 'smtp';

    if (!forceSmtp && process.env.GMAIL_REFRESH_TOKEN) {
      const ok = await this.gmail.sendEmail(
        to,
        subject,
        body,
        inReplyToMessageId,
        attachments,
        html,
      );
      if (ok) return true;
      console.warn(
        `[relay] Gmail failed — trying SMTP | ${this.gmail.lastError || ''}`,
      );
    }

    if (!smtpConfigured()) {
      console.warn(
        '[relay] SMTP is not configured — set SMTP_HOST, SMTP_USERNAME and SMTP_PASSWORD',
      );
      this.lastError =
        this.gmail.lastError ||
        'SMTP is not configured — set SMTP_HOST, SMTP_USERNAME and SMTP_PASSWORD';
      return false;
    }

    const smtpOk = await this.smtp.sendEmail(
      to,
      subject,
      body,
      inReplyToMessageId,
      attachments,
      html,
    );
    if (!smtpOk) {
      this.lastError =
        this.gmail.lastError ||
        this.smtp.lastError ||
        'Gmail API and SMTP both failed';
    }
    return smtpOk;
  }
}

export class EmailSenderFactory {
  public static getSender(): ISender {
    if ((process.env.EMAIL_SEND_PROVIDER || '').toLowerCase() === 'smtp') {
      return new NodemailerSmtpSender();
    }
    if (!relayOutboundEnabled()) {
      console.log(
        '[relay] Outbound email disabled (RELAY_OUTBOUND_SEND=0) — fetch/classify still active',
      );
    }
    return new FallbackEmailSender();
  }
}