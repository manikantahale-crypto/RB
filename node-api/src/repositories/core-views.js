/**
 * `core` tables presented under the column names this codebase already uses.
 *
 * WHY THESE EXIST
 *
 * The business entities moved from `syntra` to `core`. Several columns were
 * renamed on the way — requirement_id, person_id, status — and three groups
 * moved out into tables of their own: file metadata, embeddings, and
 * processing state.
 *
 * Rewriting every column reference across five repositories would have been a
 * few hundred edits, each an opportunity to get one wrong, with no way to tell
 * from the diff. Reading from a subquery that renames the columns back keeps
 * every change to the FROM clause, and leaves every caller's response shape
 * untouched.
 *
 * READS ONLY. Writes still go to `syntra`, because core.matches has composite
 * foreign keys to requirements, people and resumes — a match written to core
 * whose job went to syntra fails the key, so the writes have to move as one
 * cluster later. The mirror triggers (V20260909.15 to .18) carry every syntra
 * write into core in the same transaction, so these reads are never behind.
 *
 * Processing state (processed_at, processing_status, processing_started_at,
 * processing_failed_at, processing_error) is reassembled from
 * core.processing_jobs. `processing_status` is translated BACK to the source's
 * vocabulary — processed/failed/processing/uploaded — because that is what the
 * callers and the screens already expect.
 *
 * File metadata (file_path, original_file_name, mime_type, raw_text,
 * summary_hash, uploaded_at) comes from core.source_files, which the mirror
 * keeps current as of V20260909.20. Before that it was a one-off snapshot, so
 * anything uploaded since had no file row and these columns read as null.
 *
 * THIS IS SCAFFOLDING. When the writes move and `syntra` retires, these become
 * plain table names and the aliases go away.
 */

/**
 * core.matches. Three renames, plus two the copy introduced.
 *
 * Not carried, because core does not have them: policy_id (never populated),
 * retry_count, matching_error, matching_started_at, matching_failed_at. Those
 * are processing state and live in core.processing_jobs. Nothing reads them —
 * only ai.repository writes them, and its writes stay on syntra.
 */
const CORE_MATCHES = `(SELECT *,
         requirement_id AS job_id,
         person_id      AS candidate_id,
         status         AS match_status,
         requested_at   AS match_requested_at,
         scored_by      AS score_source
    FROM core.matches)`;

/** core.people — was syntra.candidates. Same columns, new home. */
const CORE_PEOPLE = "core.people";

/**
 * core.requirements — was syntra.jobs.
 *
 * `processed_at` is the readiness gate every matching query uses. It is no
 * longer a column: it is whether the extract stage finished, which is what
 * `finished_at` records. `embedding` moved to core.embeddings, versioned by
 * model, so the most recent is taken.
 */
const CORE_REQUIREMENTS = `(SELECT q.*,
         q.summary AS jd_summary,
         pj.finished_at AS processed_at,
         pj.failed_at   AS processing_failed_at,
         pj.started_at  AS processing_started_at,
         pj.error       AS processing_error,
         CASE pj.status
           WHEN 'succeeded' THEN 'processed'
           WHEN 'failed'    THEN 'failed'
           WHEN 'running'   THEN 'processing'
           ELSE 'uploaded'
         END AS processing_status,
         e.embedding,
         sf.original_file_name, sf.file_path, sf.mime_type, sf.raw_text,
         sf.content_hash AS summary_hash
    FROM core.requirements q
    LEFT JOIN LATERAL (
      SELECT p.finished_at, p.failed_at, p.started_at, p.error, p.status
        FROM core.processing_jobs p
       WHERE p.subject_type = 'requirement' AND p.subject_id = q.id
         AND p.stage = 'extract'
       ORDER BY p.attempt DESC LIMIT 1
    ) pj ON true
    LEFT JOIN LATERAL (
      SELECT x.embedding FROM core.embeddings x
       WHERE x.subject_type = 'requirement' AND x.subject_id = q.id
       ORDER BY x.created_at DESC LIMIT 1
    ) e ON true
    LEFT JOIN LATERAL (
      SELECT f.original_file_name, f.file_path, f.mime_type, f.raw_text,
             f.content_hash
        FROM core.source_files f
       WHERE f.subject_type = 'requirement' AND f.subject_id = q.id
       ORDER BY f.uploaded_at DESC LIMIT 1
    ) sf ON true)`;

/** core.resumes — was syntra.resumes. The same three groups moved out. */
const CORE_RESUMES = `(SELECT r.*,
         r.person_id AS candidate_id,
         r.summary AS resume_summary,
         r.current_role_title AS current_role,
         pj.finished_at AS processed_at,
         pj.failed_at   AS processing_failed_at,
         pj.started_at  AS processing_started_at,
         pj.error       AS processing_error,
         CASE pj.status
           WHEN 'succeeded' THEN 'processed'
           WHEN 'failed'    THEN 'failed'
           WHEN 'running'   THEN 'processing'
           ELSE 'uploaded'
         END AS processing_status,
         e.embedding,
         sf.original_file_name, sf.file_path, sf.mime_type, sf.raw_text,
         sf.content_hash AS summary_hash
    FROM core.resumes r
    LEFT JOIN LATERAL (
      SELECT p.finished_at, p.failed_at, p.started_at, p.error, p.status
        FROM core.processing_jobs p
       WHERE p.subject_type = 'resume' AND p.subject_id = r.id
         AND p.stage = 'extract'
       ORDER BY p.attempt DESC LIMIT 1
    ) pj ON true
    LEFT JOIN LATERAL (
      SELECT x.embedding FROM core.embeddings x
       WHERE x.subject_type = 'resume' AND x.subject_id = r.id
       ORDER BY x.created_at DESC LIMIT 1
    ) e ON true
    LEFT JOIN LATERAL (
      SELECT f.original_file_name, f.file_path, f.mime_type, f.raw_text,
             f.content_hash
        FROM core.source_files f
       WHERE f.subject_type = 'resume' AND f.subject_id = r.id
       ORDER BY f.uploaded_at DESC LIMIT 1
    ) sf ON true)`;

module.exports = {
  CORE_MATCHES,
  CORE_PEOPLE,
  CORE_REQUIREMENTS,
  CORE_RESUMES,
};
