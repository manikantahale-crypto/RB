const { complete } = require("../../core/aiClient");
const astraService = require("./astra.service");
const log = require("../../utils/logger");

const ALLOWED_ROLES = new Set([
  "data-analyst",
  "java-backend",
  "python-backend",
  "devops",
  "react-frontend",
  "fullstack",
  "salesforce",
  "other",
]);

const ROLE_ALIASES = {
  qa: "other",
  "qa-automation": "other",
  "qa-engineer": "other",
  sdet: "other",
  backend: "java-backend",
  "backend-developer": "java-backend",
  "java-developer": "java-backend",
  "python-developer": "python-backend",
  frontend: "react-frontend",
  "frontend-developer": "react-frontend",
  "react-developer": "react-frontend",
  "full-stack": "fullstack",
  "full-stack-engineer": "fullstack",
  "full-stack-developer": "fullstack",
  "data-analytics": "data-analyst",
  "data-engineer": "data-analyst",
  sre: "devops",
  cloud: "devops",
  "cloud-engineer": "devops",
  "devops-engineer": "devops",
};

const EXTRACTION_SYSTEM_PROMPT = `You are an expert IT Recruitment Intelligence and ATS parsing engine.
Given the raw job requirement text below, extract all key technical and business parameters accurately.

INSTRUCTIONS:
1. Extract the core role title, client/company name, and location.
2. Identify primary role category matching one of:
   - "data-analyst"
   - "java-backend"
   - "python-backend"
   - "devops"
   - "react-frontend"
   - "fullstack"
   - "salesforce"
   - "other"
3. Extract distinct technical skills. Separate mandatory/required skills from preferred/nice-to-have skills.
4. Extract years of experience (e.g. "5+ years", "5-8 years", "minimum 7 years").
5. Extract work authorization / visa preferences (e.g. H1B, GC, USC, OPT, CPT).
6. Extract employment type (e.g. C2C, W2, Contract, Full-time).
7. Extract remote policy (Remote, Hybrid, Onsite).
8. Extract rate or compensation if mentioned.
9. Generate a concise 4-5 bullet recruiter summary.
10. Assess quality/confidence (0.0 to 1.0) and whether the requirement has enough technical detail to match against candidates.

Return ONLY a valid JSON object matching this structure (no markdown fences, no extra text):
{
  "title": "Clean Role Title",
  "company_name": "Company/Client Name or null",
  "location": "City, State or Remote or null",
  "primary_role": "java-backend",
  "required_skills": ["Skill1", "Skill2"],
  "mandatory_skills": ["MandatorySkill1"],
  "preferred_skills": ["PreferredSkill1"],
  "experience_raw": "5-8 years",
  "visa_requirement": "H1B, GC, USC or null",
  "employment_type": "C2C or W2 or Contract or Full-time or null",
  "remote_policy": "Remote or Hybrid or Onsite or null",
  "rate": "$70/hr C2C or null",
  "recruiter_summary": "- Role: ...\\n- Client: ...\\n- Location: ...\\n- Skills: ...",
  "confidence_score": 0.95,
  "is_actionable": true,
  "validation_details": "Clear tech stack and experience parameters"
}`;

/**
 * Strips markdown code blocks from LLM output.
 *
 * @param {string} text
 * @returns {string}
 */
