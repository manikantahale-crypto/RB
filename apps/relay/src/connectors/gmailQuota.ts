/** Skip Gmail API until this timestamp after quota/rate-limit errors. */
let gmailCooldownUntil = 0;

export function isGmailQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const cause = (err as { cause?: { message?: string } })?.cause?.message || '';
  const combined = `${msg} ${cause}`;
  return (
    /quota exceeded/i.test(combined) ||
    /rate limit/i.test(combined) ||
    /userRateLimitExceeded/i.test(combined) ||
    /user-rate limit exceeded/i.test(combined) ||
    /daily user sending limit/i.test(combined) ||
    /Total Query Cost/i.test(combined)
  );
}

export function isGmailInCooldown(): boolean {
  return Date.now() < gmailCooldownUntil;
}

export function startGmailCooldown(ms?: number): void {
  const minutes = Number(process.env.GMAIL_QUOTA_COOLDOWN_MINUTES || '30');
  const duration = ms ?? Math.max(5, minutes) * 60_000;
  gmailCooldownUntil = Date.now() + duration;
  console.warn(
    `[relay] Gmail send/fetch quota hit — pausing Gmail API for ${Math.round(duration / 60000)}m (IMAP fetch still works)`,
  );
}

export function gmailCooldownRemainingMs(): number {
  return Math.max(0, gmailCooldownUntil - Date.now());
}
