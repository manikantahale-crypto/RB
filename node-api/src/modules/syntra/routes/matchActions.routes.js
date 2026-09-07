/**
 * SYNTRA's write endpoints on matches.
 *
 * Separate from `routes/matches.routes.js` so that the core route file — which
 * moves to `core/matches/` next — does not have to import an application to
 * mount its own reads. Same URLs as before; only which file registers them
 * changed.
 *
 * `/matches/:matchId/retry` deliberately stayed in the core file. It only
 * enqueues on `match.requested` and imports nothing of SYNTRA's.
 */
const express = require("express");
const {
  createDirectMatch,
  runJobMatch,
  runResumeMatch,
} = require("../controllers/matchActions.controller");

const router = express.Router();

router.post("/matches/direct", createDirectMatch);
router.post("/jobs/:jobId/run-match", runJobMatch);
router.post("/resumes/:resumeId/run-match", runResumeMatch);

module.exports = router;
