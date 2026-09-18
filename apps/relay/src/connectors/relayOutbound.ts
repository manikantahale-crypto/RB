/** Central gate + compact logging for Relay outbound email. */

import { gmailCooldownRemainingMs, isGmailInCooldown, startGmailCooldown, isGmailQuotaError } from './gmailQuota';

export function relayOutboundEnabled(): boolean {
  const flag = (process.env.RELAY_OUTBOUND_SEND || '1').toLowerCase();
  return flag !== '0' && flag !== 'false';
}

export function formatSendError(error: unknown): string {
  if (!error) return 'unknown error';
  const err = error as { message?: string; cause?: { message?: string }; response?: { data?: { error?: { message?: string } } } };
  return (
    err.cause?.message ||
    err.response?.data?.error?.message ||
    err.message ||
    String(error)
  );
}

export function logSendFailure(channel: 'Gmail API' | 'SMTP', to: string, subject: string, error: unknown): string {
  const detail = formatSendError(error);
  const retryAfter = detail.match(/Retry after ([^\s)]+)/i)?.[1];
  const short =
    detail.includes('Daily user sending limit') || detail.includes('Daily sending limit')
      ? 'daily send quota exceeded'
      : detail.includes('User-rate limit exceeded') || detail.includes('rate limit')
        ? `send rate limit${retryAfter ? ` — retry after ${retryAfter}` : ''}`
        : detail.slice(0, 160);
  console.warn(`[relay][${channel}] send failed → ${to} | "${subject.slice(0, 60)}" | ${short}`);
  if (isGmailQuotaError(error) || /daily user sending limit|user-rate limit exceeded/i.test(detail)) {
    startGmailCooldown();
  }
  return short;
}

export function shouldSkipOutboundSend(context: string): boolean {
  if (!relayOutboundEnabled()) {
    console.log(`[relay] Outbound send skipped (${context}) — RELAY_OUTBOUND_SEND=0`);
    return true;
  }
  if (isGmailInCooldown()) {
    const mins = Math.ceil(gmailCooldownRemainingMs() / 60000);
    console.warn(`[relay] Outbound send skipped (${context}) — Gmail quota cooldown (~${mins}m left)`);
    return true;
  }
  return false;
}
