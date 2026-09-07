const { parseJD } = require("../ai/jdParsing");
const { parseResume } = require("../ai/resumeParsing");
const { matchSummaryToSummary } = require("../modules/syntra/ai/matching");

async function summarizeJdEndpoint(req, res) {
  const text = (req.body.text || "").trim();
  if (!text) return res.status(400).json({ detail: "text is empty" });

  try {
    const parsedData = await parseJD({ jdText: text });
    const summary = parsedData.summary || "";
    
    let skillsSet = new Set();
    [...(parsedData.required_skills || []), 
     ...(parsedData.mandatory_skills || []), 
     ...(parsedData.preferred_skills || [])].forEach(s => skillsSet.add(s));

    return res.json({
      summary,
      skills: Array.from(skillsSet),
      primary_role: parsedData.title || "other",
    });
  } catch (e) {
    return res.status(502).json({ detail: `summarize_jd failed: ${e.message}` });
  }
}

async function summarizeResumeEndpoint(req, res) {
  const text = (req.body.text || "").trim();
  if (!text) return res.status(400).json({ detail: "text is empty" });

  try {
    const parsedData = await parseResume(text);
    const summary = parsedData.summary || parsedData.ai_summary || "";

    return res.json({
      summary,
      skills: parsedData.skills || [],
      primary_role: parsedData.primary_skill || "other",
      full_name: parsedData.full_name || "",
      email: parsedData.email || "",
      phone: parsedData.phone || "",
      min_rate: parsedData.min_rate || "",
      immigration_status: parsedData.immigration_status || parsedData.visa_status || "",
      location: parsedData.current_location || [parsedData.city, parsedData.state].filter(Boolean).join(", ") || "",
      education: parsedData.education || [],
      experience: parsedData.experience || "",
      total_experience: parsedData.total_experience || "",
      current_company: parsedData.current_company || "",
      current_role: parsedData.current_role || "",
      linkedin: parsedData.linkedin || "",
      github: parsedData.github || "",
      profile_summary: parsedData.ai_summary || summary,
    });
  } catch (e) {
    return res.status(502).json({ detail: `summarize_resume failed: ${e.message}` });
  }
}

async function scoreMatchEndpoint(req, res) {
  const { jdSummary, resumeSummary, threshold = 60 } = req.body;
  
  if (!jdSummary || typeof jdSummary !== 'string' || !jdSummary.trim()) {
    return res.status(400).json({ detail: "jdSummary is required" });
  }
  
  if (!resumeSummary || typeof resumeSummary !== 'string' || !resumeSummary.trim()) {
    return res.status(400).json({ detail: "resumeSummary is required" });
  }

  try {
    const result = await matchSummaryToSummary(resumeSummary, jdSummary);
    return res.json({
      score: result.match_score || 0,
      tier: result.match_status || "weak",
      reasoning: result.consultant_response || "",
      strengths: result.strengths || [],
      gaps: result.gaps || [],
      greenFlags: result.green_flags || [],
      redFlags: result.red_flags || [],
      eligibleForInvite: (result.match_score || 0) >= threshold,
      confidenceScore: result.confidence_score || 0,
      breakdown: result.breakdown || {},
      evidence: [],
    });
  } catch (e) {
    if (e.message.includes("is required") || e.message.includes("malformed")) {
      return res.status(400).json({ detail: e.message });
    }
    return res.status(502).json({ detail: `score-match failed: ${e.message}` });
  }
}

module.exports = {
  summarizeJdEndpoint,
  summarizeResumeEndpoint,
  scoreMatchEndpoint,
};
