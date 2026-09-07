/**
 * Parsing endpoints — text in, structured entity out.
 *
 * `scoreMatchEndpoint` used to live here too and moved to
 * modules/syntra/controllers/score.controller. Parsing produces an entity and
 * ASTRA parses as well, so it is core; scoring is SYNTRA's alone. Keeping all
 * three together meant one file importing from two core areas and an
 * application at once.
 */
const { parseJD } = require("../ai/jdParsing");
const { parseResume } = require("../ai/resumeParsing");

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

module.exports = {
  summarizeJdEndpoint,
  summarizeResumeEndpoint,
};
