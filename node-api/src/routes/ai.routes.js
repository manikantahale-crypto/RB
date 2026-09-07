const express = require("express");
const aiController = require("../controllers/ai.controller");

const router = express.Router();

// Parsing only. Scoring is SYNTRA's — modules/syntra/routes/score.routes.
router.post("/summarize-jd", aiController.summarizeJdEndpoint);
router.post("/summarize-resume", aiController.summarizeResumeEndpoint);

module.exports = router;
