const express = require("express");
const {
  listJobMatches,
  listCandidateMatches,
  listTopMatches,
  getMatch,
  getJob,
  getCandidate,
  getClosestResumesCount,
  getClosestJdsCount,
  retryCandidateMatch,
} = require("../controllers/matches.controller");

const router = express.Router();

// Reads, plus a retry that only enqueues. Running the funnel lives in
// modules/syntra/routes/matchActions.routes.
router.post("/matches/:matchId/retry", retryCandidateMatch);
router.get("/matches/top", listTopMatches);
router.get("/matches/:matchId", getMatch);
router.get("/jobs/:jobId/matches", listJobMatches);
router.get("/jobs/:jobId/closest-resumes-count", getClosestResumesCount);
router.get("/candidates/:candidateId/matches", listCandidateMatches);
router.get("/candidates/:candidateId/closest-jds-count", getClosestJdsCount);
router.get("/jobs/:jobId", getJob);
router.get("/candidates/:candidateId", getCandidate);

module.exports = router;
