/** What the recruiter should do for each classification intent. */
export function recruiterActionForIntent(replyIntent?: string, category?: string): string | null {
  const intent = (replyIntent || '').trim();
  switch (intent) {
    case 'Need Resume':
      return 'Send updated resume/profile with rate and availability (auto-reply when RELAY_AUTO_REPLY=1)';
    case 'Rate Asked':
      return 'Reply with C2C/W2 rate and visa status for the matched candidate';
    case 'Requirement Shared':
      return 'Pipeline: Astra parses JD → Syntra matches bench → consent emails to top candidates → submit profile on approval';
    case 'Interview Request':
    case 'Selected for Interview':
      return 'Confirm candidate slots and send calendar invite to vendor/client';
    case 'Candidate Shortlisted':
      return 'Acknowledge shortlist and prepare candidate for next round';
    case 'Interview Feedback':
    case 'Client Evaluation':
      return 'Review client/vendor feedback and update candidate pipeline status';
    case 'Vendor Reply':
      return 'Respond to registered vendor — submission, rate, or requirement update';
    case 'Non-Vendor Reply':
      return 'Review sender — use Add to JD Library if this is a real requirement, or register them as a vendor first';
    case 'Follow-up':
      return 'Send follow-up on pending candidate or requirement thread — Add to JD if this email contains a new requirement';
    case 'Bounce':
      return 'Fix recipient email and resend submission';
    default:
      if (category === 'Interview Response') return 'Schedule interview or act on evaluation feedback';
      if (category === 'Candidate Response') return 'Update candidate status — use Add to JD Library only if this email is actually a job requirement';
      return null;
  }
}
