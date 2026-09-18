/**
 * Canonical Availability & Rate Confirmation Email Template Builder
 * 
 * Single source of truth for generating consultant and vendor availability/rate confirmation emails.
 * Wording and structure remain strictly fixed.
 * Vendor email strictly excludes candidate PII.
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

function buildCanonicalConsultantConfirmationEmail({
  candidateName,
  jobTitle,
  location,
  contractType,
  availability,
  payRate,
  rateType,
  recruiterName,
  companyName,
} = {}) {
  const safeCandidateName = sanitizeField(candidateName, "Candidate");
  const safeJobTitle = sanitizeField(jobTitle, "Requirement");
  const safeLocation = sanitizeField(location, "Not specified");
  const safeContractType = sanitizeField(contractType, "C2C");
  const safeAvailability = sanitizeField(availability, "Immediate");
  const safePayRate = sanitizeField(payRate, "Agreed Rate");
  const safeRateType = sanitizeField(rateType, "HOURLY");
  const safeRecruiterName = sanitizeField(recruiterName, "Bench Sales Team");
  const safeCompanyName = sanitizeField(companyName, "Syntra Portal");

  const subject = `Availability & Rate Confirmation Required — ${safeJobTitle}`;

  const body = `Dear ${safeCandidateName},

We are moving forward with your profile for the below opportunity.

Before we initiate the Right to Represent (RTR) process, we would like to confirm your availability and the agreed pay rate.

--- Opportunity Details ---

Job Title          : ${safeJobTitle}
Location           : ${safeLocation}
Contract Type      : ${safeContractType}

--- Confirmation Details ---

Availability       : ${safeAvailability}
Pay Rate           : ${safePayRate}
Rate Type          : ${safeRateType}

Please confirm that the above availability and rate are acceptable to you and that you authorize us to proceed with the RTR process.

Please reply with one of the following:

YES, I CONFIRM

I confirm the above availability and rate and authorize you to proceed with the RTR process.

NO, I DO NOT CONFIRM

I do not agree with the above availability or rate.

Please note that the RTR process will only be initiated after the required confirmation is received.

Best Regards,
${safeRecruiterName}
${safeCompanyName}`;

  return {
    subject,
    body,
    values: {
      candidateName: safeCandidateName,
      jobTitle: safeJobTitle,
      location: safeLocation,
      contractType: safeContractType,
      availability: safeAvailability,
      payRate: safePayRate,
      rateType: safeRateType,
      recruiterName: safeRecruiterName,
      companyName: safeCompanyName,
    },
  };
}

function buildCanonicalVendorConfirmationEmail({
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

  const subject = `Availability & Rate Confirmation — ${safeJobTitle} — ${safeCandidateReference}`;

  const body = `Dear ${safeVendorName},

Thank you for confirming your interest in the consultant.

Before we initiate the Right to Represent (RTR) process, we would like to confirm the agreed availability and rate.

--- Opportunity Details ---

Job Title          : ${safeJobTitle}
Location           : ${safeLocation}
Contract Type      : ${safeContractType}

--- Candidate Profile ---

Candidate Reference : ${safeCandidateReference}
Skills              : ${safeSkills}
Total Experience    : ${safeExperience}
Immigration Status  : ${safeImmigrationStatus}

--- Confirmation Details ---

Availability       : ${safeAvailability}
Pay Rate           : ${safePayRate}
Rate Type          : ${safeRateType}

Please confirm that the above availability and rate are acceptable and that you agree to proceed with the RTR process.

Please reply with one of the following:

YES, I CONFIRM

I confirm the above availability and rate and agree to proceed with the RTR process.

NO, I DO NOT CONFIRM

I do not agree with the above availability or rate.

Please note that the RTR process will only be initiated after the required confirmation is received.

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
  buildCanonicalConsultantConfirmationEmail,
  buildCanonicalVendorConfirmationEmail,
  sanitizeField,
  formatSkills,
};
