const log = require("../utils/logger");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[\d\s\-\.\(\)]{7,20}$/;
const URL_REGEX = /^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;

const VALID_VISAS = ["H1B", "GC", "US Citizen", "OPT", "CPT", "H4 EAD"];

/**
 * Normalizes immigration status to accepted forms.
 */
function normalizeImmigration(status) {
  if (!status) return "";
  const s = status.toUpperCase().replace(/[-\s]/g, "");
  
  if (s.includes("H1B")) return "H1B";
  if (s.includes("GREENCARD") || s === "GC") return "GC";
  if (s.includes("USC") || s.includes("USCITIZEN") || s.includes("CITIZEN")) return "US Citizen";
  if (s.includes("OPT")) return "OPT";
  if (s.includes("CPT")) return "CPT";
  if (s.includes("H4")) return "H4 EAD";
  
  return status;
}

/**
 * Normalizes experience string. Rejects obvious anomalies like "-5 years".
 */
function validateExperience(exp) {
  if (!exp) return "";
  if (typeof exp !== "string") return String(exp);
  
  const lowerExp = exp.toLowerCase();
  if (lowerExp.includes("-") && /\d/.test(lowerExp) && !lowerExp.includes("+") && lowerExp.indexOf("-") < lowerExp.search(/\d/)) {
    log.info(`[validation] Invalid experience detected: ${exp}`);
    return "";
  }
  if (!/\d/.test(lowerExp)) {
     log.info(`[validation] Invalid experience detected (no numbers): ${exp}`);
     return "";
  }
  return exp;
}

/**
 * Validates and normalizes candidate data parsed from resume.
 * Does not use LLM.
 * 
 * @param {Object} parsedData 
 * @returns {Object} Validated data
 */
function validateCandidateData(parsedData) {
  const data = { ...parsedData };

  // Email validation
  if (data.email) {
    if (!EMAIL_REGEX.test(data.email)) {
      log.info(`[validation] Invalid email detected: ${data.email}`);
      data.email = "";
    }
  }

  // Phone validation
  if (data.phone) {
    if (!PHONE_REGEX.test(data.phone)) {
      log.info(`[validation] Invalid phone detected: ${data.phone}`);
      data.phone = "";
    }
  }

  // Visa normalization
  const rawVisa = data.immigration_status || data.visa_status || "";
  if (rawVisa) {
    const norm = normalizeImmigration(rawVisa);
    if (VALID_VISAS.includes(norm)) {
      data.immigration_status = norm;
    } else {
      log.info(`[validation] Unknown immigration status: ${rawVisa}`);
      data.immigration_status = norm; // preserve existing application behavior for unknown
    }
  }

  // Experience
  data.experience = validateExperience(data.experience);
  data.total_experience = validateExperience(data.total_experience);

  // Name validation
  if (!data.full_name && (data.first_name || data.last_name)) {
    data.full_name = [data.first_name, data.last_name].filter(Boolean).join(" ");
  }

  // URLs
  if (data.linkedin && !URL_REGEX.test(data.linkedin)) {
    log.info(`[validation] Invalid LinkedIn URL: ${data.linkedin}`);
    data.linkedin = "";
  }
  if (data.github && !URL_REGEX.test(data.github)) {
    log.info(`[validation] Invalid GitHub URL: ${data.github}`);
    data.github = "";
  }

  // Skills deduplication
  if (Array.isArray(data.skills)) {
    const cleanedSkills = data.skills
      .map(s => typeof s === "string" ? s.trim() : "")
      .filter(Boolean);
    data.skills = [...new Set(cleanedSkills)];
  } else {
    data.skills = [];
  }

  // Arrays
  if (!Array.isArray(data.education)) data.education = [];
  if (!Array.isArray(data.certifications)) data.certifications = [];

  // Remove invalid values in arrays
  data.education = data.education.filter(e => e && typeof e === 'object');
  data.certifications = data.certifications.filter(c => c && typeof c === 'string');

  return data;
}

module.exports = {
  validateCandidateData
};
