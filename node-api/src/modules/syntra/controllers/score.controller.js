/**
 * Scoring a resume against a JD, on demand.
 *
 * Split out of `controllers/ai.controller.js`, which held three stateless
 * endpoints: parse a JD, parse a resume, and score the two against each other.
 * The first two produce entities and ASTRA parses as well, so they are core.
 * Scoring is SYNTRA's, and this is the only one of the three that was.
 *
 * Kept together, that one file imported from `core/requirements`,
 * `core/resumes` AND `modules/syntra` — a file that breaks the layering by
 * construction, and would have needed a standing exception to survive the
 * boundary check. Split, it needs none: each endpoint now sits beside the
 * function it wraps.
 *
 * Stateless on purpose. It touches no repository and no table — text in, score
 * out — which is why moving it changes nothing about behaviour.
 */
const { matchSummaryToSummary } = require("../ai/matching");

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

module.exports = { scoreMatchEndpoint };
