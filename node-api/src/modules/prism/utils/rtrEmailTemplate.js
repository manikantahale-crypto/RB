/**
 * Canonical Vendor RTR Email Package Template Builder
 * 
 * Single source of truth for generating vendor RTR emails across PRISM & RELAY.
 * Strictly excludes internal workflow terminology (PRISM, TEMPO, internal stage).
 */

function sanitizeField(val, fallback = "Not specified") {
  if (val === undefined || val === null) return fallback;
  const str = String(val).trim();
  if (!str || str === "undefined" || str === "null" || str === "[object Object]") {
    return fallback;
  }
  return str;
}

function buildCanonicalRTREmail({
  vendorContactName,
  candidateName,
  jobTitle,
  clientName,
  requisitionId,
  location,
  contractType,
  rate,
  rateType,
  availability,
  immigrationStatus,
  recruiterName,
  companyName,
  attachedDocuments = [],
} = {}) {
  const safeVendorContact = sanitizeField(vendorContactName, "Vendor Partner");
  const safeCandidateName = sanitizeField(candidateName, "Candidate");
  const safeJobTitle = sanitizeField(jobTitle, "Requirement");
  const safeClientName = sanitizeField(clientName, "Client");
  const safeRequisitionId = sanitizeField(requisitionId, "REQ-REF");
  const safeLocation = sanitizeField(location, "Not specified");
  const safeContractType = sanitizeField(contractType, "C2C");
  const safeRate = sanitizeField(rate, "Agreed Rate");
  const safeRateType = sanitizeField(rateType, "HOURLY");
  const safeAvailability = sanitizeField(availability, "Immediate");
  const safeImmigrationStatus = sanitizeField(immigrationStatus, "Not specified");
  const safeRecruiterName = sanitizeField(recruiterName, "Bench Sales Team");
  const safeCompanyName = sanitizeField(companyName, "Syntra Portal");

  const formattedRate = safeRate.startsWith("$") ? safeRate : `$${safeRate}`;

  const defaultDocs = ["Candidate Resume", "Right to Represent (RTR) Form"];
  const allDocs = Array.from(new Set([...defaultDocs, ...(attachedDocuments || [])]));
  const docListFormatted = allDocs.map((doc, idx) => `${idx + 1}. ${doc}`).join("\n");

  const subject = `RTR Submission – ${safeCandidateName} – ${safeJobTitle} – ${safeClientName}`;

  const body = `Hello ${safeVendorContact},

As discussed, we are proceeding with the Right to Represent (RTR) for the following opportunity.

----------------------------------------
RTR DETAILS
----------------------------------------

Candidate Name    : ${safeCandidateName}
Job Title         : ${safeJobTitle}
Client            : ${safeClientName}
Requisition ID    : ${safeRequisitionId}
Location          : ${safeLocation}
Contract Type     : ${safeContractType}

Rate              : ${formattedRate}
Rate Type         : ${safeRateType}
Availability      : ${safeAvailability}
Immigration Status: ${safeImmigrationStatus}

----------------------------------------
ATTACHED DOCUMENTS
----------------------------------------

${docListFormatted}

Please review the attached RTR package and confirm/sign the RTR as required.

Regards,
${safeRecruiterName}
${safeCompanyName}`;

  return {
    subject,
    body,
    values: {
      vendorContactName: safeVendorContact,
      candidateName: safeCandidateName,
      jobTitle: safeJobTitle,
      clientName: safeClientName,
      requisitionId: safeRequisitionId,
      location: safeLocation,
      contractType: safeContractType,
      rate: formattedRate,
      rateType: safeRateType,
      availability: safeAvailability,
      immigrationStatus: safeImmigrationStatus,
      recruiterName: safeRecruiterName,
      companyName: safeCompanyName,
      attachedDocuments: allDocs,
    },
  };
}

module.exports = {
  buildCanonicalRTREmail,
  sanitizeField,
};
