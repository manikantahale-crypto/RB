import { RelayCategory, RelayEmail } from '../../types';

export interface RelayCategoryCount {
  category: RelayCategory;
  count: number;
  color: string;
  badgeBg: string;
  badgeText: string;
}

export const RELAY_MOCK_EMAILS: RelayEmail[] = [
  {
    id: 'email-1',
    category: 'Vendor Reply',
    senderName: 'Vikas Mehta',
    senderEmail: 'vikas.mehta@abcsolutions.com',
    senderRole: 'Talent Partner',
    senderCompany: 'ABC Solutions',
    subject: 'Re: Senior Java Developer – 5+ Years',
    preview: 'Thanks Ravi. We reviewed the submitted candidates with our client. Rahul Kumar looks suitable for the Senior Java Developer requirement...',
    body: `Hi Ravi,

Thanks for sharing the profiles.

We reviewed the submitted candidates with our client. Rahul Kumar looks suitable for the Senior Java Developer requirement.

Please confirm Rahul's availability for a technical interview this week.

Thanks,
Vikas`,
    timestamp: '10:24 AM',
    receivedDate: 'May 22, 2025 10:24 AM',
    isUnread: true,
    isPriority: true,
    hasAttachments: false,
    tags: ['Java', '5+ Years', 'Dallas', 'Spring Boot', 'AWS'],
    contact: {
      name: 'Vikas Mehta',
      email: 'vikas.mehta@abcsolutions.com',
      phone: '+91 98765 43210',
      company: 'ABC Solutions',
      title: 'Talent Partner',
    },
    emailDetails: {
      source: 'Gmail',
      receivedAt: 'May 22, 2025 10:24 AM',
      to: 'hiring@tekisho.com',
      cc: 'ravi.shankar@tekisho.com',
      messageId: '<CA+vikas.mehta.82914@abcsolutions.com>',
      threadId: 'thread_987654321',
    },
    actionRequired: {
      status: 'Action Required',
      recommendation: 'Confirm candidate availability for technical interview.',
      variant: 'orange',
    },
    aiSummary: {
      summary: 'Vendor reviewed the submitted profiles and is interested in Rahul Kumar. They are requesting his availability for a technical interview.',
      keyPoints: [
        '1 candidate shortlisted (Rahul Kumar)',
        'Technical interview availability requested',
        'Recruiter response required',
      ],
    },
    linkedRequirement: {
      jdCode: 'JD-2026-0184',
      role: 'Senior Java Developer',
      positions: 2,
      experience: '5+ Years',
      location: 'Dallas, TX',
      skills: ['Java', 'Spring Boot', 'Microservices', 'AWS'],
      vendor: 'ABC Solutions',
    },
    relatedCandidate: {
      name: 'Rahul Kumar',
      role: 'Java Developer',
      experience: '6 Years',
      availability: 'Aug 26',
      status: 'Available',
      skills: ['Java', 'Spring Boot', 'Microservices', 'AWS'],
    },
    followUpSla: {
      text: 'Due tomorrow · 10:00 AM',
      isOverdue: false,
    },
    suggestedReply:
      'Thanks for the update Vikas. Rahul is available for the technical interview this week on Thursday and Friday afternoon EST. Please share the meeting invite and details.',
    thread: [
      {
        id: 'msg-1',
        senderName: 'Vikas Mehta',
        senderEmail: 'vikas.mehta@abcsolutions.com',
        isSelf: false,
        body: `Hi Ravi,

We have a requirement for 2 Senior Java Developers with 5+ years of experience in Java, Spring Boot, Microservices and AWS.

Location: Dallas, TX
Positions: 2

Please share suitable profiles.

Thanks,
Vikas`,
        timestamp: 'May 21, 02:15 PM',
      },
      {
        id: 'msg-2',
        senderName: 'Ravi Shankar',
        senderEmail: 'ravi.shankar@tekisho.com',
        isSelf: true,
        body: `Hi Vikas,

Thanks for sharing the requirement.

We have suitable bench candidates available. Please find the relevant profiles attached for your review:
1. Rahul Kumar (6 Years, Java/Spring Boot/AWS)
2. Anjali Singh (5+ Years, Java/Microservices)

Thanks,
Ravi`,
        timestamp: 'May 21, 04:30 PM',
        attachments: [
          { id: 'att-1', name: 'Candidate_Rahul_Kumar_Resume.pdf', size: '1.4 MB', type: 'application/pdf' },
          { id: 'att-2', name: 'Candidate_Anjali_Singh_Resume.pdf', size: '1.8 MB', type: 'application/pdf' },
        ],
      },
      {
        id: 'msg-3',
        senderName: 'Vikas Mehta',
        senderEmail: 'vikas.mehta@abcsolutions.com',
        isSelf: false,
        body: `Hi Ravi,

Thanks for sharing the profiles.

We reviewed the submitted candidates with our client. Rahul Kumar looks suitable for the Senior Java Developer requirement.

Please confirm Rahul's availability for a technical interview this week.

Thanks,
Vikas`,
        timestamp: 'May 22, 10:24 AM',
      },
    ],
    activity: {
      openCount: 2,
      lastOpenedAt: 'May 22, 10:28 AM',
    },
  },
  {
    id: 'email-2',
    category: 'Non-Vendor Reply',
    senderName: 'David Wilson',
    senderEmail: 'david.wilson@xyztech.com',
    senderRole: 'Recruiter',
    senderCompany: 'XYZ Tech',
    subject: 'Requirement – Senior Java Developer – Dallas',
    preview: 'Hi Ravi, We are currently looking for 2 Senior Java Developers with 5+ years of experience in Java, Spring Boot, and AWS. Location: Dallas, TX...',
    body: `Hi Ravi,

We are currently looking for 2 Senior Java Developers with 5+ years of experience in Java, Spring Boot, and AWS.

Location: Dallas, TX
Positions: 2

Please share suitable profiles with availability and expected rate.

Thanks,
David Wilson
XYZ Tech`,
    timestamp: 'Yesterday',
    receivedDate: 'May 21, 2025 02:15 PM',
    isUnread: false,
    isPriority: false,
    hasAttachments: true,
    attachments: [
      { id: 'att-jd-1', name: 'JD_Senior_Java_Developer_XYZ.pdf', size: '185 KB', type: 'application/pdf' },
    ],
    tags: ['Non-Vendor', 'Java', '5+ Years', 'Dallas', 'AWS', 'Rate Request'],
    contact: {
      name: 'David Wilson',
      email: 'david.wilson@xyztech.com',
      phone: '+1 (555) 789-0123',
      company: 'XYZ Tech',
      title: 'Technical Recruiter',
    },
    emailDetails: {
      source: 'Gmail',
      receivedAt: 'May 21, 2025 02:15 PM',
      to: 'hiring@tekisho.com',
      messageId: '<TB-NVR-2025-44102@xyztech.com>',
      threadId: 'thread_445566778',
    },
    actionRequired: {
      status: 'Action Required',
      recommendation: 'Review non-vendor requirement, identify bench match, and submit profiles with expected rate.',
      variant: 'orange',
    },
    aiSummary: {
      summary: 'Non-registered contact David Wilson from XYZ Tech sent a requirement for 2 Senior Java Developers in Dallas, TX (5+ yrs, Java, Spring Boot, AWS). Rate and availability requested.',
      keyPoints: [
        'Sender is not a registered vendor in system',
        '2 Open positions in Dallas, TX',
        'Skills: Java, Spring Boot, AWS',
        'Submit matching bench profiles with rate',
      ],
    },
    linkedRequirement: {
      jdCode: 'JD-2026-0184',
      role: 'Senior Java Developer',
      positions: 2,
      experience: '5+ Years',
      location: 'Dallas, TX',
      skills: ['Java', 'Spring Boot', 'Microservices', 'AWS'],
      vendor: 'XYZ Tech (Unregistered)',
    },
    followUpSla: {
      text: 'Due in 4 hours',
      isOverdue: false,
    },
    suggestedReply:
      'Hi David, Thanks for reaching out. We have Senior Java Developers available with 5+ years experience in Spring Boot and AWS. Our C2C billing rate is $75/hr. Please find candidate profiles attached.',
    thread: [
      {
        id: 'msg-401',
        senderName: 'David Wilson',
        senderEmail: 'david.wilson@xyztech.com',
        isSelf: false,
        body: `Hi Ravi,

We are currently looking for 2 Senior Java Developers with 5+ years of experience in Java, Spring Boot, and AWS.

Location: Dallas, TX
Positions: 2

Please share suitable profiles with availability and expected rate.

Thanks,
David`,
        timestamp: 'May 21, 02:15 PM',
      },
    ],
    activity: {
      openCount: 2,
      lastOpenedAt: 'May 21, 02:30 PM',
    },
  },
  {
    id: 'email-3',
    category: 'Candidate Response',
    senderName: 'Anjali Singh',
    senderEmail: 'anjali.singh.dev@gmail.com',
    senderRole: 'Bench Candidate',
    senderCompany: 'Tekisho Bench',
    subject: 'Re: Java Developer Opportunity',
    preview: 'Thank you for sharing the opportunity. I am interested in the Java Developer position and available for the next round...',
    body: `Hi Ravi,

Thank you for sharing the opportunity. I am interested in the Java Developer position and available for the next round.

Please let me know the scheduled interview timing.

Thanks,
Anjali`,
    timestamp: '11:45 AM',
    receivedDate: 'May 22, 2025 11:45 AM',
    isUnread: true,
    isPriority: false,
    hasAttachments: false,
    tags: ['Java', 'Bench Candidate', 'Available'],
    contact: {
      name: 'Anjali Singh',
      email: 'anjali.singh.dev@gmail.com',
      phone: '+1 (555) 234-5678',
      company: 'Tekisho Bench',
      title: 'Senior Java / Fullstack Consultant',
    },
    emailDetails: {
      source: 'Gmail',
      receivedAt: 'May 22, 2025 11:45 AM',
      to: 'hiring@tekisho.com',
      cc: 'ravi.shankar@tekisho.com',
      messageId: '<CA+anjali.singh.992@gmail.com>',
      threadId: 'thread_112233445',
    },
    actionRequired: {
      status: 'Action Required',
      recommendation: 'Confirm candidate availability / update candidate status in ORBIT.',
      variant: 'orange',
    },
    aiSummary: {
      summary: 'Candidate Anjali Singh confirmed interest in the Java Developer opportunity and is available for technical interview rounds.',
      keyPoints: [
        'Candidate confirmed interest',
        'Immediate availability for next round',
        'Ready for vendor client submission',
      ],
    },
    relatedCandidate: {
      name: 'Anjali Singh',
      role: 'Java Developer',
      experience: '5+ Years',
      availability: 'Immediate',
      status: 'Bench Active',
      skills: ['Java', 'Spring Boot', 'React', 'AWS'],
    },
    followUpSla: {
      text: 'Due today · 4:00 PM',
      isOverdue: false,
    },
    suggestedReply:
      'Thanks Anjali. We will submit your profile to ABC Solutions for the Dallas position and keep you updated on interview slots.',
    thread: [
      {
        id: 'msg-201',
        senderName: 'Ravi Shankar',
        senderEmail: 'ravi.shankar@tekisho.com',
        isSelf: true,
        body: 'Hi Anjali, We have an immediate client opportunity for a Senior Java Developer in Dallas, TX. Please let me know your availability for technical rounds.',
        timestamp: 'May 22, 11:00 AM',
      },
      {
        id: 'msg-202',
        senderName: 'Anjali Singh',
        senderEmail: 'anjali.singh.dev@gmail.com',
        isSelf: false,
        body: `Hi Ravi,\n\nThank you for sharing the opportunity. I am interested in the Java Developer position and available for the next round.\n\nThanks,\nAnjali`,
        timestamp: 'May 22, 11:45 AM',
      },
    ],
    activity: {
      openCount: 1,
      lastOpenedAt: 'May 22, 11:50 AM',
    },
  },
  {
    id: 'email-4',
    category: 'Interview Response',
    senderName: 'Client Evaluation Team',
    senderEmail: 'hr-evaluations@clientportal.com',
    senderRole: 'Technical Assessment Panel',
    senderCompany: 'Client Enterprise',
    subject: 'Interview Feedback – Rahul Kumar',
    preview: 'Rahul completed the technical interview. The client would like to proceed with the next round. Please confirm his availability...',
    body: `Hi Ravi,

Rahul completed the technical interview.

The client would like to proceed with the next round.

Please confirm his availability for tomorrow at 3:00 PM EST.

Thanks & Regards,
Client Evaluation Team`,
    timestamp: '09:15 AM',
    receivedDate: 'May 22, 2025 09:15 AM',
    isUnread: false,
    isPriority: true,
    hasAttachments: false,
    tags: ['Interview', 'Selected', 'Proceeding', 'Rahul Kumar'],
    contact: {
      name: 'Client Evaluation Team',
      email: 'hr-evaluations@clientportal.com',
      phone: '+1 (800) 450-8800',
      company: 'Client Enterprise',
      title: 'Interview Assessment Panel',
    },
    emailDetails: {
      source: 'Gmail',
      receivedAt: 'May 22, 2025 09:15 AM',
      to: 'hiring@tekisho.com',
      cc: 'ravi.shankar@tekisho.com',
      messageId: '<EVAL-9821034-CL@clientportal.com>',
      threadId: 'thread_334455667',
    },
    actionRequired: {
      status: 'Action Required',
      recommendation: 'Confirm candidate availability for Leadership Final Round.',
      variant: 'orange',
    },
    aiSummary: {
      summary: 'Rahul completed the technical interview and passed assessment (4.8/5). The client wants to coordinate the final leadership round.',
      keyPoints: [
        'Technical assessment passed',
        'Proceeding to Leadership Final Round',
        'Coordinate availability for tomorrow 3:00 PM EST',
      ],
    },
    linkedRequirement: {
      jdCode: 'JD-2026-0184',
      role: 'Senior Java Developer',
      positions: 2,
      experience: '5+ Years',
      location: 'Dallas, TX',
      vendor: 'ABC Solutions',
    },
    relatedCandidate: {
      name: 'Rahul Kumar',
      role: 'Senior Java Developer',
      experience: '6 Years',
      interviewStage: 'Round 2 Passed · Final Round Next',
      status: 'Interviewing',
      skills: ['Java', 'Spring Boot', 'Kafka', 'AWS'],
    },
    followUpSla: {
      text: 'Due today · 5:00 PM',
      isOverdue: false,
    },
    suggestedReply:
      'Thanks for the positive feedback. Rahul is confirmed for tomorrow 3:00 PM EST. Please share the calendar invite and meeting details.',
    thread: [
      {
        id: 'msg-301',
        senderName: 'Client Evaluation Team',
        senderEmail: 'hr-evaluations@clientportal.com',
        isSelf: false,
        body: `Hi Ravi,\n\nRahul completed the technical interview.\n\nThe client would like to proceed with the next round.\n\nPlease confirm his availability.\n\nThanks,\nClient Evaluation Team`,
        timestamp: 'May 22, 09:15 AM',
      },
    ],
    activity: {
      openCount: 3,
      lastOpenedAt: 'May 22, 09:30 AM',
    },
  },
  {
    id: 'email-5',
    category: 'Bounce',
    senderName: 'Mail Delivery System',
    senderEmail: 'mailer-daemon@googlemail.com',
    senderRole: 'Automated Delivery System',
    senderCompany: 'Mail Subsystem',
    subject: 'Delivery failed – Candidate Profile',
    preview: 'The email could not be delivered to the recipient vendor@example.com because the address was not found or unable to receive mail...',
    body: `Delivery Status Notification (Failure)

The email could not be delivered to the recipient vendor@example.com.

Reason: 550 5.1.1 The email account that you tried to reach does not exist.
Original Subject: Candidate Submission - Java Developer Profile

Action: Please verify vendor contact email in your CRM.`,
    timestamp: 'May 21',
    receivedDate: 'May 21, 2025 02:10 PM',
    isUnread: false,
    isPriority: false,
    hasAttachments: false,
    tags: ['Bounce', 'Delivery Failure', 'System Alert'],
    contact: {
      name: 'Mail Delivery System',
      email: 'mailer-daemon@googlemail.com',
      phone: 'N/A',
      company: 'Mail Subsystem',
      title: 'Automated System',
    },
    emailDetails: {
      source: 'Gmail',
      receivedAt: 'May 21, 2025 02:10 PM',
      to: 'ravi.shankar@tekisho.com',
      messageId: '<DSN-912093-BOUNCE@googlemail.com>',
      threadId: 'thread_556677889',
    },
    actionRequired: {
      status: 'Action Required',
      recommendation: 'Resend candidate profile to vendor after correcting the recipient email address.',
      variant: 'orange',
    },
    aiSummary: {
      summary: 'Delivery failed for recipient vendor@example.com (550 5.1.1 User not found).',
      keyPoints: [
        'Delivery failure (550)',
        'Vendor email address invalid',
        'Verify vendor contact in CRM and resubmit',
      ],
    },
    thread: [
      {
        id: 'msg-501',
        senderName: 'Mail Delivery System',
        senderEmail: 'mailer-daemon@googlemail.com',
        isSelf: false,
        body: 'The email could not be delivered to the recipient vendor@example.com.',
        timestamp: 'May 21, 02:10 PM',
      },
    ],
    activity: {
      openCount: 1,
      lastOpenedAt: 'May 21, 02:15 PM',
    },
  },
  {
    id: 'email-6',
    category: 'Follow-up',
    senderName: 'Vikas Mehta',
    senderEmail: 'vikas.mehta@abcsolutions.com',
    senderRole: 'Talent Partner',
    senderCompany: 'ABC Solutions',
    subject: 'Follow-up – Java Developer Requirement',
    preview: 'Just following up on the profiles shared for the Java Developer requirement. Please let us know if you have any updates...',
    body: `Hi Ravi,

Just following up on the profiles shared for the Java Developer requirement.

Please let us know if you have any updates.

Thanks,
Vikas`,
    timestamp: 'May 20',
    receivedDate: 'May 20, 2025 11:30 AM',
    isUnread: false,
    isPriority: false,
    hasAttachments: false,
    tags: ['Follow-up', 'Java', 'ABC Solutions', '5+ Years'],
    contact: {
      name: 'Vikas Mehta',
      email: 'vikas.mehta@abcsolutions.com',
      phone: '+91 98765 43210',
      company: 'ABC Solutions',
      title: 'Talent Partner',
    },
    emailDetails: {
      source: 'Gmail',
      receivedAt: 'May 20, 2025 11:30 AM',
      to: 'ravi.shankar@tekisho.com',
      messageId: '<CA+vikas.followup.2091@abcsolutions.com>',
      threadId: 'thread_667788990',
    },
    actionRequired: {
      status: 'Follow-up Required',
      recommendation: 'Send status update regarding candidate availability.',
      variant: 'purple',
    },
    aiSummary: {
      summary: 'Vendor is following up on the candidate profiles shared for the Java Developer requirement.',
      keyPoints: [
        'Vendor awaiting status update',
        'Profiles under client review',
        'Provide candidate availability update',
      ],
    },
    linkedRequirement: {
      jdCode: 'JD-2026-0184',
      role: 'Senior Java Developer',
      positions: 2,
      experience: '5+ Years',
      location: 'Dallas, TX',
      vendor: 'ABC Solutions',
    },
    relatedCandidate: {
      name: 'Rahul Kumar',
      role: 'Java Developer',
      experience: '6 Years',
      availability: 'Aug 26',
    },
    followUpSla: {
      text: 'Due today · 2:00 PM',
      isOverdue: false,
    },
    suggestedReply:
      'Hi Vikas, Rahul Kumar and Anjali Singh are both actively available on our bench. Looking forward to client interview feedback.',
    thread: [
      {
        id: 'msg-601',
        senderName: 'Vikas Mehta',
        senderEmail: 'vikas.mehta@abcsolutions.com',
        isSelf: false,
        body: `Hi Ravi,\n\nJust following up on the profiles shared for the Java Developer requirement.\n\nPlease let us know if you have any updates.\n\nThanks,\nVikas`,
        timestamp: 'May 20, 11:30 AM',
      },
    ],
    activity: {
      openCount: 1,
      lastOpenedAt: 'May 20, 11:45 AM',
    },
  },
  {
    id: 'email-7',
    category: 'Portal Notifications',
    senderName: 'Jooble',
    senderEmail: 'notifications@jooble.org',
    senderRole: 'Recruitment Portal',
    senderCompany: 'Jooble',
    subject: 'New candidate application received',
    preview: 'You have received a new candidate application for the Senior Java Developer position. Candidate: Michael Johnson, Source: Job Board...',
    body: `You have received a new candidate application for the Senior Java Developer position.

Candidate: Michael Johnson
Source: Job Board
Application ID: APP-2026-1042

Please log in to your recruiter portal dashboard to review the application and candidate details.`,
    timestamp: 'May 19',
    receivedDate: 'May 19, 2025 03:20 PM',
    isUnread: false,
    isPriority: false,
    hasAttachments: false,
    tags: ['Job Board', 'Application Alert', 'Jooble', 'Portal Notification'],
    contact: {
      name: 'Jooble Portal',
      email: 'notifications@jooble.org',
      phone: 'N/A',
      company: 'Jooble',
      title: 'Automated Notification',
    },
    emailDetails: {
      source: 'Jooble Job Board',
      receivedAt: 'May 19, 2025 03:20 PM',
      to: 'hiring@tekisho.com',
      messageId: '<JOOBLE-APP-2026-1042@jooble.org>',
      threadId: 'thread_778899001',
    },
    actionRequired: {
      status: 'No Action Required',
      recommendation: 'Review applicant profile Michael Johnson in portal dashboard.',
      variant: 'green',
    },
    aiSummary: {
      summary: 'Job portal notification: New candidate application received for Senior Java Developer from Michael Johnson via Jooble (Application ID: APP-2026-1042).',
      keyPoints: [
        'New candidate application: Michael Johnson',
        'Source: Jooble Job Board',
        'Application ID: APP-2026-1042',
      ],
    },
    linkedRequirement: {
      jdCode: 'JD-2026-0184',
      role: 'Senior Java Developer',
      positions: 2,
      experience: '5+ Years',
      location: 'Dallas, TX',
    },
    thread: [
      {
        id: 'msg-701',
        senderName: 'Jooble',
        senderEmail: 'notifications@jooble.org',
        isSelf: false,
        body: `You have received a new candidate application for the Senior Java Developer position.

Candidate: Michael Johnson
Source: Job Board
Application ID: APP-2026-1042`,
        timestamp: 'May 19, 03:20 PM',
      },
    ],
    activity: {
      openCount: 1,
      lastOpenedAt: 'May 19, 03:45 PM',
    },
  },
  {
    id: 'email-8',
    category: 'Portal Notifications',
    senderName: 'Dice Alerts',
    senderEmail: 'alerts@dice.com',
    senderRole: 'Job Board Notification',
    senderCompany: 'Dice',
    subject: 'Job Alert: 3 New candidate applications received',
    preview: 'Your job posting for Senior Java Developer has received 3 new candidate applications on Dice...',
    body: `Job Board Status Notification:

Your job posting for Senior Java Developer (Dallas, TX) has received 3 new applicant submissions.

Application ID: DICE-2026-8910
Posting Status: Active

Please log in to your Dice employer portal to review submissions.`,
    timestamp: 'May 18',
    receivedDate: 'May 18, 2025 09:00 AM',
    isUnread: false,
    isPriority: false,
    hasAttachments: false,
    tags: ['Dice', 'Job Alert', 'Portal Notification'],
    contact: {
      name: 'Dice Alerts',
      email: 'alerts@dice.com',
      phone: 'N/A',
      company: 'Dice',
      title: 'Portal Notification',
    },
    emailDetails: {
      source: 'Dice Portal',
      receivedAt: 'May 18, 2025 09:00 AM',
      to: 'hiring@tekisho.com',
      messageId: '<DICE-APP-8910@dice.com>',
      threadId: 'thread_889900112',
    },
    actionRequired: {
      status: 'No Action Required',
      recommendation: 'Check new Dice applicant submissions in employer portal.',
      variant: 'green',
    },
    aiSummary: {
      summary: 'Dice portal notification: 3 new candidate applications received for Senior Java Developer posting.',
      keyPoints: [
        '3 new applicant submissions',
        'Source: Dice Job Portal',
        'Posting ID: DICE-2026-8910',
      ],
    },
    linkedRequirement: {
      jdCode: 'JD-2026-0184',
      role: 'Senior Java Developer',
      positions: 2,
      experience: '5+ Years',
      location: 'Dallas, TX',
    },
    thread: [
      {
        id: 'msg-801',
        senderName: 'Dice Alerts',
        senderEmail: 'alerts@dice.com',
        isSelf: false,
        body: `Your job posting for Senior Java Developer has received 3 new applicant submissions.

Application ID: DICE-2026-8910`,
        timestamp: 'May 18, 09:00 AM',
      },
    ],
    activity: {
      openCount: 1,
      lastOpenedAt: 'May 18, 09:15 AM',
    },
  },
];