function stripCodeFences(text) {
  if (!text || typeof text !== "string") return "";
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
    cleaned = cleaned.replace(/\s*```$/, "");
  }
  return cleaned.trim();
}

/**
 * Parses numeric min and max experience from raw text strings like:
 * - "5+ years" -> min: 5, max: null
 * - "5-8 years" -> min: 5, max: 8
 * - "minimum 7 years" -> min: 7, max: null
 * - "8 years required" -> min: 8, max: null
 *
 * @param {string|number} expRaw
 * @returns {{ minExperience: number|null, maxExperience: number|null }}
 */
function parseExperienceString(expRaw) {
  if (expRaw == null) return { minExperience: null, maxExperience: null };
  if (typeof expRaw === "number") {
    return { minExperience: expRaw, maxExperience: null };
  }

  const str = String(expRaw).trim().toLowerCase();
  if (!str) return { minExperience: null, maxExperience: null };

  // Range pattern: "5-8 years", "5 to 8 years", "5 - 8 yrs"
  const rangeMatch = str.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*(?:\+)?\s*(?:years?|yrs?)/i);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    return {
      minExperience: isNaN(min) ? null : min,
      maxExperience: isNaN(max) ? null : max,
    };
  }

  // Minimum/plus pattern: "5+ years", "5 + yrs", "minimum 5 years", "at least 5 years"
  const minMatch = str.match(/(?:minimum|at least|min\.?)\s*(\d+)\s*(?:years?|yrs?)|(\d+)\s*\+\s*(?:years?|yrs?)/i);
  if (minMatch) {
    const num = parseInt(minMatch[1] || minMatch[2], 10);
    return {
      minExperience: isNaN(num) ? null : num,
      maxExperience: null,
    };
  }

  // Single number: "8 years required", "5 years experience"
  const singleMatch = str.match(/(\d+)\s*(?:years?|yrs?)/i);
  if (singleMatch) {
    const num = parseInt(singleMatch[1], 10);
    return {
      minExperience: isNaN(num) ? null : num,
      maxExperience: null,
    };
  }

  return { minExperience: null, maxExperience: null };
}

/**
 * Normalizes a role string to the SYNTRA canonical role taxonomy.
 *
 * @param {string} role
 * @returns {string}
 */
function normalizePrimaryRole(role) {
  if (!role || typeof role !== "string") return "other";
  const cleaned = role.trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (ALLOWED_ROLES.has(cleaned)) return cleaned;
  return ROLE_ALIASES[cleaned] || "other";
}

/**
 * Deduplicates and cleans an array of technical skill strings.
 *
 * @param {string[]|string} skills
 * @returns {string[]}
 */
function normalizeSkillsArray(skills) {
  if (!skills) return [];
  let arr = [];
  if (Array.isArray(skills)) {
    arr = skills;
  } else if (typeof skills === "string") {
    arr = skills.split(/[,;\n|]/);
  }
  const seen = new Set();
  const result = [];
  for (const s of arr) {
    if (!s || typeof s !== "string") continue;
    const trimmed = s.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * Formats a clean 4-5 bullet recruiter summary from parsed requirement fields.
 *
 * @param {Object} params
 * @returns {string}
 */
function formatRecruiterSummary({ title, companyName, location, primaryRole, minExperience, maxExperience, visaRequirement, employmentType, remotePolicy, skills, rate }) {
  const bullets = [];
  bullets.push(`- Role: ${title || "Untitled Role"}${companyName ? ` at ${companyName}` : ""}`);

  const locParts = [];
  if (location) locParts.push(location);
  if (remotePolicy) locParts.push(remotePolicy);
  if (employmentType) locParts.push(employmentType);
  bullets.push(`- Location & Type: ${locParts.length > 0 ? locParts.join(" | ") : "Not specified"}`);

  let expStr = "Not specified";
  if (minExperience != null && maxExperience != null) {
    expStr = `${minExperience}-${maxExperience} years`;
  } else if (minExperience != null) {
    expStr = `${minExperience}+ years`;
  }
  bullets.push(`- Experience & Visa: ${expStr}${visaRequirement ? ` (Visa: ${visaRequirement})` : ""}`);

  const skillList = Array.isArray(skills) ? skills.slice(0, 8).join(", ") : "";
  bullets.push(`- Core Tech Stack: ${skillList || "Not specified"}`);

  if (rate) {
    bullets.push(`- Compensation: ${rate}`);
  }

  return bullets.join("\n");
}

/**
 * Evaluates requirement quality and completeness for candidate matching.
 *
 * @param {Object} params
 * @returns {{ isActionable: boolean, confidenceScore: number, validationDetails: string }}
 */
function evaluateRequirementQuality({ title, rawText, requiredSkills, minExperience }) {
  let score = 0.5;
  const notes = [];

  const hasTitle = Boolean(title && title.trim().length > 2 && title.toLowerCase() !== "untitled role");
  if (hasTitle) {
    score += 0.2;
    notes.push("Valid title");
  } else {
    notes.push("Missing or generic title");
  }

  const skillCount = Array.isArray(requiredSkills) ? requiredSkills.length : 0;
  if (skillCount >= 3) {
    score += 0.2;
    notes.push(`${skillCount} technical skills identified`);
  } else if (skillCount > 0) {
    score += 0.1;
    notes.push(`Only ${skillCount} skill(s) identified`);
  } else {
    score -= 0.2;
    notes.push("No technical skills detected");
  }

  if (minExperience != null) {
    score += 0.1;
    notes.push("Experience requirements defined");
  }

  const textLen = (rawText || "").length;
  if (textLen < 80) {
    score -= 0.2;
    notes.push("Very short raw text");
  }

  const boundedScore = Math.max(0.1, Math.min(1.0, Number(score.toFixed(2))));
  const isActionable = hasTitle && (skillCount >= 1 || textLen >= 100);

  return {
    isActionable,
    confidenceScore: boundedScore,
    validationDetails: notes.join("; "),
  };
}

/**
 * Main Entry Point: Performs comprehensive ASTRA Requirement Intelligence Enrichment.
 *
 * 1. Takes canonical requirement record.
 * 2. Invokes LLM semantic extraction.
 * 3. Normalizes taxonomy (role, skills, visa, employment, remote, experience bounds).
 * 4. Generates structured recruiter summary.
 * 5. Computes quality score and completeness assessment.
 * 6. Returns structured data package ready for repository persistence.
 *
 * @param {Object} requirement Canonical requirement from syntra.jobs
 * @returns {Promise<Object>} Enriched requirement attributes
 */
async function enrichRequirement(requirement = {}) {
  const rawText = (requirement.raw_text || requirement.rawText || "").trim();
  const existingTitle = requirement.title || "";
  const existingCompany = requirement.company_name || requirement.companyName || null;
  const existingLocation = requirement.location || null;
  const existingVisa = requirement.visa_requirement || requirement.visaRequirement || null;
  const existingEmployment = requirement.employment_type || requirement.employmentType || null;
  const existingRemote = requirement.remote_policy || requirement.remotePolicy || null;
  const existingMinExp = requirement.min_experience != null ? requirement.min_experience : requirement.minExperience;
  const existingMaxExp = requirement.max_experience != null ? requirement.max_experience : requirement.maxExperience;

  let parsedAi = null;

  if (rawText) {
    try {
      const prompt = `JOB REQUIREMENT TEXT:\n${rawText.slice(0, 12000)}\n\nExtract and return the JSON object now:`;
      const aiResponse = await complete(prompt, {
        system: EXTRACTION_SYSTEM_PROMPT,
        modelKey: "reason",
        temperature: 0.1,
      });

      const cleaned = stripCodeFences(aiResponse || "");
      if (cleaned) {
        parsedAi = JSON.parse(cleaned);
      }
    } catch (err) {
      log.warn(`[ASTRA Intelligence] AI extraction parsing warning: ${err.message}. Proceeding with deterministic normalization fallback.`);
    }
  }

  // Combine and prioritize fields (explicit requirement values override/supplement AI)
  const title = (existingTitle && existingTitle !== "Untitled Role") ? existingTitle : (parsedAi?.title || existingTitle || "Untitled Role");
  let companyName = existingCompany || parsedAi?.company_name || null;
  if (companyName === "null" || companyName === "undefined") companyName = null;
  let location = existingLocation || parsedAi?.location || null;
  if (location === "null" || location === "undefined") location = null;
  const primaryRole = normalizePrimaryRole(parsedAi?.primary_role || requirement.primary_role);

  // Normalize Skills
  const rawSkills = (parsedAi?.required_skills && parsedAi.required_skills.length)
    ? parsedAi.required_skills
    : (requirement.required_skills || requirement.skills || []);
  const requiredSkills = normalizeSkillsArray(rawSkills);
  const mandatorySkills = normalizeSkillsArray(parsedAi?.mandatory_skills || []);
  const preferredSkills = normalizeSkillsArray(parsedAi?.preferred_skills || []);

  // Normalize Experience Bounds
  let minExp = existingMinExp != null ? Number(existingMinExp) : null;
  let maxExp = existingMaxExp != null ? Number(existingMaxExp) : null;
  if (minExp == null && parsedAi?.experience_raw) {
    const expParsed = parseExperienceString(parsedAi.experience_raw);
    minExp = expParsed.minExperience;
    maxExp = expParsed.maxExperience;
  }
  if (minExp == null && rawText) {
    const expParsed = parseExperienceString(rawText);
    minExp = expParsed.minExperience;
    maxExp = expParsed.maxExperience;
  }

  // Normalize Taxonomies
  let visaRequirement = astraService.normalizeVisaRequirement(existingVisa || parsedAi?.visa_requirement);
  if (!visaRequirement && rawText) {
    if (/\bh1b\b|\bh-1b\b/i.test(rawText)) visaRequirement = "H1B";
    else if (/\bgc\b|\bgreen card\b/i.test(rawText)) visaRequirement = "GC";
    else if (/\bus citizen\b|\busc\b/i.test(rawText)) visaRequirement = "USC";
    else if (/\bopt\b|\bcpt\b/i.test(rawText)) visaRequirement = "OPT";
  }

  let employmentType = astraService.normalizeEmploymentType(existingEmployment || parsedAi?.employment_type);
  if (!employmentType && rawText) {
    if (/\b(c2c|c-to-c|c\s*to\s*c|corp-to-corp|corp\s*to\s*corp|corp2corp)\b/i.test(rawText)) {
      employmentType = "C2C";
    } else if (/\b(w-?2|w\s*2)\b/i.test(rawText)) {
      employmentType = "W2";
    } else if (/\b(1099|form-?1099|form\s*1099)\b/i.test(rawText)) {
      employmentType = "1099";
    }
  }
  employmentType = astraService.normalizeEmploymentType(employmentType);

  let remotePolicy = astraService.normalizeRemotePolicy(existingRemote || parsedAi?.remote_policy);
  if (!remotePolicy && rawText) {
    if (/\bremote\b/i.test(rawText)) remotePolicy = "Remote";
    else if (/\bhybrid\b/i.test(rawText)) remotePolicy = "Hybrid";
    else if (/\bonsite\b|\bon-site\b/i.test(rawText)) remotePolicy = "Onsite";
  }

  const rate = parsedAi?.rate || null;

  // Generate Recruiter Summary
  let summaryInput = parsedAi?.recruiter_summary;
  if (Array.isArray(summaryInput)) {
    summaryInput = summaryInput.join("\n");
  } else if (typeof summaryInput !== "string") {
    summaryInput = null;
  }

  const recruiterSummary = (summaryInput && summaryInput.trim())
    ? summaryInput.trim()
    : formatRecruiterSummary({
        title,
        companyName,
        location,
        primaryRole,
        minExperience: minExp,
        maxExperience: maxExp,
        visaRequirement,
        employmentType,
        remotePolicy,
        skills: requiredSkills,
        rate,
      });

  // Evaluate Quality and Actionability
  const quality = evaluateRequirementQuality({
    title,
    rawText,
    requiredSkills,
    minExperience: minExp,
  });

  const confidenceScore = parsedAi?.confidence_score != null
    ? Number(parsedAi.confidence_score)
    : quality.confidenceScore;

  const isActionable = parsedAi?.is_actionable != null
    ? Boolean(parsedAi.is_actionable)
    : quality.isActionable;

  const validationDetails = parsedAi?.validation_details || quality.validationDetails;

  const parsedData = {
    mandatorySkills,
    preferredSkills,
    rate,
    confidenceScore,
    isActionable,
    validationDetails,
    extractedAt: new Date().toISOString(),
  };

  return {
    title,
    companyName,
    location,
    primaryRole,
    requiredSkills,
    minExperience: minExp,
    maxExperience: maxExp,
    visaRequirement,
    employmentType,
    remotePolicy,
    jdSummary: recruiterSummary,
    parsedData,
    isActionable,
    confidenceScore,
  };
}

module.exports = {
  enrichRequirement,
  parseExperienceString,
  normalizePrimaryRole,
  normalizeSkillsArray,
  formatRecruiterSummary,
  evaluateRequirementQuality,
};
