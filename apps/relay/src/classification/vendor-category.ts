/**
 * Pipeline model: Category (who) vs Intent (what).
 * Registered vendors → inbox category Vendor Reply; intent stays operational (Requirement Shared, etc.).
 */

export const OPERATIONAL_INTENTS = [
  'Requirement Shared',
  'Rate Asked',
  'Need Resume',
  'Interview Request',
  'Selected for Interview',
  'Candidate Shortlisted',
  'Interview Feedback',
  'Client Submission',
  'Follow-up',
  'Follow-Up Needed',
  'Vendor Reply',
  'Non-Vendor Reply',
  'Non-Vendor Email',
  'Candidate Response',
  'Portal Notifications',
  'Bounce',
  'Sent',
] as const;

export type OperationalIntent = (typeof OPERATIONAL_INTENTS)[number];

const HIGH_PRIORITY_INTENTS = new Set([
  'Interview Request',
  'Selected for Interview',
  'Candidate Shortlisted',
  'Need Resume',
  'Rate Asked',
  'Requirement Shared',
  'Client Submission',
]);

/** Apply vendor category lock + normalize priority after rules/LLM. */
export function finalizeClassification(
  classification: Record<string, unknown>,
): Record<string, unknown> {
  const vendorMatch = Boolean(classification.vendorMatch);
  const replyIntent = String(classification.replyIntent || '');
  const isPortal = replyIntent === 'Portal Notifications' || classification.mainBucket === 'Portal Notifications';
  const isBounce = replyIntent === 'Bounce' || classification.mainBucket === 'Bounces';
  const isSent = classification.direction === 'sent' || replyIntent === 'Sent';

  let mainBucket = classification.mainBucket;
  let inboxCategory = classification.inboxCategory;

  if (isSent) {
    mainBucket = 'Sent';
    inboxCategory = 'Sent';
  } else if (isBounce) {
    mainBucket = 'Bounces';
    inboxCategory = 'Bounce';
  } else if (isPortal) {
    mainBucket = 'Portal Notifications';
    inboxCategory = 'Portal Notifications';
  } else if (vendorMatch) {
    mainBucket = 'Vendor Replies';
    inboxCategory = 'Vendor Reply';
  } else {
    mainBucket = mainBucket || 'Non-Vendor Emails';
    inboxCategory = 'Non-Vendor Reply';
  }

  const requiresFollowup = Boolean(classification.requiresFollowup);
  let priority = classification.priority;
  if (requiresFollowup && (!priority || priority === 'Low')) {
    priority = HIGH_PRIORITY_INTENTS.has(replyIntent) ? 'High' : 'Medium';
  }

  return {
    ...classification,
    mainBucket,
    inboxCategory,
    priority,
    status: requiresFollowup ? 'Follow-Up Needed' : classification.status || 'New',
  };
}

export function isDeterministicRuleResult(rule: Record<string, unknown>): boolean {
  if (rule.direction === 'sent') return true;
  const intent = String(rule.replyIntent || '');
  if (intent === 'Bounce' || intent === 'Portal Notifications') return true;
  if (rule.mainBucket === 'Bounces' || rule.mainBucket === 'Portal Notifications') return true;
  return false;
}
