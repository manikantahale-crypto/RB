const { complete } = require("../core/aiClient");
const log = require("../utils/logger");

const RESUME_PARSING_PROMPT = `You are an expert US Bench Sales resume parser. Extract structured consultant profile data from the resume text. Return ONLY valid JSON. No markdown. No explanation. No code fences.

Extract these fields:
- first_name: string
- last_name: string
- full_name: string (first_name + last_name)
- email: string
- phone: string
- date_of_birth: string (if present, else "")
- gender: string (if present, else "")
- race_ethnicity: string (if present, else "")
- language: string (if present, else "")
- ssn: string (if present, else "")
- passport_details: string (if present, else "")
- job_title: string (job title / current role)
- skills: array of strings
- primary_skill: string (the main/strongest skill from the skills list)
- experience: string (e.g. "8 years" or "10+ years")
- total_experience: string (same as experience)
- certifications: array of strings
- domain_expertise: string (inferred domain or industries of expertise)
- preferred_job_type: string (default: "Contract" if not found)
- employee_type: string (default: "W2" if not found)
- current_rate: string (hourly rate/salary if present, else "")
- min_rate: string (minimum rate if present, else "")
- visa_status: string (visa status, normalized to: H1B, GC, US Citizen, OPT, CPT, H4 EAD, or empty string if not found)
- immigration_status: string (same as visa_status)
- availability: string (default: "Available" if not found)
- source: string (default: "Resume Upload")
- city: string
- state: string
- zip_code: string
- country: string
- current_location: string (e.g., Dallas, Texas, 75001, USA)
- willing_to_relocate: string (if present, else "")
- remote_preference: string (if present, else "")
- education: array of dicts with fields (degree, major, institution, graduation_year)
- summary: string (A concise recruiter-friendly professional profile summary...)
- ai_summary: string (same as summary)
- recruiter_notes: string (any additional interesting notes extracted from candidate profile)
- current_company: string
- current_role: string (job title)
- linkedin: string
- github: string
- embedding_text: string (A comprehensive normalized text combining Candidate Title, Core Skills, Total Experience, and Profile Summary suitable for vector embedding retrieval)

Rules:
1. If a value is not found, return an empty string or empty array.
2. Do not invent private data like SSN, passport number, DOB, gender, or race.
3. For skills, return a clean array of technical skills.
4. For location, split into city, state, zip_code, and country if possible.
5. For visa, normalize common terms: H1B, GC, US Citizen, OPT, CPT, H4 EAD.
6. For availability, use "Available" if not found.
7. For source, use "Resume Upload".
8. For preferred_job_type, use "Contract" if not found.
9. For employee_type, use "W2" if not found.
10. Return clean valid JSON only. Do not wrap in \`\`\`json ... \`\`\` blocks.`;

function stripCodeFences(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
    cleaned = cleaned.replace(/\s*```$/, "");
  }
  return cleaned;
}

function validateResumeSchema(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { isValid: false, error: 'AI response is not a valid JSON object' };
  }
  if (!parsed.full_name && !parsed.first_name && !parsed.job_title && (!Array.isArray(parsed.skills) || parsed.skills.length === 0)) {
    return { isValid: false, error: 'AI response missing all core candidate attributes (name, title, skills)' };
  }
  if (!parsed.full_name) {
    parsed.full_name = [parsed.first_name, parsed.last_name].filter(Boolean).join(" ") || parsed.job_title || "Candidate";
  }
  if (!Array.isArray(parsed.skills)) {
    parsed.skills = [];
  }
  if (!parsed.summary) {
    parsed.summary = parsed.ai_summary || `Consultant profile for ${parsed.full_name} (${parsed.job_title || 'Technical Specialist'}).`;
  }
  return { isValid: true, data: parsed };
}

async function parseResume(resumeText, maxAttempts = 3) {
  if (!resumeText || !resumeText.trim()) {
    throw new Error("Empty resume text provided for AI parsing.");
  }

  log.info(`[AI] Resume parsing started (textLength=${resumeText.length})`);

  let lastError = null;
  let correctionInstruction = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log.info(`[AI] Resume parsing attempt ${attempt}/${maxAttempts}`);

    let userPrompt = `RESUME TEXT:\n${resumeText}\n\nReturn the JSON object now.`;
    if (correctionInstruction) {
      userPrompt += `\n\nCRITICAL CORRECTION FROM PREVIOUS ATTEMPT: ${correctionInstruction}\nEnsure valid JSON format and all candidate fields are included.`;
    }

    try {
      const raw = await complete(userPrompt, { 
        system: RESUME_PARSING_PROMPT, 
        modelKey: "reason", 
        temperature: 0.1 
      });

      const cleaned = stripCodeFences(raw || "");
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (jsonErr) {
        log.warn(`[AI] Resume parsing attempt ${attempt} returned invalid JSON: ${jsonErr.message}`);
        correctionInstruction = "Your previous response was not valid JSON. You MUST return ONLY a parseable JSON object with no extra text or markdown formatting.";
        throw new Error(`LLM returned invalid JSON response: ${jsonErr.message}`);
      }

      const validation = validateResumeSchema(parsed);
      if (!validation.isValid) {
        log.warn(`[AI] Resume parsing attempt ${attempt} failed schema validation: ${validation.error}`);
        correctionInstruction = `Your previous response failed validation: ${validation.error}. Ensure candidate fields are populated.`;
        throw new Error(`AI response failed schema validation: ${validation.error}`);
      }

      log.info(`[AI] Resume parsing successful on attempt ${attempt}/${maxAttempts} for candidate: ${validation.data.full_name}`);
      return validation.data;
    } catch (err) {
      lastError = err;
      log.warn(`[AI] Resume parsing attempt ${attempt}/${maxAttempts} failed: ${err.message}`);

      // Permanent Auth/Credit errors should fail fast without wasting retries
      const isAuthOrCreditError = /\b(401|402|403|unauthorized|user not found|insufficient credits|invalid api key)\b/i.test(err.message);
      if (isAuthOrCreditError) {
        log.error(`[AI] Permanent AI authentication or configuration error encountered: ${err.message}. Aborting retries.`);
        break;
      }

      if (attempt < maxAttempts) {
        const backoffMs = attempt * 1200;
        log.info(`[AI] Waiting ${backoffMs}ms before retry attempt ${attempt + 1}...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  log.error(`[AI] Resume parsing failed after ${maxAttempts} attempts. Final reason: ${lastError?.message}`);
  throw new Error(`AI parsing could not be completed: ${lastError?.message || "Unknown AI error"}`);
}

module.exports = {
  parseResume,
  validateResumeSchema,
};
