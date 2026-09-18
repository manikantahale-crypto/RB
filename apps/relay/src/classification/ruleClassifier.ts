import { classifySenderVendorStatus } from '../matching/vendorMatcher';
import { hasStaffingSignals, isMarketingOrPortalEmail, isServiceNotificationEmail } from './staffingSignals';

export function extractLatestEmailBody(rawBody: string): string {
  if (!rawBody) return '';
  let body = rawBody;

  const markers = [
    'on thu,', 'on mon,', 'on tue,', 'on wed,', 'on fri,', 'on sat,', 'on sun,',
    'wrote:', 'from:', 'sent:', 'to:', 'subject:',
    '-----original message-----', '---------- forwarded message ---------',
    'mail delivery subsystem', 'mailer-daemon', 'address not found',
    'delivery status notification', "your message wasn't delivered",
    'the response was:', '550 5.1.1', 'learn more',
  ];

  let earliestIdx = body.length;
  const bodyLower = body.toLowerCase();

  for (const marker of markers) {
    const idx = bodyLower.indexOf(marker);
    if (idx !== -1 && idx < earliestIdx) {
      earliestIdx = idx;
    }
  }

  let extracted = body.substring(0, earliestIdx).trim();

  if (!extracted && body.trim()) {
    extracted = body.trim().substring(0, 2000);
  }

  return extracted;
}

