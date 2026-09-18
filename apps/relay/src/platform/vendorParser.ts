export type VendorDecision = 'accepted' | 'rejected' | 'unknown';

/**
 * Parse vendor email reply for submission decision (accepted / rejected / unknown).
 * Handles affirmative confirmations vs rejections.
 */
export function parseVendorResponse(body: string, subject = ''): VendorDecision {
  const text = `${subject}\n${body}`.toLowerCase();

  const rejectPatterns = [
    /\b(not interested|no thanks|no thank you|decline|pass on|rejected|reject|not a fit|not suitable)\b/,
    /\b(position closed|role closed|filled|no longer hiring|canceled|cancelled|rate too high)\b/,
    /\b(cannot proceed|will not proceed|not moving forward|do not proceed)\b/,
    /\b\bno\b/i,
  ];
  if (rejectPatterns.some((p) => p.test(text))) return 'rejected';

  const acceptPatterns = [
    /\b(yes|accepted|accept|we accept|interested|proceed|please proceed|submit|please submit|approved|approve)\b/,
    /\b(shortlisted|schedule interview|set up interview|interview|send over|moving forward|looks good|profile looks good)\b/,
    /\b(client interested|lock this candidate|send rtr)\b/,
  ];
  if (acceptPatterns.some((p) => p.test(text))) return 'accepted';

  return 'unknown';
}
