const crypto = require("crypto");
const astraRepo = require("../repositories/astra.repository");
const { withTransaction, pool } = require("../../../config/db");
const { getBoss } = require("../../../config/queue");
const log = require("../../../utils/logger");

/**
 * Normalizes text: converts to lowercase, collapses consecutive whitespace, and trims.
 * Equivalent to reference behavior: (text || "").toLowerCase().replace(/\s+/g, " ").trim()
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Normalizes an array or delimited string of skills:
 * - Converts each skill to lowercase
 * - Trims / collapses whitespace
 * - Filters out empty values
 * - Removes duplicates (Set)
 * - Sorts alphabetically
 * - Joins with commas
 *
 * @param {string[]|string} skills
 * @returns {string} Comma-separated sorted skills string
 */
function normalizeSkills(skills) {
  if (!skills) return "";
  let arr = [];
  if (Array.isArray(skills)) {
    arr = skills;
  } else if (typeof skills === "string") {
    arr = skills.split(/[,;\n|]/);
  }
  const cleaned = arr
    .map((s) => normalizeText(s))
    .filter(Boolean);
  const unique = Array.from(new Set(cleaned));
  return unique.sort().join(",");
}

/**
 * Normalizes email address by stripping display brackets and lowercasing.
 * e.g., "John Doe <john@vendor.com>" -> "john@vendor.com"
 *
 * @param {string} email
 * @returns {string|null}
 */
function normalizeEmail(email) {
  if (!email || typeof email !== "string") return null;
  let e = email.trim().toLowerCase();
  if (e.includes("<") && e.includes(">")) {
    const match = e.match(/<([^>]+)>/);
    e = match ? match[1].trim() : e;
  }
  return e || null;
}

/**
 * Normalizes Message-ID by trimming surrounding whitespace.
 *
 * @param {string} messageId
 * @returns {string|null}
 */
function normalizeMessageId(messageId) {
  if (!messageId || typeof messageId !== "string") return null;
  const trimmed = messageId.trim();
  return trimmed || null;
}

/**
 * Standardizes common visa variants conservatively without altering unknown values.
 *
 * @param {string} visa
 * @returns {string|null}
 */
function normalizeVisaRequirement(visa) {
  if (!visa || typeof visa !== "string") return null;
  const v = visa.trim();
  const vLower = v.toLowerCase();
  if (vLower === "null" || vLower === "undefined") return null;
  if (vLower === "h1b" || vLower === "h-1b" || vLower === "h 1b") return "H1B";
  if (vLower === "gc" || vLower === "green card" || vLower === "greencard") return "GC";
  if (vLower === "usc" || vLower === "us citizen" || vLower === "us citizenship") return "USC";
  if (vLower === "opt" || vLower === "opt ead" || vLower === "optead") return "OPT";
  if (vLower === "cpt" || vLower === "cpt ead" || vLower === "cptead") return "CPT";
  return v;
}

/**
 * Canonical normalization for employment_type.
 * Allowed database values are strictly: 'W2', 'C2C', '1099', or null.
 *
 * @param {string|null|undefined} type
 * @returns {"W2"|"C2C"|"1099"|null}
 */
function normalizeEmploymentType(type) {
  if (!type || typeof type !== "string") return null;
  const t = type.trim();
  if (!t || t.toLowerCase() === "null" || t.toLowerCase() === "undefined") return null;

  // Explicit C2C variants (e.g. C2C, c2c, corp-to-corp, corp to corp, corp2corp, c-to-c)
  if (/\b(c2c|c-to-c|c\s*to\s*c|corp-to-corp|corp\s*to\s*corp|corp2corp)\b/i.test(t)) {
    return "C2C";
  }

  // Explicit W2 variants (e.g. W2, w2, W-2, w-2, W 2)
  if (/\b(w-?2|w\s*2)\b/i.test(t)) {
    return "W2";
  }

  // Explicit 1099 variants (e.g. 1099, form 1099, form-1099)
  if (/\b(1099|form-?1099|form\s*1099)\b/i.test(t)) {
    return "1099";
  }

  // Everything else (Full-time, Contract, Contractor, Permanent, etc.) must be null
  return null;
}

/**
 * Standardizes remote policy values.
 *
 * @param {string} remote
 * @returns {string|null}
 */
