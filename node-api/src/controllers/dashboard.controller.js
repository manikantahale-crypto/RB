const jobRepo = require("../repositories/job.repository");
const candidateRepo = require("../repositories/candidate.repository");
const lifecycleRepo = require("../modules/orbit/repositories/lifecycle.repository");
const skillRepo = require("../repositories/skill.repository");
const matchRepo = require("../repositories/match.repository");
const { mapJobListItem } = require("./job.controller");
const { mapCandidateListItem } = require("./candidate.controller");

/**
 * Single dashboard payload — queries run sequentially to use one DB pool slot
 * at a time (avoids Supabase EMAXCONN when worker + admin are also connected).
 */
async function getDashboardSummary(req, res, next) {
  try {
    const userId = req.userId;
    const days = req.query.days;

    const { rows: jobRows } = await jobRepo.listJobs({ userId, limit: 100 });
    const { rows: candRows } = await candidateRepo.listCandidates({
      userId,
      limit: 100,
    });

    const candidateIds = candRows.map((r) => r.id);
    const stateMap =
      candidateIds.length > 0
        ? await lifecycleRepo.getLatestStatesForCandidates(candidateIds)
        : new Map();

    const skillRows = await skillRepo.listTopSkills({ userId, limit: 6 });
    const matchRows = await matchRepo.listTopMatches({ userId, limit: 50 });
    const trendRows = await matchRepo.dailyActivity({ userId, days });

    res.json({
      jobs: jobRows.map(mapJobListItem),
      candidates: candRows.map((r) => mapCandidateListItem(r, stateMap)),
      skills: skillRows.map((r) => ({
        skill: r.skill,
        count: Number(r.count) || 0,
      })),
      matches: matchRows.map((r) => ({
        matchId: r.match_id,
        candidateId: r.candidate_id,
        candidateName: r.candidate_name,
        jobId: r.job_id,
        jobTitle: r.job_title,
        score: r.score != null ? Number(r.score) : 0,
        tier: r.tier,
        skillMatchScore: r.skill_match_score,
      })),
      days: trendRows.map((r) => ({
        date: r.date,
        matchesRequested: Number(r.matches_requested) || 0,
        matchesCompleted: Number(r.matches_completed) || 0,
        eligibleMatches: Number(r.eligible_matches) || 0,
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getDashboardSummary };
