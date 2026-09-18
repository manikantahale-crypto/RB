/** JD-aware consent email — structured template per candidate. */

export interface ConsentJobContext {
  title?: string;
  primaryRole?: string;
  companyName?: string;
  location?: string;
  employmentType?: string;
  duration?: string;
  rate?: string;
  requiredSkills?: string[];
  jdSummary?: string;
}

function recruiterBlock(): { team: string; company: string; phone: string; email: string } {
  return {
    team: process.env.RELAY_RECRUITER_NAME || process.env.RECRUITER_NAME || 'Bench Sales Team',
    company: process.env.RELAY_COMPANY_NAME || 'BenchATS Corp',
    phone: process.env.RELAY_RECRUITER_PHONE || '+1 (555) 123-4567',
    email: process.env.RELAY_RECRUITER_EMAIL || process.env.RELAY_FROM_EMAIL || 'benchsales@benchats.com',
  };
}

function formatSkills(skills?: string[]): string {
  if (!skills?.length) return 'As listed in the job description';
  return skills.slice(0, 12).join(', ');
}

export function buildConsentEmail(
  candidateName: string,
  job: ConsentJobContext,
): { subject: string; body: string } {
  const displayName = (candidateName || 'Candidate').trim();
  const roleTitle = job.title || job.primaryRole || 'Exciting Opportunity';
  const location = job.location || 'TBD';
  const duration = job.duration || job.employmentType || 'Contract';
  const rate = job.rate || 'Competitive — discuss on confirmation';
  const skills = formatSkills(job.requiredSkills);
  const { team, company, phone, email } = recruiterBlock();

  const subject = `Opportunity: ${roleTitle} — Your consent needed`;

  const body = `Dear ${displayName},

Hope you are doing well!

My name is ${team} from ${company}. I am reaching out to you because our AI system has identified your profile as a strong match for an exciting job opportunity that we currently have open.

--- Job Details ---
Job Title      : ${roleTitle}
Location       : ${location}
Duration       : ${duration}
Rate/Salary    : ${rate}
Required Skills: ${skills}

We have reviewed your resume and believe your experience and skills closely align with the requirements of this position.

We would love to move forward with your profile for this opportunity. However, before we proceed, we kindly request your consent to submit your resume to the client.

Please go through the job details above and your resume carefully, and reply to this email with one of the following:

   ✅ YES, I CONFIRM  — I agree to submit my resume for this opportunity.

   ❌ NO, I AM NOT OKAY — I am not interested in this opportunity at this time.

We are waiting for your response at the earliest so we can take the next steps promptly.

If you have any questions or need further clarification about the role, feel free to reply to this email.

Looking forward to hearing from you soon!

Best Regards,
${team}
${company}
${phone}
${email}`;

  return { subject, body };
}

/** Gentle follow-up when candidate has not replied to consent request. */
export function buildConsentReminderEmail(
  candidateName: string,
  job: ConsentJobContext,
  reminderNumber: 1 | 2,
): { subject: string; body: string } {
  const displayName = (candidateName || 'Candidate').trim();
  const roleTitle = job.title || job.primaryRole || 'the opportunity';
  const { team, company, phone, email } = recruiterBlock();

  const urgency =
    reminderNumber === 1
      ? 'Just following up on the opportunity we shared earlier today.'
      : 'This is a friendly second reminder — we have not heard back yet.';

  const subject =
    reminderNumber === 1
      ? `Reminder: ${roleTitle} — consent needed`
      : `Final reminder: ${roleTitle} — please confirm`;

  const body = `Dear ${displayName},

Hope you are doing well!

${urgency}

We previously reached out about the **${roleTitle}** role and requested your consent to submit your resume to the client.

Please reply with one of the following at your earliest convenience:

   ✅ YES, I CONFIRM  — I agree to submit my resume for this opportunity.

   ❌ NO, I AM NOT OKAY — I am not interested in this opportunity at this time.

If you have any questions about the role, feel free to reply to this email.

Best Regards,
${team}
${company}
${phone}
${email}`;

  return { subject, body };
}

export async function fetchJobContextForConsent(jobId: string): Promise<ConsentJobContext> {
  const base = (process.env.SYNTRA_API_URL || 'http://localhost:4000').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/internal/jobs/${jobId}`);
    if (!res.ok) return {};
    const j = (await res.json()) as Record<string, unknown>;
    let skills: string[] = [];
    if (Array.isArray(j.required_skills)) {
      skills = j.required_skills as string[];
    } else if (typeof j.required_skills === 'string') {
      try {
        skills = JSON.parse(j.required_skills as string);
      } catch {
        skills = [];
      }
    }
    return {
      title: (j.title as string) || undefined,
      primaryRole: (j.primary_role as string) || undefined,
      companyName: (j.company_name as string) || undefined,
      location: (j.location as string) || undefined,
      employmentType: (j.employment_type as string) || undefined,
      duration: (j.employment_type as string) || undefined,
      rate: (j.rate as string) || undefined,
      requiredSkills: skills,
      jdSummary: (j.jd_summary as string) || undefined,
    };
  } catch {
    return {};
  }
}
