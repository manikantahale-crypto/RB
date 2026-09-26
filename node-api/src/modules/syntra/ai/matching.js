const { complete } = require("../../../core/aiClient");
const { safeJsonParse } = require("../../../utils/jsonParser");

const MATCH_SUMMARY_PROMPT = `You are an advanced AI Talent Matcher.
Compare the Candidate Summary against the Job Description (JD) Summary.
Assess how well the candidate's professional profile aligns with the JD summary.

Return ONLY a valid JSON object matching the required structure below. Do NOT output any markdown tags (like \`\`\`json), conversation, or extra text.

Required JSON structure:
{
 "match_score": 85,
 "match_status": "Strong Match",
 "consultant_response": "Why Matched:\\n• Reason 1\\n• Reason 2",
 "strengths": ["matched skill 1", "matched skill 2"],
 "gaps": ["missing skill 1", "missing skill 2"],
 "green_flags": ["positive evidence 1", "positive evidence 2"],
 "red_flags": ["concern 1", "concern 2"],
 "ranking_explanation": "Two to four sentences: recruiter decision and next step. Do not repeat the Why Matched bullets.",
 "recommendation": "Strong Match",
 "next_action": "shortlist",
 "confidence_score": 85,
 "breakdown": {
   "skills": 90,
   "experience": 80,
   "location": 100,
   "visa": 100,
   "education": 90,
   "availability": 100
 }
}

Rules:
- match_score: An integer between 0 and 100 representing semantic alignment. Be honest and realistic based on true alignment.
- match_status: Must be one of: "Strong Match" (score 80-100), "Potential Match" (score 50-79), or "Low Match" (score 0-49).
- consultant_response: MUST be a bulleted list (max 5-7 bullets) starting with 'Why Matched:' and concisely explaining the match.
- recommendation: Choose one: "Strong Match" (80-100), "Potential Match" (50-79), or "Low Match" (0-49). Must agree with match_score.
- next_action: Choose one: "shortlist" (80-100), "hold" (50-79), or "reject" (0-49).
- ranking_explanation: Recruiter-style next-step reason (2-4 sentences). Say what to do and why. Do NOT copy consultant_response bullets.
- Return clean, valid JSON only.`;

const MATCH_DETAILED_PROMPT = `You are an advanced AI Recruiter and Resume Matcher.
Compare the Candidate Resume against the Job Description (JD).
Assess technical skill alignment, experience fit, and identify any skill gaps.

Return ONLY a valid JSON object matching the required structure below. Do NOT output any markdown tags (like \`\`\`json), conversation, or extra text.

Required JSON structure:
{
 "match_score": 85,
 "matched_skills": ["Skill1", "Skill2"],
 "missing_skills": ["Skill3", "Skill4"],
 "ranking_explanation": "Two to four sentences: recruiter decision and next step. Do not list Why Matched bullets.",
 "recommendation": "Strong Match",
 "next_action": "shortlist"
}

Rules:
- match_score: An integer between 0 and 100. Be honest and realistic based on true alignment.
- recommendation: Choose one: "Strong Match" (80-100), "Potential Match" (50-79), or "Low Match" (0-49).
- next_action: Choose one: "shortlist" (80-100), "hold" (50-79), or "reject" (0-49).
- ranking_explanation: Recruiter-style next-step reason. Do not repeat a skill bullet list.
- Return clean, valid JSON only.`;

