function sanitizeField(val: unknown, fallback = 'Not specified'): string {
  if (val === undefined || val === null) return fallback;
  const str = String(val).trim();
  if (!str || str === 'undefined' || str === 'null' || str === '[object Object]') {
    return fallback;
  }
  return str;
}

function formatSkills(requiredSkills: unknown): string {
  if (Array.isArray(requiredSkills)) {
    const valid = requiredSkills
      .map((s) => sanitizeField(s, ''))
      .filter((s) => s.length > 0 && s !== 'Not specified');
    if (valid.length > 0) return valid.join(', ');
  } else if (typeof requiredSkills === 'string') {
    const cleaned = sanitizeField(requiredSkills, '');
    if (cleaned && cleaned !== 'Not specified') return cleaned;
  }
  return 'As per job requirements';
}

export function buildCanonicalConsentEmail({
  candidateName,
  jobTitle,
  location,
  contractType,
  immigrationStatus,
  requiredSkills,
}: {
  candidateName?: string;
  jobTitle?: string;
  location?: string;
  contractType?: string;
  immigrationStatus?: string;
  requiredSkills?: unknown;
} = {}) {
  const safeCandidateName = sanitizeField(candidateName, 'Candidate');
  const safeJobTitle = sanitizeField(jobTitle, 'Requirement');
  const safeLocation = sanitizeField(location, 'Not specified');
  const safeContractType = sanitizeField(contractType, 'C2C');
  const safeImmigrationStatus = sanitizeField(immigrationStatus, 'Not specified');
  const safeRequiredSkills = formatSkills(requiredSkills);

  const subject = `Job opening matching your profile - ${safeJobTitle}`;

  const body = `Dear ${safeCandidateName},

Hope you are doing well!

We have a job opening that closely matches your profile and wanted to check your availability and interest before proceeding further.


--- Job Details ---

Job Title        : ${safeJobTitle}
Location         : ${safeLocation}
Contract Type    : ${safeContractType}
Immigration Status : ${safeImmigrationStatus}
Required Skills  : ${safeRequiredSkills}


Please go through the above details and let us know your response at the earliest so we can take the next steps.

Reply with one of the following:

✅ YES, I CONFIRM — I am available and interested. Please proceed with my profile.

❌ I AM NOT OKAY — I am not interested in this opportunity at this time.

Looking forward to hearing from you soon.`;

  return { subject, body };
}