export const RELAY_CATEGORY_CONFIG: Record<
  RelayCategory,
  { color: string; badgeBg: string; badgeText: string }
> = {
  All: { color: '#94a3b8', badgeBg: 'bg-slate-500/15', badgeText: 'text-slate-300' },
  'Vendor Reply': { color: '#f59e0b', badgeBg: 'bg-amber-500/15', badgeText: 'text-amber-300' },
  'Non-Vendor Reply': { color: '#10b981', badgeBg: 'bg-emerald-500/15', badgeText: 'text-emerald-300' },
  'Candidate Response': { color: '#14b8a6', badgeBg: 'bg-teal-500/15', badgeText: 'text-teal-300' },
  'Interview Response': { color: '#3b82f6', badgeBg: 'bg-blue-500/15', badgeText: 'text-blue-300' },
  Bounce: { color: '#ef4444', badgeBg: 'bg-red-500/15', badgeText: 'text-red-300' },
  'Follow-up': { color: '#a855f7', badgeBg: 'bg-purple-500/15', badgeText: 'text-purple-300' },
  'Portal Notifications': { color: '#06b6d4', badgeBg: 'bg-cyan-500/15', badgeText: 'text-cyan-300' },
  Sent: { color: '#64748b', badgeBg: 'bg-slate-500/15', badgeText: 'text-slate-300' },
};

export const CATEGORY_ORDER: RelayCategory[] = [
  'All',
  'Vendor Reply',
  'Non-Vendor Reply',
  'Candidate Response',
  'Interview Response',
  'Sent',
  'Bounce',
  'Follow-up',
  'Portal Notifications',
];

export const RELAY_CATEGORY_COUNTS: RelayCategoryCount[] = CATEGORY_ORDER.map((cat) => {
  const config = RELAY_CATEGORY_CONFIG[cat];
  const count =
    cat === 'All'
      ? RELAY_MOCK_EMAILS.length
      : RELAY_MOCK_EMAILS.filter((e) => e.category === cat).length;

  return {
    category: cat,
    count,
    color: config.color,
    badgeBg: config.badgeBg,
    badgeText: config.badgeText,
  };
});