function stripCodeFences(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("\`\`\`")) {
    cleaned = cleaned.replace(/^\`\`\`(?:json)?\s*/i, "");
    cleaned = cleaned.replace(/\s*\`\`\`$/, "");
  }
  return cleaned;
}

async function matchSummaryToSummary(candidateSummary, jdSummary) {
  if (!candidateSummary || !candidateSummary.trim()) {
    throw new Error("candidateSummary is required");
  }
  if (!jdSummary || !jdSummary.trim()) {
    throw new Error("jdSummary is required");
  }

  const prompt = `JD SUMMARY:
${jdSummary}

CANDIDATE SUMMARY:
${candidateSummary}

Return the JSON object now.`;

  const raw = await complete(prompt, { 
    system: MATCH_SUMMARY_PROMPT, 
    modelKey: "reason", 
    temperature: 0.1 
  });
  
  const cleaned = stripCodeFences(raw || "");
  
  try {
    const parsed = safeJsonParse(raw || "");
    
    // Normalize match_status to DB enum values ('strong', 'moderate', 'weak')
    const rawStatus = (parsed.match_status || "").toLowerCase();
    let normalizedTier = "weak";
    if (rawStatus.includes("strong")) {
      normalizedTier = "strong";
    } else if (rawStatus.includes("potential") || rawStatus.includes("moderate")) {
      normalizedTier = "moderate";
    } else if (rawStatus.includes("low") || rawStatus.includes("weak")) {
      normalizedTier = "weak";
    }
    
    parsed.match_status = normalizedTier;
    
    return parsed;
  } catch (error) {
    throw new Error("Summary matching returned invalid JSON");
  }
}

async function matchResumeToJD(resume, jd) {
  if (!resume || !resume.trim()) {
    throw new Error("resume text is required");
  }
  if (!jd || !jd.trim()) {
    throw new Error("JD text is required");
  }

  const prompt = `JD TEXT:
${jd}

CANDIDATE RESUME:
${resume}

Return the JSON object now.`;

  const raw = await complete(prompt, { 
    system: MATCH_DETAILED_PROMPT, 
    modelKey: "reason", 
    temperature: 0.1 
  });
  
  try {
    return safeJsonParse(raw || "");
  } catch (error) {
    throw new Error("Detailed matching returned invalid JSON");
  }
}

const BATCH_MATCH_PROMPT = `You are an advanced AI Talent Matcher.
Compare a list of candidates against a single Job Description (JD) Summary.
Assess how well each candidate's professional profile aligns with the JD summary independently.

Return ONLY a valid JSON object matching the required structure below. Do NOT output any markdown tags (like \`\`\`json), conversation, or extra text.

Required JSON structure:
{
  "results": [
    {
      "candidate_id": "string (matching input candidate_id)",
      "resume_id": "string (matching input resume_id)",
      "status": "success",
      "match_score": 85,
      "match_status": "Strong Match",
      "consultant_response": "Why Matched:\\n• Reason 1\\n• Reason 2",
      "strengths": ["matched skill 1", "matched skill 2"],
      "gaps": ["missing skill 1", "missing skill 2"],
      "green_flags": ["positive evidence 1"],
      "red_flags": ["concern 1"],
      "ranking_explanation": "Two to four sentences: recruiter decision and next step. Do not repeat the Why Matched bullets.",
      "recommendation": "Strong Match",
      "next_action": "shortlist",
      "confidence_score": 85,
      "breakdown": {
        "skills": 90,
        "experience": 80,
        "location": 100,
        "visa": 100,
        "education": 90,
        "availability": 100
      }
    }
  ]
}

Rules:
- You MUST evaluate and return an entry in "results" for EVERY candidate provided in the input list using their exact candidate_id and resume_id.
- match_score: An integer between 0 and 100 representing true technical and semantic alignment based on verified skill overlap.
- strengths: Array of strings naming specific verified skills, tools, and technical areas from the candidate profile that directly fulfill the JD requirements (e.g. ['PHP 8', 'Laravel', 'MySQL database design']). DO NOT use vague phrases like 'relevant experience' or 'good communication'.
- gaps: Array of strings naming specific missing skills, tools, or requirements from the JD not found in the candidate profile (e.g. ['Vue.js', 'Docker containerization', 'CodeIgniter']).
- consultant_response: MUST be concise bullet points (3-5 bullets) starting with 'Why Matched:' stating exactly which key required skills overlap and any critical gaps.
- ranking_explanation: 2-3 clear sentences of actionable recruiter advice with specific reasoning based on technical skills overlap.
- recommendation: Choose one: "Strong Match" (80-100), "Potential Match" (50-79), or "Low Match" (0-49). Must agree with match_score.
- next_action: Choose one: "shortlist" (80-100), "hold" (50-79), or "reject" (0-49).
- Return clean, valid JSON only.`;

async function matchBatchSummariesToSummary(candidatesList, jdSummaryOrMeta) {
  if (!Array.isArray(candidatesList) || candidatesList.length === 0) {
    return { results: [] };
  }

  const isMetaObj = jdSummaryOrMeta && typeof jdSummaryOrMeta === "object";
  const jdSummary = isMetaObj ? jdSummaryOrMeta.jdSummary : String(jdSummaryOrMeta || "");
  const jobTitle = isMetaObj ? jdSummaryOrMeta.jobTitle : null;
  const requiredSkills = isMetaObj ? jdSummaryOrMeta.requiredSkills : null;
  const mandatorySkills = isMetaObj ? jdSummaryOrMeta.mandatorySkills : null;

  if (!jdSummary || !jdSummary.trim()) {
    throw new Error("jdSummary is required for batch matching");
  }

  const formattedCandidates = candidatesList.map((c, i) => `
--- CANDIDATE ITEM ${i + 1} ---
candidate_id: ${c.candidate_id || c.candidateId}
resume_id: ${c.resume_id || c.resumeId}
role: ${c.candidate_role || "Professional"}
skills: ${Array.isArray(c.candidate_skills) ? c.candidate_skills.join(", ") : (c.candidate_skills || "Not specified")}
summary: ${c.resume_summary || c.resumeSummary || ""}
`).join("\n");

  const prompt = `JOB REQUIREMENT:
${jobTitle ? `Title: ${jobTitle}\n` : ""}Required Skills: ${Array.isArray(requiredSkills) ? requiredSkills.join(", ") : (requiredSkills || "N/A")}
${mandatorySkills && Array.isArray(mandatorySkills) && mandatorySkills.length > 0 ? `Mandatory Skills: ${mandatorySkills.join(", ")}\n` : ""}JD Summary:
${jdSummary}

CANDIDATES LIST (${candidatesList.length} items):
${formattedCandidates}

Evaluate technical fit with specific skill overlap and concrete gaps. Return the JSON object with results array now.`;

  const log = require("../../../utils/logger");
  log.info(`[MATCH-TRACE] Prompt size: ${prompt.length} chars. Candidates: ${candidatesList.length}`);

  const raw = await complete(prompt, {
    system: BATCH_MATCH_PROMPT,
    modelKey: "reason",
    temperature: 0.1,
    maxTokens: Math.min(1800, Math.max(700, candidatesList.length * 350)),
  });

  const cleaned = stripCodeFences(raw || "");
  
  log.info(`[MATCH-TRACE] JSON parsing started. Raw response length: ${raw?.length || 0} chars`);

  try {
    const parsed = safeJsonParse(raw || "");
    const results = Array.isArray(parsed.results) ? parsed.results : [];

    // Normalize each candidate's match_status
    return {
      results: results.map((r) => {
        const rawStatus = (r.match_status || "").toLowerCase();
        let normalizedTier = "weak";
        if (rawStatus.includes("strong")) {
          normalizedTier = "strong";
        } else if (rawStatus.includes("potential") || rawStatus.includes("moderate")) {
          normalizedTier = "moderate";
        } else if (rawStatus.includes("low") || rawStatus.includes("weak")) {
          normalizedTier = "weak";
        }
        return {
          ...r,
          status: r.status || "success",
          match_status: normalizedTier,
          recommendation: recommendationLabelFromScore(r.match_score, normalizedTier, r.recommendation),
          next_action: nextActionFromScore(r.match_score, normalizedTier, r.next_action),
          ranking_explanation: String(r.ranking_explanation || "").trim(),
        };
      }),
    };
  } catch (error) {
    log.error(`[MATCH-TRACE] JSON parsing failed: ${error.message}. Response was: ${(raw || "").substring(0, 200)}...`);
    throw new Error(`Batch matching returned invalid JSON: ${error.message}`);
  }
}

function scoreBand(score, tier) {
  const n = Number(score);
  if (Number.isFinite(n)) {
    if (n >= 80) return "strong";
    if (n >= 50) return "moderate";
    return "weak";
  }
  const t = String(tier || "").toLowerCase();
  if (t.includes("strong")) return "strong";
  if (t.includes("moderate") || t.includes("potential")) return "moderate";
  return "weak";
}

function recommendationLabelFromScore(score, tier, raw) {
  const text = String(raw || "").toLowerCase();
  if (text.includes("strong")) return "Strong Match";
  if (text.includes("low") || text.includes("weak")) return "Low Match";
  if (text.includes("potential") || text.includes("moderate")) return "Potential Match";
  const band = scoreBand(score, tier);
  if (band === "strong") return "Strong Match";
  if (band === "moderate") return "Potential Match";
  return "Low Match";
}

function nextActionFromScore(score, tier, raw) {
  const text = String(raw || "").toLowerCase();
  if (text.includes("shortlist")) return "shortlist";
  if (text.includes("hold") || text.includes("review")) return "hold";
  if (text.includes("reject") || text.includes("pass")) return "reject";
  const band = scoreBand(score, tier);
  if (band === "strong") return "shortlist";
  if (band === "moderate") return "hold";
  return "reject";
}

module.exports = {
  matchSummaryToSummary,
  matchResumeToJD,
  matchBatchSummariesToSummary,
  recommendationLabelFromScore,
  nextActionFromScore,
};
