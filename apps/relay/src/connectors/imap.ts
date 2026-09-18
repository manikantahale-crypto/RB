import { connect, ImapSimple } from 'imap-simple';
import { simpleParser } from 'mailparser';
import { inArray } from 'drizzle-orm';
import { IEmailConnector, EmailData } from './connector.interface';
import { htmlToPlainText } from '../utils/htmlText';
import { db } from '../db';
import { emailMessages } from '../db/schema';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class ImapConnector implements IEmailConnector {
  private connection: ImapSimple | null = null;

  private resetConnection() {
    if (!this.connection) return;
    try {
      this.connection.end();
    } catch {
      /* ignore close errors */
    }
    this.connection = null;
  }

  private async getConnection(): Promise<ImapSimple> {
    if (this.connection) {
      return this.connection;
    }

    const config = {
      imap: {
        user: process.env.MARKETING_IMAP_USER || process.env.IMAP_USERNAME || '',
        password: process.env.MARKETING_IMAP_PASSWORD || process.env.IMAP_PASSWORD || '',
        host: process.env.MARKETING_IMAP_HOST || process.env.IMAP_HOST || 'imap.gmail.com',
        port: parseInt(process.env.MARKETING_IMAP_PORT || process.env.IMAP_PORT || '993', 10),
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        // Gmail often needs >3s; short authTimeout caused hangs/retries that felt like "IMAP stuck"
        authTimeout: parseInt(process.env.IMAP_AUTH_TIMEOUT_MS || '20000', 10),
        connTimeout: parseInt(process.env.IMAP_CONN_TIMEOUT_MS || '20000', 10),
      },
    };

    const conn = await connect(config);
    conn.on('error', (err: Error) => {
      console.warn('[relay IMAP] connection error:', err?.message || err);
      this.connection = null;
    });
    this.connection = conn;
    return conn;
  }

  public async fetchUnreadEmails(): Promise<EmailData[]> {
    return this.fetchFromBox('INBOX', 'received');
  }

  public async fetchInbox(): Promise<EmailData[]> {
    return this.fetchRecentInbox();
  }

  public async fetchSentEmails(): Promise<EmailData[]> {
    const sentBoxes = ['[Gmail]/Sent Mail', 'Sent', 'Sent Items', 'Sent Messages'];
    for (const box of sentBoxes) {
      try {
        return await this.fetchFromBox(box, 'sent');
      } catch {
        // try next sent folder name
      }
    }
    return [];
  }

  private fetchDays(): number {
    return parseInt(process.env.IMAP_FETCH_DAYS || '7', 10);
  }

  private maxMessages(): number {
    const n = parseInt(process.env.RELAY_MAILBOX_MAX_MESSAGES || '40', 10);
    return Number.isFinite(n) && n > 0 ? n : 40;
  }

  public async fetchRecentInbox(): Promise<EmailData[]> {
    const sinceDate = new Date();
    sinceDate.setHours(0, 0, 0, 0);

    try {
      return await this.fetchFromBox(
        'INBOX',
        'received',
        sinceDate,
        Math.min(this.maxMessages(), 25),
      );
    } catch (err) {
      console.warn(
        '[relay IMAP] fetchRecentInbox failed:',
        (err as Error)?.message || err,
      );
      return [];
    }
  }

  private async fetchFromBox(
    boxName: string,
    direction: 'received' | 'sent',
    sinceOverride?: Date,
    capOverride?: number,
  ): Promise<EmailData[]> {
    try {
      const connection = await this.getConnection();
      await connection.openBox(boxName);

const sinceDate =
  sinceOverride ??
  (() => {
    const d = new Date();
    d.setDate(d.getDate() - this.fetchDays());
    return d;
  })();

const inboxUnseenOnly =
  process.env.IMAP_INBOX_UNSEEN_ONLY === '1' ||
  process.env.IMAP_INBOX_UNSEEN_ONLY === 'true';

const searchCriteria =
  direction === 'received'
    ? inboxUnseenOnly
      ? ['UNSEEN', ['SINCE', sinceDate]]
      : ['ALL', ['SINCE', sinceDate]]
    : ['ALL', ['SINCE', sinceDate]];

      const ownEmail = (
        process.env.MARKETING_IMAP_USER ||
        process.env.IMAP_USERNAME ||
        ''
      ).toLowerCase();
const cap = capOverride && capOverride > 0
  ? capOverride
  : this.maxMessages();

// Phase 1: headers only (cheap) so we can pick newest N before downloading bodies.
const headerMessages = await connection.search(searchCriteria, {
  bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)'],
  markSeen: false,
  struct: false,
});

const newestFirst = [...headerMessages].sort(
  (a, b) => (b.attributes?.uid || 0) - (a.attributes?.uid || 0),
);

const selected = newestFirst.slice(0, cap);

const uids = selected
  .map((m) => m.attributes?.uid)
  .filter((u): u is number => Boolean(u));

if (!uids.length) return [];

const messageIds = uids.map((uid) => `${boxName}:${uid}`);
let newUids = uids;
try {
  const existing = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(inArray(emailMessages.id, messageIds));
  const have = new Set(existing.map((r) => r.id));
  newUids = uids.filter((uid) => !have.has(`${boxName}:${uid}`));
} catch (err) {
  console.warn(
    `[relay IMAP] ${boxName}: existing-id lookup failed — downloading bodies`,
    (err as Error)?.message || err,
  );
}

if (!newUids.length) {
  console.log(
    `[relay IMAP] ${boxName}: ${uids.length} newest already in DB — skip body download`,
  );
  return [];
}

console.log(
  `[relay IMAP] ${boxName}: ${newUids.length} new of ${uids.length} selected — downloading bodies`,
);

const emails: EmailData[] = [];
const batchSize = 5;

for (let i = 0; i < newUids.length; i += batchSize) {
  const batch = newUids.slice(i, i + batchSize);

  const batchResults = await Promise.all(
    batch.map(async (uid) => {
      try {
        const bodyMessages = await connection.search(
          [['UID', String(uid)]],
          {
            bodies: ['HEADER', 'TEXT', ''],
            markSeen: false,
            struct: true,
          },
        );

        return bodyMessages[0] || null;
      } catch (err) {
        console.warn(
          `[relay IMAP] UID ${uid} body fetch failed:`,
          (err as Error)?.message || err,
        );
        return null;
      }
    }),
  );

  for (const msg of batchResults) {
    if (!msg) continue;

    const allBody =
      msg.parts.find((part) => part.which === '') ||
      msg.parts.find((part) => part.which === 'TEXT');

    if (!allBody?.body) continue;

    const parsed = await simpleParser(allBody.body);
    await sleep(0);

    const htmlRaw = typeof parsed.html === 'string' ? parsed.html : '';

    let rawBody = parsed.text?.trim() || '';

    if (!rawBody && htmlRaw) {
      rawBody = htmlToPlainText(htmlRaw);
    }

    const attachmentMeta = (parsed.attachments || []).map(
      (att: any, idx: number) => ({
        filename: att.filename || att.cid || `attachment-${idx + 1}`,
        contentType: att.contentType || 'application/octet-stream',
        size: att.size || 0,
      }),
    );

    const fromEmail = parsed.from?.value[0]?.address || '';
    const fromName = parsed.from?.value[0]?.name || '';

    const toParsed = parsed.to
      ? Array.isArray(parsed.to)
        ? parsed.to[0]?.value?.[0]
        : parsed.to.value?.[0]
      : null;

    emails.push({
      id: `${boxName}:${msg.attributes.uid}`,
      threadId: parsed.messageId || `${boxName}-${msg.attributes.uid}`,
      fromEmail,
      fromName,
      toEmail: toParsed?.address || '',
      toName: toParsed?.name || '',
      subject: parsed.subject || '',
      date: parsed.date || new Date(),
      fullBodyText: rawBody,
      htmlBody: htmlRaw || undefined,
      attachments: attachmentMeta.length ? attachmentMeta : undefined,
      providerMessageId: parsed.messageId || '',
      inReplyTo: parsed.inReplyTo || '',
      references: Array.isArray(parsed.references)
        ? parsed.references.join(' ')
        : parsed.references || '',
      direction,
      isSent: direction === 'sent' || fromEmail.toLowerCase() === ownEmail,
    });
  }
}

emails.sort((a, b) => b.date.getTime() - a.date.getTime());

console.log(
  `[relay IMAP] ${boxName}: parsed ${emails.length}/${newUids.length} new message(s)`,
);

      return emails;
    } catch (err) {
      this.resetConnection();
      throw err;
    }
  }

  public async markAsRead(messageId: string): Promise<void> {
    try {
      const connection = await this.getConnection();
      const uid = messageId.includes(':') ? messageId.split(':').pop()! : messageId;
      const box = messageId.includes(':') ? messageId.split(':')[0] : 'INBOX';
      await connection.openBox(box);
      await connection.addFlags(parseInt(uid, 10), '\\Seen');
    } catch (err) {
      this.resetConnection();
      throw err;
    }
  }
}
