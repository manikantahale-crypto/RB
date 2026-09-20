/**
 * Re-parse the resumes whose profile was written when the AI was unavailable.
 *
 *   node node-api/scripts/reparse-resumes.js --dry-run
 *   node node-api/scripts/reparse-resumes.js [--limit 10] [--ids <uuid,uuid>] [--all-short]
 *
 * WHY. 8 current resumes carry the profile "Basic profile extracted from
 * resume text for <name> (AI parsing unavailable)" — written by old code when
 * the LLM failed (the same 402 era), with no summary the matcher can read.
 * The first matching proof scored one of them 0: "insufficient information
 * to assess skills" (ref/SYNTRA_Matching_Study.md §8). The skills are there;
 * the summary is not.
 *
 * WHAT IT DOES. Runs the current resume pipeline for each one — the same
 * handler the upload path runs: parse through the provider chain, embed,
 * save, publish `profile.prepared`, run the matching funnel. That last part
 * is the product working, not a side effect: a re-parsed resume SHOULD be
 * matched again. It also overwrites the person's name, email and phone with
 * what the parse reads, as every parse does (the August report's 2.6 asked
 * whether that is intended; for these eight, the current values came from
 * the failed parse, so there is nothing to lose).
 *
 * Selection: current resumes whose profile says "AI parsing unavailable",
 * with source text to read — 8 on 2026-09-20. --ids picks explicitly.
 * --all-short widens it to every current resume with a summary under 100
 * characters: 216 on 2026-09-20, most of them test fixtures ("T7NoStop
 * Candidate", "Jane Doe") that were never parsed at all — each one costs a
 * parse, an embedding and a matching run, so it is opt-in. Costs one chat
 * completion and one embedding per row.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const { pool } = require("../src/config/db");
const { handleResumeUploaded } = require("../src/modules/syntra/workers/resumeUploaded.worker");
const log = require("../src/utils/logger");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = Number(args[args.indexOf("--limit") + 1]) || 0;
const IDS = args.includes("--ids") ? args[args.indexOf("--ids") + 1].split(",").map((s) => s.trim()).filter(Boolean) : null;
const ALL_SHORT = args.includes("--all-short");

async function candidates() {
  const { rows } = await pool.query(
    `SELECT r.id, r.person_id, p.full_name, length(r.summary) AS summary_len, left(r.profile_summary, 60) AS profile
       FROM core.resumes r
       JOIN core.people p ON p.id = r.person_id
      WHERE r.is_current = true
        AND EXISTS (SELECT 1 FROM core.source_files s
                     WHERE s.subject_type = 'resume' AND s.subject_id = r.id
                       AND (s.raw_text IS NOT NULL OR s.file_path IS NOT NULL))
        AND (
          $1::uuid[] IS NOT NULL AND r.id = ANY($1::uuid[])
          OR $1::uuid[] IS NULL AND (
               r.profile_summary LIKE '%AI parsing unavailable%'
            OR ($2::boolean AND (r.summary IS NULL OR length(r.summary) < 100))
          )
        )
      ORDER BY r.updated_at ASC
      ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ""}`,
    [IDS, ALL_SHORT],
  );
  return rows;
}

(async () => {
  const rows = await candidates();
  log.info(`[REPARSE] ${rows.length} resume(s) to re-parse${LIMIT ? ` (limit ${LIMIT})` : ""}${DRY ? " — DRY RUN" : ""}`);
  for (const r of rows) {
    log.info(`[REPARSE] ${DRY ? "would re-parse" : "queued"} ${r.id}  ${r.full_name}  summary=${r.summary_len ?? 0} chars  profile="${r.profile ?? ""}"`);
  }
  if (DRY) {
    await pool.end();
    return;
  }

  let done = 0;
  const failed = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      log.info(`[REPARSE] [${i + 1}/${rows.length}] ${r.id} ${r.full_name}`);
      await handleResumeUploaded({ data: { resumeId: r.id, candidateId: r.person_id } });
      done += 1;
    } catch (err) {
      failed.push(r.id);
      log.error(`[REPARSE] [${i + 1}/${rows.length}] ${r.id} failed: ${err.message}`);
    }
  }
  console.table({ total: rows.length, done, failed: failed.length });
  if (failed.length) log.warn(`[REPARSE] failed (run again later): ${failed.join(" ")}`);
  await pool.end();
})().catch(async (err) => {
  log.error(`[REPARSE] ${err.message}`);
  await pool.end().catch(() => {});
  process.exit(1);
});
