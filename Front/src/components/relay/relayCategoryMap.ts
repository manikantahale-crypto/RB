import { RelayCategory } from '../../types';

const STAFFING_JD_INTENTS = new Set([
  'Requirement Shared',
  'Rate Asked',
  'Need Resume',
  'Vendor Reply',
  'Follow-up',
  'Client Submission',
  'Non-Vendor Reply',
]);

const INTENT_DISPLAY: Record<string, string> = {
  'Requirement Shared': 'JD Received',
  'Rate Asked': 'Rate Asked',
  'Need Resume': 'Need Resume',
  'Client Submission': 'Client Submission',
  'Candidate Response': 'Candidate Reply',
  'Follow-up': 'Follow-up',
  'Follow-Up Needed': 'Follow-up',
};

/**
 * Maps backend classification to Smart Inbox UI tabs.
 */
export function mapReplyIntentToCategory(
  replyIntent: string | null | undefined,
  opts?: {
    direction?: string;
    vendorMatch?: boolean;
    registeredCandidate?: boolean;
    hasInbound?: boolean;
  },
): RelayCategory {
  const hasInbound = opts?.hasInbound !== false;
  if ((opts?.direction === 'sent' || replyIntent === 'Sent') && !hasInbound) {
    return 'Sent';
  }

  const intent = (replyIntent || '').trim();

  if (intent === 'Bounce') return 'Bounce';
  if (intent === 'Portal Notifications' || intent === 'Portal Notification') {
    return 'Portal Notifications';
  }

  // Registered vendor page emails always map to Vendor Reply (category), regardless of LLM intent.
  if (opts?.vendorMatch) {
    return 'Vendor Reply';
  }

  if (STAFFING_JD_INTENTS.has(intent)) {
    return 'Non-Vendor Reply';
  }

  if (intent === 'Candidate Consent Request' && opts?.direction === 'sent' && !opts?.hasInbound) {
    return 'Sent';
  }

  if (intent === 'Candidate Response' || intent === 'Candidate Consent Request') {
    return 'Candidate Response';
  }

  if (opts?.registeredCandidate) {
    return 'Candidate Response';
  }

  switch (intent) {
    case 'Vendor Reply':
    case 'Client Submission':
      return 'Vendor Reply';
    case 'Requirement Shared':
    case 'Rate Asked':
    case 'Need Resume':
      return 'Non-Vendor Reply';
    case 'Non-Vendor Reply':
    case 'Non-Vendor Email':
      return 'Non-Vendor Reply';
    case 'Not Interested':
    case 'Rejected':
      return 'Non-Vendor Reply';
    case 'Unclassified':
      return 'Portal Notifications';
    case 'Interview Request':
    case 'Selected for Interview':
    case 'Candidate Shortlisted':
    case 'Interview Feedback':
    case 'Client Evaluation':
      return 'Interview Response';
    case 'Follow-up':
    case 'Follow-Up Needed':
      return 'Follow-up';
    case 'Sent':
      return 'Sent';
    default:
      if (/^sent$/i.test(intent)) return 'Sent';
      if (/interview request|selected for interview|interview feedback|client evaluation/i.test(intent)) {
        return 'Interview Response';
      }
      if (/portal|notification|alert|newsletter/i.test(intent)) return 'Portal Notifications';
      if (/bounce|undelivered|mailer-daemon/i.test(intent)) return 'Bounce';
      if (/requirement|hotlist|position|jd|profile|availability/i.test(intent)) return 'Non-Vendor Reply';
      return 'Portal Notifications';
  }
}

/** Short label for list badges — vendor JDs show Vendor Reply; external staffing shows JD Received. */
export function inboxBadgeLabel(
  category: RelayCategory,
  replyIntent?: string | null,
): string {
  const intent = (replyIntent || '').trim();
  if (intent === 'Requirement Shared') {
    return category === 'Vendor Reply' ? 'Vendor Reply' : 'JD Received';
  }
  if (intent && INTENT_DISPLAY[intent]) return INTENT_DISPLAY[intent];
  return category;
}

/** True only for staffing emails that need recruiter attention — not portal/sent/bounce. */
export function isRecruiterPriorityEmail(
  category: RelayCategory,
  opts: {
    priority?: string | null;
    requiresFollowup?: boolean;
    followupOpen?: boolean;
  },
): boolean {
  if (category === 'Portal Notifications' || category === 'Sent' || category === 'Bounce') {
    return false;
  }
  return (
    opts.priority === 'High' ||
    opts.priority === 'Medium' ||
    Boolean(opts.requiresFollowup) ||
    Boolean(opts.followupOpen)
  );
}

export function categoryActionRecommendation(category: RelayCategory, requiresFollowup: boolean): string {
  if (category === 'Sent') return 'Track whether the recipient responds';
  if (!requiresFollowup) {
    if (category === 'Portal Notifications') return 'No action — portal or marketing notification';
    if (category === 'Bounce') return 'Verify recipient email and update contact record';
    return 'Review when convenient — no urgent follow-up flagged';
  }
  switch (category) {
    case 'Interview Response':
      return 'Confirm interview slots and send calendar invite';
    case 'Candidate Response':
      return 'Share resume, rate, or candidate details promptly';
    case 'Vendor Reply':
      return 'Respond to registered vendor requirement or submission';
    case 'Non-Vendor Reply':
      return 'Review JD/profile request from external contact and respond with bench match';
    default:
      return 'Follow up on this conversation';
  }
}
