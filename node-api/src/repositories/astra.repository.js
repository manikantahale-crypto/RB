const { pool } = require("../config/db");
const { CORE_REQUIREMENTS } = require("./core-views");

const ALLOWED_EMPLOYMENT_TYPES = new Set(["W2", "C2C", "1099"]);

function sanitizeEmploymentType(type) {
  if (!type || typeof type !== "string") return null;
  const upper = type.trim().toUpperCase();
  return ALLOWED_EMPLOYMENT_TYPES.has(upper) ? upper : null;
}

/**
 * Inserts an ASTRA-ingested requirement into core.requirements.
 * Uses client for transactional execution.
 *
 * Initial lifecycle defaults:
 * - status: 'Active' (unless explicitly provided)
 * - processing_status: 'uploaded'
 * - processed_at: NULL
 * - processing_started_at: NULL
 * - processing_failed_at: NULL
 * - processing_error: NULL
 * - score_threshold: 50
 * - uploaded_at: now()
 */
async function insertRequirement(client, data = {}) {
  const dbClient = client || pool;

  const sql = `
    INSERT INTO core.requirements (
      title,
      company_name,
      -- The document itself becomes a source_files row below; only how the
      -- requirement ARRIVED belongs on the requirement.
      source_email,
      source_url,
      message_id,
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
      created_by
    ) VALUES (
      $1, $2, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $17, 'astra', 50, now(), $19
    )
    RETURNING
      id,
      title,
      company_name,
      source_email,
      source_url,
      message_id,
      status,
      uploaded_at,
      created_by;
  `;

  const values = [
    data.title || null,
    data.companyName || null,
    data.originalFileName || null,
    data.filePath || null,
    data.mimeType || null,
    data.rawText || "",
    data.sourceEmail || null,
    data.sourceUrl || null,
    data.messageId || null,
    data.location || null,
    data.minExperience != null ? Number(data.minExperience) : null,
    data.maxExperience != null ? Number(data.maxExperience) : null,
    data.visaRequirement || null,
    sanitizeEmploymentType(data.employmentType),
    data.remotePolicy || null,
    data.summaryHash || null,
    data.status || "Active",
    data.processingStatus || "uploaded",
    data.createdBy || null,
  ];

  const { rows } = await dbClient.query(sql, values);
  return rows[0];
}

/**
 * Look up a requirement by its Message-ID (for email deduplication check).
 */
async function findRequirementByMessageId(messageId) {
  if (!messageId || !messageId.trim()) return null;
  const sql = `
    SELECT q.id, q.title, q.source_email, q.message_id,
           f.content_hash AS summary_hash, q.status, q.uploaded_at, q.created_by
      FROM core.requirements q
      LEFT JOIN core.source_files f
        ON f.subject_type = 'requirement' AND f.subject_id = q.id
     WHERE q.message_id = $1
     LIMIT 1;
  `;
  const { rows } = await pool.query(sql, [messageId.trim()]);
  return rows[0] || null;
}

/**
 * Look up a requirement by its content SHA-256 summary hash (for content deduplication check).
 */
async function findRequirementBySummaryHash(summaryHash) {
  if (!summaryHash || !summaryHash.trim()) return null;
  const sql = `
    SELECT q.id, q.title, q.source_email, q.message_id,
           f.content_hash AS summary_hash, q.status, q.uploaded_at, q.created_by
      FROM core.source_files f
      JOIN core.requirements q
        ON q.id = f.subject_id AND f.subject_type = 'requirement'
     WHERE f.content_hash = $1
     LIMIT 1;
  `;
  const { rows } = await pool.query(sql, [summaryHash.trim()]);
  return rows[0] || null;
}

/**
 * Fetch requirement by ID.
 */
async function getRequirementById(id, userId = null) {
  const params = [id];
  let extraWhere = "";
  if (userId) {
    params.push(userId);
    extraWhere = " AND created_by = $2";
  }

  const sql = `
    SELECT id, title, company_name, original_file_name, file_path, mime_type,
           raw_text, jd_summary, required_skills, primary_role, summary_hash,
           source_email, source_url, message_id, score_threshold, status,
           processing_status,
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
 * Updates a requirement record with enriched ASTRA intelligence attributes.
 * Preserves the original intake summary_hash fingerprint.
 *
 * @param {string} jobId
 * @param {Object} enrichedData
 * @param {Object} [client] Optional pg client for transactional context
 * @returns {Promise<Object>} Updated job row
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
           processing_failed_at = NULL,
           processing_error = NULL
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
  ];

  const { rows } = await dbClient.query(sql, values);
  return rows[0] || null;
}

module.exports = {
  insertRequirement,
  findRequirementByMessageId,
  findRequirementBySummaryHash,
  getRequirementById,
  updateEnrichedRequirement,
};
