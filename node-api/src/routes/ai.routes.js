const express = require("express");
const aiController = require("../controllers/ai.controller");

const router = express.Router();

router.post("/summarize-jd", aiController.summarizeJdEndpoint);
router.post("/summarize-resume", aiController.summarizeResumeEndpoint);
router.post("/score-match", aiController.scoreMatchEndpoint);

module.exports = router;