function normalizeRemotePolicy(remote) {
  if (!remote || typeof remote !== "string") return null;
  const r = remote.trim();
  const rLower = r.toLowerCase();
  if (rLower === "null" || rLower === "undefined") return null;
  if (rLower === "remote") return "Remote";
  if (rLower === "hybrid") return "Hybrid";
  if (rLower === "onsite" || rLower === "on-site") return "Onsite";
  return r;
}

/**
 * Normalizes a source URL string.
 * Returns a valid trimmed URL string or null.
 *
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
function normalizeSourceUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "undefined") return null;
  return trimmed;
}

/**
 * Sanitizes email/raw text by trimming forwarded or reply thread headers.
 *
 * @param {string} rawText
 * @returns {string}
 */
function sanitizeRequirementText(rawText) {
  if (!rawText || typeof rawText !== "string") return "";
  const body = rawText;
  const markers = [
    "on thu,", "on mon,", "on tue,", "on wed,", "on fri,", "on sat,", "on sun,",
    "wrote:", "-----original message-----", "---------- forwarded message ---------",
    "mail delivery subsystem", "mailer-daemon", "delivery status notification"
  ];
  const bodyLower = body.toLowerCase();
  let earliestIdx = body.length;
  for (const marker of markers) {
    const idx = bodyLower.indexOf(marker);
    if (idx !== -1 && idx < earliestIdx) {
      earliestIdx = idx;
    }
  }
  const extracted = body.slice(0, earliestIdx).trim();
  return extracted || body.trim();
}

/**
 * Builds deterministic SHA-256 content fingerprint hash based on reference canonical formula:
 *   normalized title
 *   |
 *   normalized client/company
 *   |
 *   normalized location
 *   |
 *   sorted normalized skills
 *   |
 *   normalized source subject truncated to 200 characters
 *
 * @param {Object} params
 * @param {string} params.title
 * @param {string} params.companyName
 * @param {string} params.location
 * @param {string[]|string} params.skills
 * @param {string} [params.sourceSubject]
 * @returns {string} 64-character lowercase hexadecimal string
 */
function buildRequirementContentHash({ title, companyName, location, skills, sourceSubject }) {
  const normTitle = normalizeText(title);
  const normCompany = normalizeText(companyName);
  const normLocation = normalizeText(location);
  const normSkills = normalizeSkills(skills);
  const normSubject = normalizeText(sourceSubject).slice(0, 200);

  const canonicalString = [
    normTitle,
    normCompany,
    normLocation,
    normSkills,
    normSubject,
  ].join("|");

  return crypto
    .createHash("sha256")
    .update(canonicalString, "utf8")
    .digest("hex");
}

/**
 * Main ASTRA Requirement Intelligence Ingestion Flow:
 *
 * 1. Validate incoming payload.
 * 2. Tier 1 Deduplication: Fast check on Message-ID.
 * 3. Normalize fields and build deterministic canonical summary_hash.
 * 4. Tier 2 Deduplication: Content-hash check against syntra.jobs.
 * 5. Persist normalized requirement via astra.repository.js in a transaction.
 * 6. Publish downstream ASTRA event 'astra.requirement.received' (NOT jd.uploaded).
 * 7. Return standardized response to caller.
 *
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
/**
 * THE SERVICE OWNS `astra.requirement.received`. One writer, here, inside the
 * transaction that created the row. Every intake path — email, API, job
 * board — calls this; the orchestrator's intake nodes do not emit it
 * (onboarding path 4.4: "service owns each emit — no node emits the same
 * event"). Until 2026-09-20 the engine's intake node emitted a second copy,
 * and the API ingest route emitted none.
 *
 * `correlationId` is the FLOW's, when a workflow asked for this
 * requirement: the run it starts then sits in the same flow as the RELAY
 * run that received the email. Absent, the outbox mints one.
 */
async function writeRequirementReceived(client, job, channelType, { correlationId = null, causationId = null } = {}) {
  const outboxRepo = require("../../../repositories/outbox.repository");
  return outboxRepo.insertEvent(client, {
    eventType: "astra.requirement.received",
    // The event belongs to the requirement's organisation — never an env default.
    organizationId: job.org_id,
    aggregateType: "requirement",
    aggregateId: job.id,
    producer: "astra-intake",
    correlationId,
    causationId,
    payload: {
      requirement_id: job.id,
      jobId: job.id,
      title: job.title,
      channel_type: channelType,
    },
  });
}

