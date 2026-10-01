/**
 * What ASTRA writes and reads: the requirement it takes in, the document it
 * came as, and where its processing stands.
 *
 * Moved from repositories/astra.repository.js on 2026-09-18 (ref/ASTRA_Onboarding.md
 * stage 4). It already wrote core.requirements (commit b965c0e). Brought up to
 * what ASTRA gained on the old project after the fork, and fixed where it was
 * wrong for core:
 *
 *   - the document is written to core.source_files with the body and the
 *     content hash EVEN WHEN THERE IS NO FILE — an email requirement has no
 *     file_path; its body is the requirement (V20260909.70). Before, the body
 *     and the dedup hash of every email JD were dropped.
 *   - vendor_id, relay_thread_id, source_type and source_name are stored on
 *     the requirement (the old insert never set source_type; the
 *     `origin`/`source_type` rule the copy used undercounted ASTRA because of it).
 *   - dedup lookups scope by recruiter (created_by) as they did on the old
 *     project; the hash lookup reads core.source_files.content_hash.
 *   - processing state goes through core.processing_jobs with
 *     application = 'astra'; the enrichment update no longer names
 *     processing_* columns that core.requirements does not have.
 */
const { pool } = require("../../../config/db");
const { CORE_REQUIREMENTS } = require("../../../repositories/core-views");
const { addSourceFile, setProcessing } = require("../../../repositories/core-writes");

const ALLOWED_EMPLOYMENT_TYPES = new Set(["W2", "C2C", "1099"]);

function sanitizeEmploymentType(type) {
  if (!type || typeof type !== "string") return null;
  const upper = type.trim().toUpperCase();
  return ALLOWED_EMPLOYMENT_TYPES.has(upper) ? upper : null;
}

/** email | job_board | api — how the requirement arrived. */
function sourceTypeOf(data) {
  const declared = String(data.sourceType || data.source_type || "").toLowerCase();
  if (declared === "email" || declared === "job_board" || declared === "api") return declared;
  if (data.sourceEmail) return "email";
  if (data.sourceUrl) return "job_board";
  return "api";
}

/**
 * Inserts an ASTRA-ingested requirement: the requirement row, then its
 * document. Both on the caller's transaction.
 */
async function insertRequirement(client, data = {}) {
  const dbClient = client || pool;
  const sourceType = sourceTypeOf(data);

  const sql = `
    INSERT INTO core.requirements (
      title,
      company_name,
      source_email,
      source_url,
      message_id,
      source_type,
      source_name,
      relay_thread_id,
      vendor_id,
      location,
      min_experience,
      max_experience,
      visa_requirement,
      employment_type,
      remote_policy,
      status,
      origin,
      score_threshold,
      uploaded_at,
      created_by,
      org_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, 'astra', 50, now(), $17, $18
    )
    RETURNING
      id,
      title,
      company_name,
      source_email,
      source_url,
      message_id,
      source_type,
      relay_thread_id,
      vendor_id,
      status,
      uploaded_at,
      created_by,
      org_id;
  `;

  const values = [
    data.title || null,
    data.companyName || null,
    data.sourceEmail || null,
    data.sourceUrl || null,
    data.messageId || null,
    sourceType,
    data.sourceName || data.source_name || null,
    data.relayThreadId || data.relay_thread_id || null,
    data.vendorId || null,
    data.location || null,
    data.minExperience != null ? Number(data.minExperience) : null,
    data.maxExperience != null ? Number(data.maxExperience) : null,
    data.visaRequirement || null,
    sanitizeEmploymentType(data.employmentType),
    data.remotePolicy || null,
    data.status || "Active",
    data.createdBy || null,
    // The organisation, when the caller knows it — a workflow does (its
    // run's), a session does. NULL lets the trigger derive it from
    // created_by; with neither, the database refuses the row (V.28), which
    // is what an orchestrated ingest hit on 2026-09-21 before this existed.
    data.orgId || data.org_id || data.organizationId || null,
  ];

  const { rows } = await dbClient.query(sql, values);
  const job = rows[0];

  // The document: a file if there is one, otherwise the body. The content
  // hash lives here too — it is a property of the document, not the requirement.
  await addSourceFile(dbClient, {
    subjectType: "requirement",
    subjectId: job.id,
    originalFileName: data.originalFileName || null,
    filePath: data.filePath || null,
    mimeType: data.mimeType || null,
    rawText: data.rawText || null,
    hash: data.summaryHash || null,
  });

  return job;
}

/**
 * Look up a requirement by its Message-ID (email deduplication).
 * With createdBy, scoped to that recruiter — or to unowned legacy rows.
 */
