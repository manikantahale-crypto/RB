/**
 * Internal ASTRA HTTP tools — called by orchestrator worker (no user JWT).
 * Must be mounted BEFORE app.use(requireAuth, matches.routes) catch-all.
 */
const express = require("express");
const crypto = require("crypto");
const { pool } = require("../config/db");
const astraRepo = require("../repositories/astra.repository");
const astraService = require("../services/astra/astra.service");
const {
  evaluateRequirementQuality,
  enrichRequirement,
} = require("../services/astra/astraIntelligence.service");
const emailAdapter = require("../services/astra/adapters/email.adapter");
const jobBoardsController = require("../controllers/jobBoards.controller");
const log = require("../utils/logger");

const router = express.Router();

function pickRawText(body) {
  return (
    body.raw_text ||
    body.rawText ||
    body.body ||
    body.content ||
    ""
  );
}

function pickSkills(body) {
  const s = body.required_skills ?? body.requiredSkills ?? body.skills;
  if (Array.isArray(s)) return s;
  if (typeof s === "string") return s.split(/[,;\n|]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

/** POST /internal/astra/requirements/quality — cheap score (no full LLM). */
router.post("/internal/astra/requirements/quality", async (req, res, next) => {
  try {
    const body = req.body || {};
    let title = body.title;
    let rawText = pickRawText(body);
    let requiredSkills = pickSkills(body);
    let minExperience = body.min_experience ?? body.minExperience ?? null;

    const jobId = body.jobId || body.requirement_id || body.requirementId;
    if (jobId) {
      const row = await astraRepo.getRequirementById(jobId);
      if (row) {
        title = title || row.title;
        rawText = rawText || row.raw_text || "";
        if (!requiredSkills.length && row.required_skills) {
          requiredSkills = Array.isArray(row.required_skills)
            ? row.required_skills
            : JSON.parse(row.required_skills || "[]");
        }
        minExperience = minExperience ?? row.min_experience;
      }
    }

    const quality = evaluateRequirementQuality({
      title,
      rawText,
      requiredSkills,
      minExperience,
    });

    log.info(
      `[internal/astra] quality jobId=${jobId || "n/a"} conf=${quality.confidenceScore} actionable=${quality.isActionable}`,
    );

    res.json({
      status: "scored",
      jobId: jobId || null,
      is_actionable: quality.isActionable,
      confidence_score: quality.confidenceScore,
      validation_details: quality.validationDetails,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /internal/astra/requirements/ingest — create requirement row (orch ingest node). */
router.post("/internal/astra/requirements/ingest", async (req, res, next) => {
  try {
    const body = req.body || {};
    const rawText = pickRawText(body);
    const summaryHash = crypto
      .createHash("sha256")
      .update(rawText || body.title || "")
      .digest("hex");

    const job = await astraRepo.insertRequirement(null, {
      title: body.title || "Untitled Role",
      rawText,
      summaryHash,
      sourceUrl: body.source_url || body.sourceUrl || null,
      sourceEmail: body.source_email || body.sourceEmail || null,
      messageId: body.message_id || body.messageId || null,
      location: body.location || null,
      processingStatus: "uploaded",
      createdBy: body.createdBy || body.created_by || null,
    });

    log.info(`[internal/astra] ingest jobId=${job.id}`);
    res.status(201).json({
      status: "created",
      jobId: job.id,
      requirement_id: job.id,
      title: job.title,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /internal/astra/requirements/:id/normalize — full ASTRA enrich + persist. */
router.post("/internal/astra/requirements/:id/normalize", async (req, res, next) => {
  try {
    const jobId = req.params.id;
    const body = req.body || {};
    const row = await astraRepo.getRequirementById(jobId);
    if (!row) {
      return res.status(404).json({ status: "not_found", jobId });
    }

    const enriched = await enrichRequirement({
      ...row,
      raw_text: pickRawText(body) || row.raw_text,
      title: body.title || row.title,
    });

    const updated = await astraRepo.updateEnrichedRequirement(jobId, enriched);

    log.info(
      `[internal/astra] normalize jobId=${jobId} conf=${enriched.confidenceScore}`,
    );

    res.json({
      status: "normalized",
      jobId,
      is_actionable: enriched.isActionable,
      confidence_score: enriched.confidenceScore,
      title: updated?.title || enriched.title,
      required_skills: enriched.requiredSkills,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /internal/astra/intake/email */
router.post("/internal/astra/intake/email", async (req, res, next) => {
  try {
    const result = await emailAdapter.ingestEmail(req.body || {});
    if (result.duplicate) {
      return res.status(200).json({
        created: false,
        duplicate: true,
        jobId: result.job?.id,
        job: result.job,
      });
    }
    res.status(201).json({
      created: true,
      jobId: result.job?.id,
      job: result.job,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /internal/astra/jobboards/fetch — orch jobboard node (no user session). */
router.post("/internal/astra/jobboards/fetch", async (req, res, next) => {
  try {
    await jobBoardsController.fetchRequirements(
      { body: req.body, userId: req.body?.userId || req.body?.createdBy || null },
      res,
      next,
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
