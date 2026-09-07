const { pool } = require("../../config/db");

/**
 * Checks if a resume with the exact same raw_text already exists for the given user.
 * Returns an object indicating if it's a duplicate and the existing IDs if so.
 * 
 * @param {string} rawText - The extracted text of the newly uploaded resume.
 * @param {string} userId - The ID of the authenticated user.
 * @returns {Promise<{ isDuplicate: boolean, existingResumeId?: string, existingCandidateId?: string }>}
 */
async function checkDuplicateResume(rawText, userId) {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim() || !userId) {
    return { isDuplicate: false };
  }

  // We query directly by raw_text, scoped to the current user's candidates.
  // PostgreSQL is highly optimized to check text equality, even for large texts.
  const { rows } = await pool.query(
    `SELECT r.id, r.candidate_id, c.status AS candidate_status, r.processing_status 
     FROM syntra.resumes r
     JOIN syntra.candidates c ON r.candidate_id = c.id
     WHERE r.raw_text = $1 AND c.created_by = $2
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [rawText, userId]
  );

  if (rows.length > 0) {
    return {
      isDuplicate: true,
      existingResumeId: rows[0].id,
      existingCandidateId: rows[0].candidate_id,
      candidateStatus: rows[0].candidate_status,
      processingStatus: rows[0].processing_status
    };
  }

  return { isDuplicate: false };
}

module.exports = {
  checkDuplicateResume
};