async function ingestRequirement(payload = {}) {
  if (!payload || typeof payload !== "object" || Object.keys(payload).length === 0) {
    const err = new Error("Requirement payload cannot be empty");
    err.statusCode = 400;
    throw err;
  }

  const rawTitle = payload.title || payload.job_title || payload.jobTitle || "";
  const rawCompany = payload.companyName || payload.company_name || payload.clientName || payload.client_name || payload.company || "";
  const rawLocation = payload.location || "";
  const rawSkills = payload.skills || payload.required_skills || payload.requiredSkills || [];
  const rawSubject = payload.sourceSubject || payload.source_subject || payload.subject || "";
  const rawText = sanitizeRequirementText(payload.rawText || payload.raw_text || payload.body || payload.text || "");
  const rawEmail = payload.sourceEmail || payload.source_email || payload.from_email || payload.from || payload.sender || "";
  const rawMessageId = payload.messageId || payload.message_id || "";
  const sourceUrl = normalizeSourceUrl(payload.sourceUrl || payload.source_url || "");

  const incomingCreatedBy = payload.createdBy || payload.created_by || payload.userId || null;
  const relayThreadId =
    payload.relayThreadId || payload.relay_thread_id || payload.thread_id || payload.threadId || null;

  // A duplicate found for an existing row: fill in what the new arrival knows
  // and the row does not. Never overwrites.
  const backfill = async (jobId, column, value) => {
    if (!value) return;
    try {
      await pool.query(`UPDATE core.requirements SET ${column} = $2 WHERE id = $1 AND ${column} IS NULL`, [jobId, value]);
    } catch (err) {
      log.warn(`[ASTRA] Failed to backfill ${column} for job ${jobId}: ${err.message}`);
    }
  };

  // 1. Tier 1 Deduplication: Message-ID Check (Early exit before DB insert, scoped per recruiter)
  const messageId = normalizeMessageId(rawMessageId);
  if (messageId) {
    const existingByMessageId = await astraRepo.findRequirementByMessageId(messageId, incomingCreatedBy);
    if (existingByMessageId) {
      log.info(`[ASTRA] Duplicate requirement detected via Message-ID: '${messageId}' for user ${incomingCreatedBy || "legacy"} (job ID: ${existingByMessageId.id})`);
      await backfill(existingByMessageId.id, "source_url", sourceUrl);
      await backfill(existingByMessageId.id, "created_by", incomingCreatedBy);
      await backfill(existingByMessageId.id, "relay_thread_id", relayThreadId);
      return {
        created: false,
        duplicate: true,
        duplicateReason: "message_id",
        job: existingByMessageId,
      };
    }
  }

  // 2. Build Deterministic Content Hash (Tier 2)
  const summaryHash = buildRequirementContentHash({
    title: rawTitle,
    companyName: rawCompany,
    location: rawLocation,
    skills: rawSkills,
    sourceSubject: rawSubject,
  });

  // 3. Tier 2 Deduplication: Content Hash Check (scoped per recruiter)
  const existingByHash = await astraRepo.findRequirementBySummaryHash(summaryHash, incomingCreatedBy);
  if (existingByHash) {
    log.info(`[ASTRA] Duplicate requirement detected via content hash: '${summaryHash}' for user ${incomingCreatedBy || "legacy"} (job ID: ${existingByHash.id})`);
    await backfill(existingByHash.id, "source_url", sourceUrl);
    await backfill(existingByHash.id, "created_by", incomingCreatedBy);
    await backfill(existingByHash.id, "relay_thread_id", relayThreadId);
    return {
      created: false,
      duplicate: true,
      duplicateReason: "content_hash",
      job: existingByHash,
    };
  }

  // 4. Normalize fields for storage
  const sourceEmail = normalizeEmail(rawEmail);
  const visaRequirement = normalizeVisaRequirement(payload.visaRequirement || payload.visa_requirement || payload.visa || "");
  const employmentType = normalizeEmploymentType(payload.employmentType || payload.employment_type || payload.jobType || payload.job_type || "");
  const remotePolicy = normalizeRemotePolicy(payload.remotePolicy || payload.remote_policy || payload.remoteOption || payload.remote_option || "");

  let minExperience = null;
  if (payload.minExperience != null) {
    minExperience = Number(payload.minExperience);
  } else if (payload.min_experience != null) {
    minExperience = Number(payload.min_experience);
  }

  let maxExperience = null;
  if (payload.maxExperience != null) {
    maxExperience = Number(payload.maxExperience);
  } else if (payload.max_experience != null) {
    maxExperience = Number(payload.max_experience);
  }

  const effectiveTitle = rawTitle ? rawTitle.trim() : (rawSubject ? rawSubject.trim() : "Untitled Role");

  const requirementData = {
    title: effectiveTitle,
    companyName: rawCompany ? rawCompany.trim() : null,
    originalFileName: payload.originalFileName || payload.original_file_name || null,
    filePath: payload.filePath || payload.file_path || null,
    mimeType: payload.mimeType || payload.mime_type || null,
    rawText: rawText,
    sourceEmail: sourceEmail,
    sourceUrl: sourceUrl,
    messageId: messageId,
    location: rawLocation ? rawLocation.trim() : null,
    minExperience: Number.isFinite(minExperience) ? minExperience : null,
    maxExperience: Number.isFinite(maxExperience) ? maxExperience : null,
    visaRequirement: visaRequirement,
    employmentType: employmentType,
    remotePolicy: remotePolicy,
    summaryHash: summaryHash,
    status: payload.status || "Active",
    createdBy: incomingCreatedBy,
    vendorId: payload.vendorId || payload.vendor_id || null,
    relayThreadId,
    sourceType: payload.sourceType || payload.source_type || null,
    sourceName: payload.sourceName || payload.source_name || null,
  };

  // 5. Persist in core.requirements via astra.repository.js and write the platform event to event_outbox
  const newJob = await withTransaction(async (client) => {
    const job = await astraRepo.insertRequirement(client, requirementData);

    let channelType = "API";
    if (requirementData.sourceEmail || payload.sourceType === "email" || payload.source_type === "email") {
      channelType = "EMAIL";
    } else if (payload.sourceType === "job_board" || payload.source_type === "job_board") {
      channelType = "JOB_BOARD";
    }
    const outboxResult = await writeRequirementReceived(client, job, channelType, {
      correlationId: payload.correlation_id || payload.correlationId || null,
      causationId: payload.causation_id || payload.causationId || null,
    });
    job.correlationId = outboxResult.correlation_id;
    job.eventId = outboxResult.event_id;
    return job;
  });

  log.info(`[ASTRA] Requirement successfully created: ${newJob.id} (summaryHash: ${summaryHash}, correlationId: ${newJob.correlationId})`);

  // 6. Enqueue requirement to pg-boss queue 'module.astra.requirement' for ASTRA Intelligence enrichment
  let eventPublished = false;
  let eventError = null;

  try {
    const channelType = requirementData.sourceEmail || payload.sourceType === "email" || payload.source_type === "email"
      ? "EMAIL"
      : (payload.sourceType === "job_board" || payload.source_type === "job_board" ? "JOB_BOARD" : "API");

    await getBoss().send("module.astra.requirement", {
      jobId: newJob.id,
      correlationId: newJob.correlationId,
      eventId: newJob.eventId,
      sourceType: payload.sourceType || (requirementData.sourceEmail ? "email" : "job_board"),
      sourceName: payload.sourceName || (requirementData.sourceEmail ? "email" : "api"),
      payload_ref: {
        requirement_id: newJob.id,
        title: newJob.title,
        channel_type: channelType
      }
    });
    eventPublished = true;
    log.info(`[ASTRA] Enqueued requirement ${newJob.id} to pg-boss queue 'module.astra.requirement'`);
  } catch (err) {
    eventError = err.message;
    log.error(`[ASTRA] Failed to enqueue requirement ${newJob.id} to 'module.astra.requirement': ${err.message}`);
  }

  // 7. Return standardized response
  const response = {
    created: true,
    duplicate: false,
    jobId: newJob.id,
    job: newJob,
    correlationId: newJob.correlationId,
    eventId: newJob.eventId
  };

  if (eventError) {
    response.eventError = eventError;
    response.eventPublished = false;
  } else {
    response.eventPublished = eventPublished;
  }

  return response;
}

module.exports = {
  writeRequirementReceived,
  ingestRequirement,
  normalizeText,
  normalizeSkills,
  normalizeEmail,
  normalizeSourceUrl,
  normalizeMessageId,
  normalizeVisaRequirement,
  normalizeEmploymentType,
  normalizeRemotePolicy,
  sanitizeRequirementText,
  buildRequirementContentHash,
};
