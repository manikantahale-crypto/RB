const { complete } = require("../../../core/aiClient");

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
 "ranking_explanation": "Detailed explanation of candidate alignment, highlighting strengths and experience level.",
 "recommendation": "Strong Match"
}

Rules:
- match_score: An integer between 0 and 100. Be honest and realistic based on true alignment.
- recommendation: Choose one: "Strong Match" (80-100), "Potential Match" (50-79), or "Low Match" (0-49).
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
    const parsed = JSON.parse(cleaned);
    
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
  
  const cleaned = stripCodeFences(raw || "");
  
  try {
    return JSON.parse(cleaned);
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
- match_score: An integer between 0 and 100 representing semantic alignment.
- match_status: Must be one of: "Strong Match" (score 80-100), "Potential Match" (score 50-79), or "Low Match" (score 0-49).
- consultant_response: MUST be a bulleted list (max 5-7 bullets) starting with 'Why Matched:'.
- Return clean, valid JSON only.`;

async function matchBatchSummariesToSummary(candidatesList, jdSummary) {
  if (!Array.isArray(candidatesList) || candidatesList.length === 0) {
    return { results: [] };
  }
  if (!jdSummary || !jdSummary.trim()) {
    throw new Error("jdSummary is required for batch matching");
  }

  const formattedCandidates = candidatesList.map((c, i) => `
--- CANDIDATE ITEM ${i + 1} ---
candidate_id: ${c.candidate_id || c.candidateId}
resume_id: ${c.resume_id || c.resumeId}
summary: ${c.resume_summary || c.resumeSummary || ""}
`).join("\n");

  const prompt = `JD SUMMARY:
${jdSummary}

CANDIDATES LIST (${candidatesList.length} items):
${formattedCandidates}

Return the JSON object with results array now.`;

  const raw = await complete(prompt, {
    system: BATCH_MATCH_PROMPT,
    modelKey: "reason",
    temperature: 0.1,
    maxTokens: 2500,
  });

  const cleaned = stripCodeFences(raw || "");

  try {
    const parsed = JSON.parse(cleaned);
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
        };
      }),
    };
  } catch (error) {
    throw new Error(`Batch matching returned invalid JSON: ${error.message}`);
  }
}

module.exports = {
  matchSummaryToSummary,
  matchResumeToJD,
  matchBatchSummariesToSummary,
};