async function findRequirementByMessageId(messageId, createdBy = null) {
  if (!messageId || !messageId.trim()) return null;
  const params = [messageId.trim()];
  let extraWhere = "";
  if (createdBy) {
    params.push(createdBy);
    extraWhere = " AND q.created_by = $2";
  }
  const sql = `
    SELECT q.id, q.title, q.source_email, q.message_id, q.relay_thread_id,
           f.content_hash AS summary_hash, q.status, q.uploaded_at, q.created_by
      FROM core.requirements q
      LEFT JOIN core.source_files f
        ON f.subject_type = 'requirement' AND f.subject_id = q.id
     WHERE q.message_id = $1${extraWhere}
     ORDER BY (q.created_by IS NOT NULL) DESC, q.uploaded_at DESC
     LIMIT 1;
  `;
  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

/**
 * Look up a requirement by its content hash (content deduplication).
 * With createdBy, scoped to that recruiter — or to unowned legacy rows.
 */
async function findRequirementBySummaryHash(summaryHash, createdBy = null) {
  if (!summaryHash || !summaryHash.trim()) return null;
  const params = [summaryHash.trim()];
  let extraWhere = "";
  if (createdBy) {
    params.push(createdBy);
    extraWhere = " AND q.created_by = $2";
  }
  const sql = `
    SELECT q.id, q.title, q.source_email, q.message_id, q.relay_thread_id,
           f.content_hash AS summary_hash, q.status, q.uploaded_at, q.created_by
      FROM core.source_files f
      JOIN core.requirements q
        ON q.id = f.subject_id AND f.subject_type = 'requirement'
     WHERE f.content_hash = $1${extraWhere}
     ORDER BY (q.created_by IS NOT NULL) DESC, q.uploaded_at DESC
     LIMIT 1;
  `;
  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

/**
 * Fetch requirement by ID, in the shape ASTRA's enrichment reads
 * (raw_text, summary_hash and processing_* come from the CORE_REQUIREMENTS view).
 */
async function getRequirementById(id, userId = null) {
  const params = [id];
  let extraWhere = "";
  if (userId) {
    params.push(userId);
    extraWhere = " AND created_by = $2";
  }

  const sql = `
    SELECT id, org_id, title, company_name, original_file_name, file_path, mime_type,
           raw_text, jd_summary, required_skills, primary_role, summary_hash,
           source_email, source_url, message_id, source_type, relay_thread_id, vendor_id,
           score_threshold, status, processing_status,
           location, min_experience, max_experience, visa_requirement,
           employment_type, remote_policy, uploaded_at, processed_at,
           created_by, created_at, updated_at
      FROM ${CORE_REQUIREMENTS}
     WHERE id = $1${extraWhere};
  `;
  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

/**
 * The vendor whose email or website domain matches the sender's, among the
 * recruiter's vendors. core.vendors is shared business data; reading it is
 * not reaching into PRISM.
 */
async function findVendorIdForSender(createdBy, senderEmail) {
  if (!createdBy || !senderEmail) return null;
  const m = String(senderEmail).match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (!m) return null;
  const domain = m[1].toLowerCase().trim();
  const { rows } = await pool.query(
    `SELECT id
       FROM core.vendors
      WHERE created_by = $1
        AND (
          lower(split_part(coalesce(email, ''), '@', 2)) = $2
          OR regexp_replace(lower(coalesce(website, '')), '^(https?://)?(www\\.)?([^/]+).*$', '\\3') = $2
        )
      ORDER BY created_at
      LIMIT 1`,
    [createdBy, domain],
  );
  return rows[0]?.id || null;
}

// ─────────────────────────────────────────────── processing state ──

async function markProcessing(jobId) {
  await setProcessing(pool, {
    subjectType: "requirement", subjectId: jobId, application: "astra",
    status: "running", startedAt: new Date(), error: null,
  });
}

async function markFailed(jobId, error) {
  await setProcessing(pool, {
    subjectType: "requirement", subjectId: jobId, application: "astra",
    status: "failed", failedAt: new Date(), error: String(error).slice(0, 2000),
  });
}

/**
 * Writes what enrichment found onto the requirement and closes the
 * processing attempt as succeeded — both on the caller's transaction, so a
 * requirement is never enriched-but-pending or processed-but-empty.
 */
async function updateEnrichedRequirement(jobId, enrichedData = {}, client = null) {
  const dbClient = client || pool;

  const sql = `
    UPDATE core.requirements
       SET title = COALESCE($2, title),
           company_name = COALESCE($3, company_name),
           location = COALESCE($4, location),
           min_experience = $5,
           max_experience = $6,
           visa_requirement = COALESCE($7, visa_requirement),
           employment_type = COALESCE($8, employment_type),
           remote_policy = COALESCE($9, remote_policy),
           required_skills = $10::jsonb,
           primary_role = $11,
           summary = $12,
           mandatory_skills = $13::jsonb,
           preferred_skills = $14::jsonb
     WHERE id = $1
     RETURNING *;
  `;

  const values = [
    jobId,
    enrichedData.title || null,
    enrichedData.companyName || null,
    enrichedData.location || null,
    enrichedData.minExperience != null ? Number(enrichedData.minExperience) : null,
    enrichedData.maxExperience != null ? Number(enrichedData.maxExperience) : null,
    enrichedData.visaRequirement || null,
    sanitizeEmploymentType(enrichedData.employmentType),
    enrichedData.remotePolicy || null,
    JSON.stringify(enrichedData.requiredSkills || []),
    enrichedData.primaryRole || "other",
    enrichedData.jdSummary || "",
    // Extracted since the prompt asked for them; the columns have been on
    // core.requirements all along (0 of 3,860 rows had either on 2026-09-20).
    JSON.stringify(enrichedData.parsedData?.mandatorySkills || []),
    JSON.stringify(enrichedData.parsedData?.preferredSkills || []),
  ];

  const { rows } = await dbClient.query(sql, values);

  await setProcessing(dbClient, {
    subjectType: "requirement", subjectId: jobId, application: "astra",
    status: "succeeded", finishedAt: new Date(), error: null,
  });

  return rows[0] || null;
}

module.exports = {
  insertRequirement,
  findRequirementByMessageId,
  findRequirementBySummaryHash,
  getRequirementById,
  findVendorIdForSender,
  markProcessing,
  markFailed,
  updateEnrichedRequirement,
};
