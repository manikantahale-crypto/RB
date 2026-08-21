const express = require("express");
const {
  listJobMatches,
  listCandidateMatches,
  listTopMatches,
  createDirectMatch,
  runJobMatch,
  runResumeMatch,
  getMatch,
  getJob,
  getCandidate,
  getClosestResumesCount,
  getClosestJdsCount,
  retryCandidateMatch,
} = require("../controllers/matches.controller");

const router = express.Router();

router.post("/matches/direct", createDirectMatch);
router.post("/matches/:matchId/retry", retryCandidateMatch);
router.post("/jobs/:jobId/run-match", runJobMatch);
router.post("/resumes/:resumeId/run-match", runResumeMatch);
router.get("/matches/top", listTopMatches);
router.get("/matches/:matchId", getMatch);
router.get("/jobs/:jobId/matches", listJobMatches);
router.get("/jobs/:jobId/closest-resumes-count", getClosestResumesCount);
router.get("/candidates/:candidateId/matches", listCandidateMatches);
router.get("/candidates/:candidateId/closest-jds-count", getClosestJdsCount);
router.get("/jobs/:jobId", getJob);
router.get("/candidates/:candidateId", getCandidate);

module.exports = router;
