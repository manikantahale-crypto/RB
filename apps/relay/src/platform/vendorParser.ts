export type VendorDecision = 'accepted' | 'rejected' | 'unknown';

/**
 * A BARE "NO" ONLY COUNTS WHEN IT IS THE ANSWER.
 *
 * Until 2026-09-22 the reject list ended with `/\b\bno\b/i`, which matched the
 * word anywhere in the message — and rejections are tested before acceptances,
 * so a vendor writing "No problem, please proceed" or "no issues, send the
 * RTR" was recorded as having REJECTED the submission. It also fired on the
 * word inside the quoted original underneath the reply.
 *
 * `parseCandidateConsent` in this directory already anchors its bare no to the
 * start of a line. These do the same:
 *
 *   BARE_NO      a line that is only "no" / "nope" / "nah"
 *   OPENING_NO   a line that opens "no," or "no." — the answer, then a reason
 *
 * Every other way of saying no is spelled out in the phrase lists below, so
 * "no thanks", "no longer hiring" and "not a fit" are unaffected, while "no
 * problem", "no worries" and a quoted "> no" no longer read as rejections.
 */
const BARE_NO = /^\s*(no|nope|nah)\s*[.!,;:-]*\s*$/m;
const OPENING_NO = /^\s*(no|nope|nah)\s*[,.]\s+/m;

/**
 * Parse vendor email reply for submission decision (accepted / rejected / unknown).
 * Handles affirmative confirmations vs rejections.
 *
 * Rejections are tested first on purpose: "not interested" contains
 * "interested", and the refusal is the meaning.
 */
export function parseVendorResponse(body: string, subject = ''): VendorDecision {
  const text = `${subject}\n${body}`.toLowerCase();

  const rejectPatterns = [
    /\b(not interested|no thanks|no thank you|decline|pass on|rejected|reject|not a fit|not suitable)\b/,
    /\b(position closed|role closed|filled|no longer hiring|canceled|cancelled|rate too high)\b/,
    /\b(cannot proceed|will not proceed|not moving forward|do not proceed)\b/,
    BARE_NO,
    OPENING_NO,
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
