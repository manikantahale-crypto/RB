/**
 * Writing to `core`, where one old UPDATE becomes two or three.
 *
 * `syntra.jobs` was a wide table: the requirement itself, plus its file, its
 * embedding and its processing state, all in one row. A single statement could
 * set a summary, a content hash, a vector and a status together.
 *
 * `core` separates them, which is the point — an embedding is versioned by
 * model, processing keeps its history instead of overwriting a column, and the
 * requirement is just the requirement. The cost is that the old statement no
 * longer maps to one table.
 *
 * These helpers are that mapping, in one place. Without them the routing would
 * be repeated across five repositories, and the third time somebody added a
 * column they would put it in the wrong one.
 *
 * Every helper takes an existing client so it joins the caller's transaction.
 * A summary and its processing status must land together or not at all.
 */

/**
 * Record what happened to a processing attempt.
 *
 * One row per subject and stage, updated in place — the source only ever kept
 * the latest state, so there is one attempt to record. When the application
 * starts recording attempts properly it writes its own rows with a higher
 * `attempt` and nothing here stands in the way.
 *
 * `finishedAt` means finished SUCCESSFULLY. A failure sets `failedAt` and
 * leaves the finish empty, which is what makes "ready to match" the same
 * question in core as it was in syntra: did this finish?
 */
async function setProcessing(
  client,
  { subjectType, subjectId, stage = "extract", status, startedAt, finishedAt, failedAt, error },
) {
  await client.query(
    `INSERT INTO core.processing_jobs (
       org_id, application, subject_type, subject_id, stage, status, attempt,
       started_at, finished_at, failed_at, error, created_at)
     SELECT e.org_id, 'syntra', $1, $2, $3, $4, 1, $5, $6, $7, $8, now()
       FROM (
         SELECT org_id FROM core.requirements WHERE id = $2 AND $1 = 'requirement'
         UNION ALL
         SELECT org_id FROM core.resumes      WHERE id = $2 AND $1 = 'resume'
         UNION ALL
         SELECT org_id FROM core.matches      WHERE id = $2 AND $1 = 'match'
       ) e
     ON CONFLICT (subject_type, subject_id, stage, attempt) DO UPDATE SET
       status      = coalesce(EXCLUDED.status, core.processing_jobs.status),
       started_at  = coalesce(EXCLUDED.started_at, core.processing_jobs.started_at),
       finished_at = CASE WHEN $6::timestamptz IS NOT NULL THEN EXCLUDED.finished_at
                          ELSE core.processing_jobs.finished_at END,
       failed_at   = CASE WHEN $7::timestamptz IS NOT NULL THEN EXCLUDED.failed_at
                          ELSE core.processing_jobs.failed_at END,
       error       = EXCLUDED.error`,
    [subjectType, subjectId, stage, status ?? null, startedAt ?? null,
     finishedAt ?? null, failedAt ?? null, error ?? null],
  );
}

/**
 * Store a vector against its model.
 *
 * Versioned by (model, model_version), so re-embedding with a new model ADDS a
 * row rather than destroying the previous vector — which is what the old
 * single `embedding` column did on every re-parse.
 */
async function setEmbedding(
  client,
  { subjectType, subjectId, embedding, model, modelVersion },
) {
  if (!embedding) return;
  await client.query(
    `INSERT INTO core.embeddings (
       org_id, subject_type, subject_id, model, model_version, embedding, created_at)
     SELECT e.org_id, $1, $2, $3, $4, $5::vector, now()
       FROM (
         SELECT org_id FROM core.requirements WHERE id = $2 AND $1 = 'requirement'
         UNION ALL
         SELECT org_id FROM core.resumes      WHERE id = $2 AND $1 = 'resume'
       ) e
     ON CONFLICT (subject_type, subject_id, model, model_version)
     DO UPDATE SET embedding = EXCLUDED.embedding`,
    [subjectType, subjectId, model ?? "unknown", modelVersion ?? "1", embedding],
  );
}

/**
 * The hash of the document this subject was parsed from.
 *
 * Only updates a file row that exists. A requirement that arrived as email has
 * no file — 2,690 of 2,946 of them — and inventing one to hold a hash would
 * put a row in source_files describing a file that never existed.
 */
async function setContentHash(client, { subjectType, subjectId, hash }) {
  if (!hash) return;
  await client.query(
    `UPDATE core.source_files
        SET content_hash = $3
      WHERE subject_type = $1 AND subject_id = $2`,
    [subjectType, subjectId, hash],
  );
}

/**
 * Create the file row for a subject, if there is a file.
 *
 * Mirrors app.mirror_source_file: no path, no row.
 */
async function addSourceFile(
  client,
  { subjectType, subjectId, originalFileName, filePath, mimeType, rawText, hash },
) {
  if (!filePath) return;
  await client.query(
    `INSERT INTO core.source_files (
       org_id, subject_type, subject_id, original_file_name, file_path,
       mime_type, raw_text, content_hash, uploaded_at)
     SELECT e.org_id, $1, $2, $3, $4, $5, $6, $7, now()
       FROM (
         SELECT org_id FROM core.requirements WHERE id = $2 AND $1 = 'requirement'
         UNION ALL
         SELECT org_id FROM core.resumes      WHERE id = $2 AND $1 = 'resume'
       ) e
      WHERE NOT EXISTS (
        SELECT 1 FROM core.source_files f
         WHERE f.subject_type = $1 AND f.subject_id = $2)`,
    [subjectType, subjectId, originalFileName ?? null, filePath,
     mimeType ?? null, rawText ?? null, hash ?? null],
  );
}

module.exports = {
  setProcessing,
  setEmbedding,
  setContentHash,
  addSourceFile,
};
