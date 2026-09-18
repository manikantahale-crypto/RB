/**
 * Canonical RTR (Right to Represent) Agreement Document Template
 * 
 * Single source of truth for generating formal RTR agreement documents.
 */

function sanitizeField(val, fallback = "Not specified") {
  if (val === undefined || val === null) return fallback;
  const str = String(val).trim();
  if (!str || str === "undefined" || str === "null" || str === "[object Object]") {
    return fallback;
  }
  return str;
}

function buildCanonicalRTRDocument({
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
  date,
} = {}) {
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
  const safeDate = sanitizeField(date, new Date().toLocaleDateString("en-US"));

  const formattedRate = safeRate.startsWith("$") ? safeRate : `$${safeRate}`;

  const textContent = `================================================================================
                         RIGHT TO REPRESENT AGREEMENT
================================================================================

CANDIDATE DETAILS
--------------------------------------------------------------------------------
Candidate Name          : ${safeCandidateName}
Immigration / Work Auth : ${safeImmigrationStatus}
Availability            : ${safeAvailability}

OPPORTUNITY DETAILS
--------------------------------------------------------------------------------
Job Title               : ${safeJobTitle}
Client                  : ${safeClientName}
Requisition ID          : ${safeRequisitionId}
Location                : ${safeLocation}
Contract Type           : ${safeContractType}
Agreed Rate             : ${formattedRate} / ${safeRateType}

REPRESENTATION AUTHORIZATION
--------------------------------------------------------------------------------
Candidate acknowledges and authorizes the recruiting/staffing company to represent
the candidate for the specific opportunity identified above, subject to the applicable
representation terms.

SIGNATURE & CONFIRMATION
--------------------------------------------------------------------------------
Candidate Signature     : ${safeCandidateName}
Candidate Name          : ${safeCandidateName}
Date                    : ${safeDate}
================================================================================`;

  return {
    title: `RTR Agreement - ${safeCandidateName} - ${safeJobTitle}`,
    textContent,
    values: {
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
      date: safeDate,
    },
  };
}

module.exports = {
  buildCanonicalRTRDocument,
  sanitizeField,
};
