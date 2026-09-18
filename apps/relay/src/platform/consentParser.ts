export type ConsentDecision = 'approved' | 'rejected' | 'unknown';

function replyOnlyText(body: string, subject = ''): string {
  const raw = `${subject}\n${body || ''}`;
  const cut = raw.split(
    /\nOn\s.+wrote:|\nFrom:\s|\n_{2,}|\n-+\s*Original Message\s*-+/i,
  )[0];
  return cut
    .split('\n')
    .filter((line) => !line.trim().startsWith('>'))
    .join('\n');
}

/** Parse candidate email reply for consent yes/no. Ignore quoted original template. */
export function parseCandidateConsent(body: string, subject = ''): ConsentDecision {
  const text = replyOnlyText(body, subject).toLowerCase();

  const explicitYes =
    /\b(yes,?\s*i confirm|✅\s*yes|i confirm)\b/.test(text) ||
    /^\s*(yes|yeah|yep)\b/.test(text.trim());
  if (explicitYes) return 'approved';

  const explicitNo =
    /\b(i am not okay|❌\s*i am not okay)\b/.test(text) ||
    /^\s*(no|nope|nah)\b/.test(text.trim());
  if (explicitNo) return 'rejected';

  const rejectPatterns = [
    /\b(i am not okay|not okay|no thanks|no thank you|decline|declined|pass on|not available|cannot take|can't take)\b/,
    /\b(not looking|already placed|accepted another|no longer available)\b/,
    /\b(reject|rejected|withdraw|not interested)\b/,
  ];
  if (rejectPatterns.some((p) => p.test(text))) return 'rejected';

  const approvePatterns = [
    /\b(yes|yeah|yep|sure|ok|okay|confirm|confirmed|accept|accepted|interested|please share|go ahead|proceed)\b/,
    /\b(available|can interview|works for me|sounds good|happy to)\b/,
  ];
  if (approvePatterns.some((p) => p.test(text))) return 'approved';

  return 'unknown';
}

