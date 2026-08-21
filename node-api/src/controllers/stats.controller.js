const skillRepo = require("../repositories/skill.repository");
const matchRepo = require("../repositories/match.repository");

async function listTopSkills(req, res, next) {
  try {
    const rows = await skillRepo.listTopSkills({
      userId: req.userId,
      limit: req.query.limit,
    });
    res.json({
      skills: rows.map((r) => ({
        skill: r.skill,
        count: Number(r.count) || 0,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function dailyActivity(req, res, next) {
  try {
    const rows = await matchRepo.dailyActivity({
      userId: req.userId,
      days: req.query.days,
    });
    res.json({
      days: rows.map((r) => ({
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

module.exports = { listTopSkills, dailyActivity };
