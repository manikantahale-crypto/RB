/** Keywords indicating bench-sales / staffing content (non-portal). */
const STAFFING_KEYWORDS = [
  'share profile', 'share profiles', 'send profile', 'send profiles', 'share resume', 'send resume',
  'updated resume', 'consultant resume', 'candidate profile', 'bench candidate', 'hotlist',
  'hot requirement', 'client requirement', 'job description', 'jd attached', 'requirement for',
  'positions available', 'open positions', 'urgent requirement', 'c2c', 'w2', 'corp to corp',
  'right to represent', 'rtr', 'billing rate', 'pay rate', 'hourly rate', 'availability',
  'interview slot', 'technical interview', 'client submission', 'submit candidate',
  'looking for consultant', 'looking for developer', 'need consultant', 'need developer',
  'suitable profiles', 'matching profiles', 'visa status', 'on bench', 'available for project',
  'trending positions', 'available positions', 'job opening', 'job openings', 'staffing',
  'recruiter', 'submission', 'rate card',
];

const MARKETING_DOMAINS = [
  'linkedin.com', 'indeed.com', 'dice.com', 'monster.com', 'naukri.com', 'jooble.com', 'jooble.',
  'ziprecruiter.com', 'careerbuilder.com', 'foundit.in', 'facebookmail.com', 'newsletter',
  'mailchimp.com', 'sendgrid.net', 'constantcontact.com', 'hubspot.com', 'marketo.com',
  'hp.com', 'hpnews', 'newsgram.hp', 'apollo.io', 'tavily.com', 'crewai.com', 'figma.com',
  'kaggle.com', 'substack.com', 'beehiiv.com', 'foundit.in', 'foundit', 'monsterindia.com',
  'monster.com', 'jobmessenger@', 'click.', 'track.', 'promo.', 'marketing.',
  'crm-', 'news.', 'updates@', 'news@', 'hello@', 'growth@', 'info@',
  'unstop.news', 'unstop.com', 'medium.com', 'replit.com', 'notion.so', 'eventbrite.',
  'mailservice.', 'notification.', 'notifications.', 'engage.', 'campaign.',
];

const MARKETING_SUBJECT_HINTS = [
  'newsletter', 'unsubscribe', 'webinar', 'product update', 'digest', 'promotion', 'offer ends',
  'limited time', 'shop now', 'ranked #1', 'just got better', 'starts now', 'click away',
  'trending in tech', 'ai agent stack', 'benchmark', 'subscription', 'free trial',
  'hot job opportunities', 'job alert', 'new jobs for', 'is hiring', 'jobs waiting for you',
  'your transcript', 'transcript is ready', 'open transcript', 'weekly update', 'week in numbers',
];

/** SaaS / product notification domains (not staffing vendors). */
const SERVICE_NOTIFICATION_DOMAINS = [
  'turboscribe.ai', 'turboscribe.com', 'stripe.com', 'github.com', 'gitlab.com', 'notion.so',
  'figma.com', 'slack.com', 'zoom.us', 'calendly.com', 'dropbox.com', 'google.com',
  'accounts.google.com', 'apple.com', 'microsoft.com', 'openai.com', 'anthropic.com',
  'vercel.com', 'netlify.com', 'heroku.com', 'aws.amazon.com', 'cloud.google.com',
];

const SERVICE_NOTIFICATION_SUBJECT_HINTS = [
  'transcript is ready', 'your transcript', 'open transcript', 'password reset', 'verify your email',
  'sign-in', 'security alert', 'invoice', 'receipt', 'payment received', 'subscription',
  'welcome to', 'account update', 'new sign-in', 'two-factor', 'verification code',
];

export function isServiceNotificationEmail(fromEmail: string, fromName: string, subject: string, body: string): boolean {
  const email = fromEmail.toLowerCase();
  const name = fromName.toLowerCase();
  const subj = subject.toLowerCase();
  const text = `${subj} ${body}`.toLowerCase();

  if (SERVICE_NOTIFICATION_DOMAINS.some((d) => email.includes(d) || name.includes(d))) return true;
  if (SERVICE_NOTIFICATION_SUBJECT_HINTS.some((h) => subj.includes(h) || text.includes(h))) return true;
  if (email.includes('notifications@') && /transcript|invoice|receipt|verify|reset|welcome/i.test(text)) return true;
  return false;
}

export function isMarketingOrPortalEmail(fromEmail: string, fromName: string, subject: string, body: string): boolean {
  if (isServiceNotificationEmail(fromEmail, fromName, subject, body)) return true;
  const email = fromEmail.toLowerCase();
  const name = fromName.toLowerCase();
  const subj = subject.toLowerCase();
  const text = `${subj} ${body}`.toLowerCase();

  if (MARKETING_DOMAINS.some((d) => email.includes(d) || name.includes(d))) return true;
  if (['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster'].some((d) => email.includes(d))) {
    return true;
  }
  if (MARKETING_SUBJECT_HINTS.some((h) => subj.includes(h))) return true;
  if (text.includes('unsubscribe') || text.includes('manage preferences') || text.includes('view in browser')) {
    return true;
  }
  return false;
}

export function hasStaffingSignals(subject: string, body: string): boolean {
  const text = `${subject} ${body}`.toLowerCase();
  return STAFFING_KEYWORDS.some((kw) => text.includes(kw));
}
