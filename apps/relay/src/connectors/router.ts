import { IEmailConnector } from './connector.interface';
import { FallbackEmailConnector } from './fallback';
import { ImapConnector } from './imap';
import dotenv from 'dotenv';

dotenv.config();

export class EmailConnectorFactory {
  /** Gmail API primary; IMAP fallback (see fallback.ts). Force IMAP with EMAIL_PROVIDER=imap. */
  public static getConnector(): IEmailConnector {
    const provider = (process.env.EMAIL_PROVIDER || 'gmail_api').toLowerCase();

    if (provider === 'imap') {
      console.log('[relay] EMAIL_PROVIDER=imap — using IMAP only');
      return new ImapConnector();
    }

    console.log('[relay] Gmail API primary (IMAP fallback if Gmail fails)');
    return new FallbackEmailConnector();
  }
}