export async function classifyEmailMessage(emailData: any, vendorsMap: any = null): Promise<any> {
  const fromEmail = (emailData.fromEmail || '').trim().toLowerCase();
  const fromName = (emailData.fromName || '').trim();
  const subject = (emailData.subject || '').trim();
  const bodyText = (emailData.fullBodyText || emailData.bodyPreview || '').trim();

  const latestBody = extractLatestEmailBody(bodyText);
  const latestBodyLower = latestBody.toLowerCase();
  const subjectLower = subject.toLowerCase();
  const checkText = `${subjectLower} | ${latestBodyLower}`;

  let direction = emailData.direction;
  if (!direction) {
    direction = emailData.isSent === true ? 'sent' : 'received';
  }
  const toEmail = emailData.toEmail || emailData.to || (direction === 'received' ? 'me' : fromEmail);

  const ownMailbox = (
    process.env.MARKETING_IMAP_USER ||
    process.env.IMAP_USERNAME ||
    process.env.SMTP_USERNAME ||
    ''
  ).toLowerCase();

  // Outbound mail we sent
  if (direction === 'sent' || (ownMailbox && fromEmail === ownMailbox)) {
    return {
      id: emailData.id || emailData.emailId,
      emailId: emailData.id || emailData.emailId,
      threadId: emailData.threadId || emailData.id || emailData.emailId,
      fromEmail,
      fromName,
      toEmail,
      subject,
      date: emailData.date || '',
      direction: 'sent',
      mainBucket: 'Sent',
      senderType: 'self',
      vendorMatch: false,
      externalSender: false,
      vendor: null,
      classificationReason: 'Outbound message sent from our mailbox',
      recommendedAction: 'Track recipient response',
      replyIntent: 'Sent',
      requiresFollowup: false,
      priority: 'Low',
      status: 'Sent',
      latestBody,
      confidenceScore: 1.0,
    };
  }

  // Bounce
  let isBounce = false;
  const bounceKeywords = [
    'mailer-daemon', 'mail delivery subsystem', 'delivery status notification',
    'address not found', "message wasn't delivered", 'message not delivered',
    'undelivered mail', '550 5.1.1', 'recipient address rejected',
    'mailbox unavailable', 'no such user', 'email account does not exist',
  ];
  if (
    ['mailer-daemon', 'postmaster'].some((kw) => fromEmail.includes(kw)) ||
    bounceKeywords.some((kw) => subjectLower.includes(kw)) ||
    bounceKeywords.some((kw) => latestBodyLower.includes(kw))
  ) {
    isBounce = true;
  }

  const isPortal = !isBounce && (isMarketingOrPortalEmail(fromEmail, fromName, subject, latestBody) || isServiceNotificationEmail(fromEmail, fromName, subject, latestBody));

  const vendorStatus = await classifySenderVendorStatus(fromEmail, vendorsMap);
  const vendorMatch = vendorStatus.vendorMatch || false;
  let vendorInfo = null;
  if (vendorMatch) {
    vendorInfo = {
      id: vendorStatus.vendorId,
      name: vendorStatus.vendorName,
      email: vendorStatus.vendorEmail,
    };
  }

  const staffing = hasStaffingSignals(subject, latestBody);

  let mainCategory = '';
  let senderType = '';
  if (isBounce) {
    mainCategory = 'Bounces';
    senderType = 'bounce';
  } else if (isPortal) {
    mainCategory = 'Portal Notifications';
    senderType = 'portal';
  } else if (vendorMatch) {
    mainCategory = 'Vendor Replies';
    senderType = 'vendor';
  } else if (staffing) {
    mainCategory = 'Non-Vendor Emails';
    senderType = 'external';
  } else {
    mainCategory = 'Non-Vendor Emails';
    senderType = 'external';
  }

  let requiresFollowup = false;
  let replyType = 'Portal Notifications';

  if (isBounce) {
    replyType = 'Bounce';
  } else if (isPortal) {
    replyType = 'Portal Notifications';
    requiresFollowup = false;
  } else if (
    ['not interested', 'no openings', 'no requirement', 'remove me', 'stop sending', 'not looking'].some((kw) =>
      checkText.includes(kw),
    )
  ) {
    replyType = vendorMatch ? 'Vendor Reply' : 'Non-Vendor Reply';
    requiresFollowup = false;
  } else if (
    ['rejected', 'not matching', 'not a fit', 'no position', 'not moving forward', 'client rejected'].some((kw) =>
      checkText.includes(kw),
    )
  ) {
    replyType = vendorMatch ? 'Vendor Reply' : 'Non-Vendor Reply';
  } else if (
    [
      'requirement', 'jd', 'job description', 'client requirement', 'position', 'role', 'opening',
      'hot requirement', 'suitable profiles', 'updated hotlist', 'available positions', 'job availability',
      'job summary', 'years of experience', 'employment type', 'developer req', 'urgent python',
      'deep learning', 'machine learning', 'ai engineer', 'ml engineer', 'data engineer',
      'artificial intelligence', 'ai/deep learning', 'ai deep learning',
    ].some((kw) => checkText.includes(kw)) ||
    (checkText.includes('experience') && checkText.includes('location') && checkText.includes('visa'))
  ) {
    if (vendorMatch) {
      replyType = 'Requirement Shared';
      requiresFollowup = true;
    } else if (staffing) {
      replyType = 'Requirement Shared';
      requiresFollowup = true;
    } else {
      replyType = 'Non-Vendor Reply';
      requiresFollowup = false;
    }
  } else if (
    ['shortlist', 'short-listed', 'selected for interview', 'chosen for interview', 'scheduled for interview'].some((kw) =>
      checkText.includes(kw),
    )
  ) {
    replyType = checkText.includes('shortlist') ? 'Candidate Shortlisted' : 'Selected for Interview';
    requiresFollowup = true;
  } else if (
    ['interview feedback', 'feedback on', 'evaluation result', 'panel feedback', 'cleared the interview', 'client evaluation', 'interview outcome'].some((kw) =>
      checkText.includes(kw),
    )
  ) {
    replyType = 'Interview Feedback';
    requiresFollowup = true;
  } else if (
    [
      'share resume', 'send resume', 'resume please', 'profile please', 'share profile', 'send profile',
      'updated resume', 'consultant resume', 'need profile', 'resume copy', 'latest resume',
      'send profiles', 'resumes and rates', 'share profiles',
    ].some((kw) => checkText.includes(kw))
  ) {
    replyType = 'Need Resume';
    requiresFollowup = true;
  } else if (
    /\b(pay rate|billing rate|expected rate|hourly rate|c2c rate|salary expectation|what is your rate)\b/.test(checkText)
  ) {
    replyType = 'Rate Asked';
    requiresFollowup = true;
  } else if (
    [
      'interview', 'available for call', 'schedule call', 'slots', 'time slots', 'interview slot',
      'client call', 'teams call', 'zoom call', 'skype', 'discussion slot',
    ].some((kw) => checkText.includes(kw))
  ) {
    replyType = 'Interview Request';
    requiresFollowup = true;
  } else if (
    ['c2c', 'consultant', 'candidate', 'availability', 'rtr', 'right to represent'].some((kw) => checkText.includes(kw))
  ) {
    replyType = 'Follow-up';
    requiresFollowup = true;
  } else if (!staffing && !vendorMatch) {
    replyType = 'Portal Notifications';
    requiresFollowup = false;
  } else {
    replyType = vendorMatch ? 'Vendor Reply' : 'Non-Vendor Reply';
    requiresFollowup = staffing;
  }

  let priority = 'Low';
  if (requiresFollowup) {
    if (
      [
        'Interview Request', 'Selected for Interview', 'Candidate Shortlisted',
        'Need Resume', 'Rate Asked', 'Requirement Shared',
      ].includes(replyType)
    ) {
      priority = 'High';
    } else {
      priority = 'Medium';
    }
  }

  const externalSender = !vendorMatch && !isBounce && !isPortal;

  let confidenceScore = 1.0;
  if (isBounce) {
    confidenceScore = 0.98;
  } else if (isPortal) {
    confidenceScore = 0.98;
  } else if (
    !['Vendor Reply', 'Non-Vendor Reply', 'Follow-up', 'Portal Notifications', 'Bounce', 'Sent'].includes(replyType)
  ) {
    confidenceScore = 0.8;
  } else if (['Vendor Reply', 'Non-Vendor Reply'].includes(replyType)) {
    confidenceScore = 0.55;
  } else if (replyType === 'Follow-up') {
    confidenceScore = 0.65;
  }

  return {
    id: emailData.id || emailData.emailId,
    emailId: emailData.id || emailData.emailId,
    threadId: emailData.threadId || emailData.id || emailData.emailId,
    fromEmail,
    fromName,
    toEmail,
    subject,
    date: emailData.date || '',
    direction,
    mainBucket: mainCategory,
    senderType,
    vendorMatch,
    externalSender,
    vendor: vendorInfo,
    classificationReason: `Sender=${senderType}, Vendor=${vendorMatch}, Staffing=${staffing}, Portal=${isPortal}`,
    recommendedAction: requiresFollowup ? 'Follow up immediately' : 'No action needed',
    replyIntent: replyType,
    requiresFollowup,
    priority,
    status: requiresFollowup ? 'Follow-Up Needed' : 'New',
    latestBody,
    confidenceScore,
  };
}
