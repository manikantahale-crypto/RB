const { complete } = require("../core/aiClient");
const log = require("../utils/logger");

const JD_PARSING_PROMPT = `You are an expert ATS job description parser.
You will parse the JD text and validate/refine candidate entities found by local NLP models.
Extract the key ATS fields semantically and provide a confidence score (0.0 to 1.0) along with brief validation notes.

Local spaCy/Regex Candidates:
- Detected ORGs (Client Candidates): {spacy_orgs}
- Detected GPEs (Location Candidates): {spacy_gpes}
- Detected Visas: {regex_visas}
- Detected Experience: {regex_experience}

Return ONLY a valid JSON object matching the required structure below. Do NOT output any markdown tags (like \`\`\`json), conversation, or extra text.

Required JSON structure:
{
 "title": "Job Title (e.g. Java Developer. Extract the core role title semantically)",
 "client_name": "End Client Name (e.g. Apple, Walmart. Extract the actual company hiring, NOT the vendor/staffing agency. Cross-reference with Local ORGs. If not found, use 'Not specified')",
 "location": "Location (City, State. e.g. Dallas, TX or Remote. Cross-reference with Local GPEs)",
 "job_type": "Job Type (e.g. Contract, Full-time, C2C, W2, etc.)",
 "required_skills": ["List of all distinct tech skills found"],
 "mandatory_skills": ["Tech skills specifically listed as mandatory, required, must-have, or minimum qualifications"],
 "preferred_skills": ["Tech skills listed as preferred, nice-to-have, plus, or optional"],
 "experience_required": "Experience required (e.g. 8+ years, 5 years. Cross-reference with Local Experience)",
 "visa_preferences": ["Accepted visa types: H1B, GC, USC (US Citizen), OPT, CPT. Parse semantically, cross-reference with Local Visas"],
 "remote_option": "Remote, Hybrid, or Onsite",
 "rate": "Bill rate or salary (e.g. $60/hr C2C, $120k/yr. Extract exactly as written or estimate if mentioned)",
 "responsibilities": "Brief paragraph or bullet points of key responsibilities/duties of the role",
 "jd_text": "Cleaned full job description text from the email, excluding generic email headers, footers, or disclaimer signatures",
 "confidence_score": 0.95,
 "validation_details": "Brief explanation of why the confidence score was chosen (e.g. 'Strong location and client mention, clear visa parameters. Excellent skill indicators')",
 "summary": "A concise recruiter-friendly JD summary formatted exactly as a bulleted list (using '-') with a maximum of 5 bullet points, capturing Role Title & Client Name, Job Location & Work Type, Experience & Immigration Status, Core Tech Stack, and Primary Responsibilities.",
 "embedding_text": "A comprehensive normalized text combining Job Title, Core Role, Key Tech Skills, Experience, and Summary suitable for vector embedding retrieval."
}

Rules:
- visa_preferences: Convert any terms like 'USC', 'GC', 'US Citizen', 'Green Card', 'H-1B', 'H1B', 'OPT' into clean shortcodes (USC, GC, H1B, OPT, CPT).
- Return clean, valid JSON only. Do not wrap in \`\`\`json or add other notes.`;

function stripCodeFences(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
    cleaned = cleaned.replace(/\s*```$/, "");
  }
  return cleaned;
}

function validateJdSchema(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { isValid: false, error: 'AI response is not a valid JSON object' };
  }
  if (!parsed.title || typeof parsed.title !== 'string' || parsed.title.trim().length === 0) {
    return { isValid: false, error: 'Missing or empty "title" field in AI output' };
  }
  if (!parsed.summary || typeof parsed.summary !== 'string') {
    parsed.summary = `- Role: ${parsed.title}\n- Location: ${parsed.location || 'Not specified'}\n- Requirements: ${Array.isArray(parsed.required_skills) ? parsed.required_skills.slice(0, 5).join(', ') : 'Technical Skills'}`;
  }
  if (!Array.isArray(parsed.required_skills)) {
    parsed.required_skills = [];
  }
  return { isValid: true, data: parsed };
}

async function parseJD({ jdText, spacyOrgs = [], spacyGpes = [], regexVisas = [], regexExperience = [] }, maxAttempts = 3) {
  if (!jdText || !jdText.trim()) {
    throw new Error("Empty JD text provided for AI parsing.");
  }

  log.info(`[AI] JD parsing started (textLength=${jdText.length})`);

  let lastError = null;
  let correctionInstruction = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log.info(`[AI] JD parsing attempt ${attempt}/${maxAttempts}`);

    let systemPrompt = JD_PARSING_PROMPT
      .replace("{spacy_orgs}", JSON.stringify(spacyOrgs))
      .replace("{spacy_gpes}", JSON.stringify(spacyGpes))
      .replace("{regex_visas}", JSON.stringify(regexVisas))
      .replace("{regex_experience}", JSON.stringify(regexExperience));

    let userPrompt = `JD TEXT:\n${jdText}\n\nReturn the JSON object now.`;
    if (correctionInstruction) {
      userPrompt += `\n\nCRITICAL CORRECTION FROM PREVIOUS ATTEMPT: ${correctionInstruction}\nEnsure valid JSON format and all required fields are included.`;
    }

    try {
      const raw = await complete(userPrompt, { 
        system: systemPrompt, 
        modelKey: "reason", 
        temperature: 0.1 
      });

      const cleaned = stripCodeFences(raw || "");
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (jsonErr) {
        log.warn(`[AI] JD parsing attempt ${attempt} returned invalid JSON: ${jsonErr.message}`);
        correctionInstruction = "Your previous response was not valid JSON. You MUST return ONLY a parseable JSON object with no extra text or markdown formatting.";
        throw new Error(`LLM returned invalid JSON response: ${jsonErr.message}`);
      }

      const validation = validateJdSchema(parsed);
      if (!validation.isValid) {
        log.warn(`[AI] JD parsing attempt ${attempt} failed schema validation: ${validation.error}`);
        correctionInstruction = `Your previous response failed validation: ${validation.error}. Ensure the JSON contains all required fields including a non-empty "title".`;
        throw new Error(`AI response failed schema validation: ${validation.error}`);
      }

      log.info(`[AI] JD parsing successful on attempt ${attempt}/${maxAttempts} for role: ${validation.data.title}`);
      return validation.data;
    } catch (err) {
      lastError = err;
      log.warn(`[AI] JD parsing attempt ${attempt}/${maxAttempts} failed: ${err.message}`);

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

  log.error(`[AI] JD parsing failed after ${maxAttempts} attempts. Final reason: ${lastError?.message}`);
  throw new Error(`AI parsing could not be completed: ${lastError?.message || "Unknown AI error"}`);
}

module.exports = {
  parseJD,
  validateJdSchema,
};
