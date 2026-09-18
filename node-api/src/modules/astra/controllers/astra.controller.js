const emailAdapter = require("../services/adapters/email.adapter");
const log = require("../../../utils/logger");

/**
 * Controller for email-based requirement intake.
 *
 * Responsibilities:
 * - Validates presence of email content / payload.
 * - Extracts authenticated user ID from req (if available).
 * - Passes request to emailAdapter.ingestEmail().
 * - Returns clean, standardized HTTP responses (201 for created, 200 for duplicate, 400/500 for errors).
 * - Logs unexpected server failures without leaking sensitive internal details.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function ingestEmail(req, res, next) {
  try {
    const rawBody = req.body;
    if (!rawBody || typeof rawBody !== "object" || Object.keys(rawBody).length === 0) {
      return res.status(400).json({ error: "Missing or invalid email payload" });
    }

    const hasContent = Boolean(
      (rawBody.body && String(rawBody.body).trim()) ||
      (rawBody.emailText && String(rawBody.emailText).trim()) ||
      (rawBody.content && String(rawBody.content).trim()) ||
      (rawBody.text && String(rawBody.text).trim()) ||
      (rawBody.rawText && String(rawBody.rawText).trim()) ||
      (rawBody.raw_text && String(rawBody.raw_text).trim()) ||
      (rawBody.subject && String(rawBody.subject).trim()) ||
      (rawBody.sourceSubject && String(rawBody.sourceSubject).trim()) ||
      (rawBody.source_subject && String(rawBody.source_subject).trim())
    );

    if (!hasContent) {
      return res.status(400).json({ error: "Email body or subject is required" });
    }

    // Extract createdBy from req.userId, req.user, or decode optional Authorization header if present
    let authUserId = req.userId || req.user?.userId || null;
    if (!authUserId && req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      try {
        const token = req.headers.authorization.substring(7).trim();
        const jwt = require("jsonwebtoken");
        const env = require("../../../config/env");
        const payload = jwt.verify(token, env.AUTH_JWT_SECRET);
        authUserId = payload?.userId || null;
      } catch (_) {
        // Optional auth: ignore token verification errors for intake webhooks
      }
    }

    const createdBy =
      authUserId ||
      rawBody.createdBy ||
      rawBody.created_by ||
      rawBody.userId ||
      null;

    const payload = {
      ...rawBody,
      createdBy,
    };

    const result = await emailAdapter.ingestEmail(payload);

    if (result.duplicate) {
      return res.status(200).json({
        created: false,
        duplicate: true,
        duplicateReason: result.duplicateReason,
        job: result.job,
      });
    }

    return res.status(201).json({
      created: true,
      duplicate: false,
      jobId: result.jobId,
      job: result.job,
      ...(result.eventError ? { eventError: result.eventError } : {}),
      ...(result.eventPublished !== undefined ? { eventPublished: result.eventPublished } : {}),
    });
  } catch (err) {
    if (err.statusCode === 400 || err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    log.error(`[ASTRA Controller] Ingestion failed: ${err.message}`, err.stack || err);
    return res.status(500).json({ error: "Internal server error during email requirement ingestion" });
  }
}

async function getEmailStatus(req, res, next) {
  try {
    const env = require("../../../config/env");
    return res.json({
      status: "success",
      configured: Boolean(env.IMAP_USERNAME && env.IMAP_PASSWORD),
      emailAccount: env.IMAP_USERNAME || "Not configured",
      folder: "INBOX",
      isEnabled: env.IMAP_POLL_ENABLED,
      lastChecked: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
}

async function pollEmails(req, res, next) {
  try {
    const emailPollerService = require("../services/emailPoller.service");
    const stats = await emailPollerService.pollEmails();
    return res.json({
      status: "success",
      data: stats
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  ingestEmail,
  getEmailStatus,
  pollEmails,
};
