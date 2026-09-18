import { IEmailConnector, EmailData } from './connector.interface';
import { GmailConnector } from './gmail';
import { ImapConnector } from './imap';
import { gmailCooldownRemainingMs, isGmailInCooldown, startGmailCooldown, isGmailQuotaError } from './gmailQuota';

function gmailConfigured(): boolean {
  return Boolean(process.env.GMAIL_REFRESH_TOKEN && process.env.GMAIL_CLIENT_ID);
}

function imapOnly(): boolean {
  return (process.env.EMAIL_PROVIDER || 'gmail_api').toLowerCase() === 'imap';
}

function imapConfigured(): boolean {
  const user = process.env.MARKETING_IMAP_USER || process.env.IMAP_USERNAME || '';
  const pass = process.env.MARKETING_IMAP_PASSWORD || process.env.IMAP_PASSWORD || '';
  return Boolean(user.trim() && pass.trim());
}

/** Gmail API first when configured; IMAP on error or quota cooldown. Force IMAP with EMAIL_PROVIDER=imap. */
export class FallbackEmailConnector implements IEmailConnector {
  private gmail = new GmailConnector();
  private imap = new ImapConnector();

  private gmailTimeoutMs(): number {
    const n = parseInt(process.env.RELAY_GMAIL_FETCH_TIMEOUT_MS || '20000', 10);
    return Number.isFinite(n) && n > 0 ? n : 20000;
  }

  private async tryGmail(
    fetch: () => Promise<EmailData[]>,
    label: string,
  ): Promise<EmailData[] | null> {
    if (imapOnly() || !gmailConfigured() || isGmailInCooldown()) {
      if (isGmailInCooldown()) {
        const mins = Math.ceil(gmailCooldownRemainingMs() / 60000);
        console.log(`[relay] Gmail cooldown active (${mins}m left) — using IMAP for ${label}`);
      }
      return null;
    }

    const timeoutMs = this.gmailTimeoutMs();

    try {
      const emails = await Promise.race([
        fetch(),
        new Promise<EmailData[]>((_, reject) => {
          setTimeout(
            () => reject(new Error(`Gmail API ${label} timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);

      console.log(`[relay] Gmail API ${label}: ${emails.length} message(s)`);
      return emails;
    } catch (err) {
      if (isGmailQuotaError(err)) {
        startGmailCooldown();
        console.warn(`[relay] Gmail API ${label} quota exceeded — falling back to IMAP`);
      } else {
        console.warn(
          `[relay] Gmail API ${label} failed — falling back to IMAP:`,
          (err as Error)?.message || err,
        );
      }

      return null;
    }
  }

  /** One inbox pass — today via Gmail API or IMAP (avoids double-fetch quota burn). */
  async fetchInbox(): Promise<EmailData[]> {
    const forceImap =
      process.env.RELAY_FETCH_FORCE_IMAP === '1' ||
      process.env.RELAY_FETCH_FORCE_IMAP === 'true';

    if (forceImap) {
      console.log('[relay] RELAY_FETCH_FORCE_IMAP=1 — using IMAP for inbox');
      return this.imap.fetchRecentInbox();
    }

    // Prefer today's window (fetchRecentInbox) — full unread/7d path is too slow when Gmail stalls.
    const fromGmail = await this.tryGmail(
      () => this.gmail.fetchRecentInbox(),
      'inbox',
    );

    if (fromGmail) return fromGmail;

    if (!imapConfigured()) {
      throw new Error(
        'Gmail API inbox fetch failed and IMAP is not configured — set GMAIL_* OAuth vars or uncomment IMAP credentials',
      );
    }

    console.log('[relay] Using IMAP for inbox fetch');
    return this.imap.fetchRecentInbox();
  }

  async fetchRecentInbox(): Promise<EmailData[]> {
    return this.fetchInbox();
  }

  async fetchUnreadEmails(): Promise<EmailData[]> {
    if (gmailConfigured()) {
      try {
        const emails = await this.gmail.fetchUnreadEmails();
        console.log(`[relay] Gmail API inbox: ${emails.length} message(s)`);
        return emails;
      } catch (err) {
        console.warn(
          '[relay] Gmail API inbox failed — falling back to IMAP:',
          (err as Error)?.message || err,
        );
      }
    }

    console.log('[relay] Using IMAP for inbox fetch');
    return this.imap.fetchUnreadEmails();
  }

  async fetchSentEmails(): Promise<EmailData[]> {
    const fromGmail = await this.tryGmail(
      () => this.gmail.fetchSentEmails(),
      'sent',
    );

    if (fromGmail) return fromGmail;

    if (!imapConfigured()) {
      console.warn(
        '[relay] Gmail sent sync failed and IMAP not configured — skipping sent folder',
      );
      return [];
    }

    return this.imap.fetchSentEmails();
  }

  async markAsRead(messageId: string): Promise<void> {
    if (gmailConfigured()) {
      try {
        await this.gmail.markAsRead(messageId);
        return;
      } catch {
        /* try IMAP */
      }
    }

    if (imapConfigured()) {
      await this.imap.markAsRead(messageId);
      return;
    }

    console.warn('[relay] markAsRead: Gmail failed and IMAP not configured — skipped');
  }
}