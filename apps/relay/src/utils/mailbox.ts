export function getOwnMailbox(): string {
  return (
    process.env.GMAIL_SENDER_EMAIL ||
    process.env.MARKETING_IMAP_USER ||
    process.env.IMAP_USERNAME ||
    process.env.SMTP_USERNAME ||
    process.env.EMAIL_FROM ||
    ''
  )
    .trim()
    .toLowerCase();
}

export function isSelfMessage(
  msg: { direction?: string | null; fromEmail?: string | null },
  ownEmail = getOwnMailbox(),
): boolean {
  const from = (msg.fromEmail || '').trim().toLowerCase();
  if (msg.direction === 'sent') return true;
  if (ownEmail && from === ownEmail) return true;
  return false;
}
