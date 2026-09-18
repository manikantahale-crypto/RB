/**
 * Canonical Vendor Email Template Builder
 * 
 * Single source of truth for generating vendor submission emails across PRISM & RELAY.
 * Wording and structure remain strictly fixed.
 * Only dynamic values are interpolated with safety sanitization.
 * Candidate PII is strictly excluded.
 */

function sanitizeField(val, fallback = "Not specified") {
  if (val === undefined || val === null) return fallback;
  const str = String(val).trim();
  if (!str || str === "undefined" || str === "null" || str === "[object Object]") {
    return fallback;
  }
  return str;
}

function formatSkills(skills) {
  if (Array.isArray(skills)) {
    const valid = skills
      .map((s) => sanitizeField(s, ""))
      .filter((s) => s.length > 0 && s !== "Not specified");
    if (valid.length > 0) {
      return valid.join(", ");
    }
  } else if (typeof skills === "string") {
    const cleaned = sanitizeField(skills, "");
    if (cleaned && cleaned !== "Not specified") {
      return cleaned;
    }
  }
  return "As per requirement";
}

function buildCanonicalVendorEmail({
  vendorName,
  jobTitle,
  location,
  contractType,
  candidateReference,
  skills,
  experience,
  immigrationStatus,
  availability,
  payRate,
  rateType,
  recruiterName,
  companyName,
} = {}) {
  const safeVendorName = sanitizeField(vendorName, "Vendor Partner");
  const safeJobTitle = sanitizeField(jobTitle, "Requirement");
  const safeLocation = sanitizeField(location, "Not specified");
  const safeContractType = sanitizeField(contractType, "C2C");
  const safeCandidateReference = sanitizeField(candidateReference, "CAND-REF");
  const safeSkills = formatSkills(skills);
  const safeExperience = sanitizeField(experience, "Not specified");
  const safeImmigrationStatus = sanitizeField(immigrationStatus, "Not specified");
  const safeAvailability = sanitizeField(availability, "Immediate");
  const safePayRate = sanitizeField(payRate, "Market Rate");
  const safeRateType = sanitizeField(rateType, "HOURLY");
  const safeRecruiterName = sanitizeField(recruiterName, "Bench Sales Team");
  const safeCompanyName = sanitizeField(companyName, "Syntra Portal");

  const subject = `Candidate Profile for ${safeJobTitle} — ${safeCandidateReference}`;

  const body = `Dear ${safeVendorName},

Hope you are doing well.

We have a consultant who closely matches the requirements for the below opportunity. Please review the candidate profile and let us know if you would be interested in proceeding.

--- Requirement Details ---

Job Title          : ${safeJobTitle}
Location           : ${safeLocation}
Contract Type      : ${safeContractType}

--- Candidate Profile ---

Candidate Reference : ${safeCandidateReference}
Skills              : ${safeSkills}
Total Experience    : ${safeExperience}
Immigration Status  : ${safeImmigrationStatus}
Availability        : ${safeAvailability}
Pay Rate            : ${safePayRate}
Rate Type           : ${safeRateType}

Please review the profile and let us know your response.

Reply with one of the following:

YES, PROCEED — We are interested in this consultant.

NO, NOT INTERESTED — We are not interested in proceeding.

If interested, we will proceed with the next steps, including candidate validation, availability confirmation, RTR, and interview coordination as applicable.

Please let us know if you need any additional non-identifying information.

Best Regards,
${safeRecruiterName}
${safeCompanyName}`;

  return {
    subject,
    body,
    values: {
      vendorName: safeVendorName,
      jobTitle: safeJobTitle,
      location: safeLocation,
      contractType: safeContractType,
      candidateReference: safeCandidateReference,
      skills: safeSkills,
      experience: safeExperience,
      immigrationStatus: safeImmigrationStatus,
      availability: safeAvailability,
      payRate: safePayRate,
      rateType: safeRateType,
      recruiterName: safeRecruiterName,
      companyName: safeCompanyName,
    },
  };
}

module.exports = {
  buildCanonicalVendorEmail,
  sanitizeField,
  formatSkills,
};
