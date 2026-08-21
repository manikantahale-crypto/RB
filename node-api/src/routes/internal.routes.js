const express = require("express");
const { handleJdUploaded } = require("../workers/jdUploaded.worker");
const { handleResumeUploaded } = require("../workers/resumeUploaded.worker");
const { handleMatchRequested } = require("../workers/matchRequested.worker");
const log = require("../utils/logger");

const router = express.Router();

// JD processing — summarize + funnel
router.post("/internal/jobs/:id/process", async (req, res) => {
  const jobId = req.params.id;
  try {
    await handleJdUploaded({ data: { jobId } });
    res.json({ status: "processed", jobId });
  } catch (err) {
    log.error(`[internal] job ${jobId} failed: ${err.message}`);
    res.status(500).json({ status: "failed", jobId, error: err.message });
  }
});

// Resume processing — summarize + candidate profile + funnel
router.post("/internal/resumes/:id/process", async (req, res) => {
  const resumeId = req.params.id;
  const { candidateId } = req.body || {};
  try {
    await handleResumeUploaded({ data: { resumeId, candidateId } });
    res.json({ status: "processed", resumeId });
  } catch (err) {
    log.error(`[internal] resume ${resumeId} failed: ${err.message}`);
    res.status(500).json({ status: "failed", resumeId, error: err.message });
  }
});

// Match scoring — needs BOTH jobId and resumeId
router.post("/internal/matches/process", async (req, res) => {
  const { jobId, resumeId } = req.body || {};
  if (!jobId || !resumeId) {
    return res.status(400).json({ status: "failed", error: "jobId and resumeId required" });
  }
  try {
    await handleMatchRequested({ data: { jobId, resumeId } });
    res.json({ status: "processed", jobId, resumeId });
  } catch (err) {
    log.error(`[internal] match ${jobId}/${resumeId} failed: ${err.message}`);
    res.status(500).json({ status: "failed", jobId, resumeId, error: err.message });
  }
});

module.exports = router;
