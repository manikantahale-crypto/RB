const express = require("express");
const {
  listCandidates,
  getCandidate,
  updateCandidate,
  deleteCandidate,
  deleteCandidatesBulk,
} = require("../controllers/candidate.controller");
const {
  getLifecycle,
  transitionLifecycle,
} = require("../controllers/lifecycle.controller");
const {
  getActivities,
  createNote,
} = require("../controllers/activity.controller");

const router = express.Router();

// Candidate list & bulk operations
router.get("/", listCandidates);
router.post("/bulk-delete", deleteCandidatesBulk);

// Individual candidate operations
router.get("/:candidateId", getCandidate);
router.patch("/:candidateId", updateCandidate);
router.delete("/:candidateId", deleteCandidate);

// Lifecycle states & transitions
router.get("/:candidateId/lifecycle", getLifecycle);
router.post("/:candidateId/lifecycle/transition", transitionLifecycle);

// Recruiter notes & activity feed
router.get("/:candidateId/activities", getActivities);
router.post("/:candidateId/activities", createNote);

module.exports = router;
