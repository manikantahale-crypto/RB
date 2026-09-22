/**
 * What a vendor's reply means, pinned.
 *
 * The reject list used to end with `/\b\bno\b/i` — the word anywhere, tested
 * before any acceptance — so the four "reads as accepted" cases below were all
 * recorded as REJECTED submissions. `prism.vendor.record` writes that answer
 * straight onto the submission, so a vendor saying "no problem, please
 * proceed" closed the candidate out.
 *
 * The phrase lists are deliberately not exhaustive: a reply nobody can read
 * confidently must come back `unknown` and reach a person, never a guess.
 */
import { describe, expect, it } from 'vitest';
import { parseVendorResponse } from './vendorParser.js';

describe('parseVendorResponse — a bare "no" is only an answer when it stands alone', () => {
  it('reads a positive reply that happens to contain "no" as accepted', () => {
    expect(parseVendorResponse('No problem, please proceed.')).toBe('accepted');
    expect(parseVendorResponse('No worries, the profile looks good.')).toBe('accepted');
    expect(parseVendorResponse('Nothing further needed, we accept.')).toBe('accepted');
  });

  it('still reads a refusal that is only the word', () => {
    expect(parseVendorResponse('No')).toBe('rejected');
    expect(parseVendorResponse('no.')).toBe('rejected');
    expect(parseVendorResponse('Nope')).toBe('rejected');
  });

  it('still reads a refusal that opens with it and then gives a reason', () => {
    expect(parseVendorResponse("No, we'll take someone else.")).toBe('rejected');
    expect(parseVendorResponse('No. Please remove us from this one.')).toBe('rejected');
  });

  it('leaves the spelled-out refusals alone', () => {
    expect(parseVendorResponse('No thanks.')).toBe('rejected');
    expect(parseVendorResponse('We are no longer hiring for this role.')).toBe('rejected');
    expect(parseVendorResponse('Not a fit, sorry.')).toBe('rejected');
  });

  it('reads the refusal, not the word inside it — rejections are tested first', () => {
    // "not interested" contains "interested", which is an accept pattern.
    expect(parseVendorResponse('Not interested at this time.')).toBe('rejected');
    expect(parseVendorResponse('We will not proceed with this candidate.')).toBe('rejected');
  });

  it('ignores a "no" that belongs to the quoted original underneath the reply', () => {
    const reply = [
      'Sure, please proceed.',
      '',
      'On Mon, 22 Sep 2026, Bench Sales wrote:',
      '> Can you take this candidate? If not, no action is needed.',
      '> no',
    ].join('\n');
    expect(parseVendorResponse(reply)).toBe('accepted');
  });

  it('reads the subject as well as the body', () => {
    expect(parseVendorResponse('', 'RE: Submission — approved')).toBe('accepted');
    expect(parseVendorResponse('', 'No')).toBe('rejected');
  });

  it('says unknown rather than guessing', () => {
    expect(parseVendorResponse('Thanks for sending this over.')).toBe('unknown');
    expect(parseVendorResponse('')).toBe('unknown');
  });

  /**
   * The phrase lists are literal, so a vendor who words it slightly differently
   * gets `unknown` and a person reads the mail. That is the safe failure and
   * the reason these two are pinned rather than fixed here: widening the lists
   * is a judgement about real vendor mail, not a regex tidy-up.
   */
  it('does not recognise these real phrasings — they reach a person instead', () => {
    expect(parseVendorResponse('no issues — send the RTR')).toBe('unknown'); // list has "send rtr", not "send the rtr"
    expect(parseVendorResponse('The rate is too high for us.')).toBe('unknown'); // list has "rate too high"
  });
});
