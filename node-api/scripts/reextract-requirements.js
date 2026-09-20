/**
 * Re-extract the requirements that were recorded as processed with no skills.
 *
 *   node node-api/scripts/reextract-requirements.js --dry-run
 *   node node-api/scripts/reextract-requirements.js [--limit 100] [--org <uuid>]
 *
 * WHY. 2,818 of 3,415 processed requirements had no required_skills on
 * 2026-09-20. They are not requirements without skills: their AI extraction
 * failed (OpenRouter 402, mostly) and ASTRA's enrichment "proceeded with
 * deterministic normalization" — a template summary, primary_role "other",
 * required_skills [] — and marked the extract stage SUCCEEDED. Tier 2 of
 * matching then scored every candidate 0 against them
 * (ref/SYNTRA_Matching_Study.md §2). That path now fails honestly instead
 * (astraIntelligence.service.js); this goes back for the rows it left.
 *
 * WHAT IT DOES, per requirement: reads the body from core.source_files
 * (raw_text — 3,362 email bodies restored by V20260909.70), runs the same
 * enrichment the worker runs, and writes the same columns the worker writes
 * (title, company, location, experience, visa, employment, remote,
 * required / mandatory / preferred skills, primary_role, summary) — in one
 * transaction per row. No platform event is emitted: these requirements
 * already went through their workflow; this repairs their record.
 *
 * WHAT IT DOES NOT DO. Touch a requirement that has skills, or one with no
 * body to read. Change processing status: it was "succeeded" and stays so,
 * with the fields it should have had. Retry a row whose extraction fails
 * again — it is listed at the end for a second pass.
 *
 * Costs one chat completion per row through the provider chain. Pauses
 * 120 ms between rows. --dry-run counts and lists, and stops.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const { pool, withTransaction } = require("../src/config/db");
const astraIntelligence = require("../src/modules/astra/services/astraIntelligence.service");
const astraRepo = require("../src/modules/astra/repositories/astra.repository");
const log = require("../src/utils/logger");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = Number(args[args.indexOf("--limit") + 1]) || 0;
const ORG = args.includes("--org") ? args[args.indexOf("--org") + 1] : null;

async function candidates() {
  const { rows } = await pool.query(
    `SELECT q.id, q.org_id, q.title, q.company_name, q.location, q.visa_requirement,
            q.employment_type, q.remote_policy, q.min_experience, q.max_experience,
            q.primary_role, q.required_skills,
            f.raw_text
       FROM core.requirements q
       JOIN LATERAL (
         SELECT s.raw_text FROM core.source_files s
          WHERE s.subject_type = 'requirement' AND s.subject_id = q.id
            AND s.raw_text IS NOT NULL AND length(s.raw_text) > 40
          ORDER BY s.uploaded_at DESC NULLS LAST LIMIT 1
       ) f ON true
      WHERE (q.required_skills IS NULL OR jsonb_array_length(q.required_skills) = 0)
        AND EXISTS (SELECT 1 FROM core.processing_jobs p
                     WHERE p.subject_type = 'requirement' AND p.subject_id = q.id
                       AND p.stage = 'extract' AND p.finished_at IS NOT NULL)
        AND ($1::uuid IS NULL OR q.org_id = $1::uuid)
      ORDER BY q.created_at DESC
      ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ""}`,
    [ORG],
  );
  return rows;
}

(async () => {
  const rows = await candidates();
  log.info(
    `[REEXTRACT] ${rows.length} processed requirement(s) with no skills and a body to read` +
      `${LIMIT ? ` (limit ${LIMIT})` : ""}${ORG ? ` in org ${ORG}` : ""}${DRY ? " — DRY RUN" : ""}`,
  );
  if (DRY) {
    for (const r of rows.slice(0, 10)) {
      log.info(`[REEXTRACT] would re-extract ${r.id}  "${String(r.title).slice(0, 50)}"  (${r.raw_text.length} chars)`);
    }
    if (rows.length > 10) log.info(`[REEXTRACT] … and ${rows.length - 10} more`);
    await pool.end();
    return;
  }

  let done = 0;
  const failed = [];
  const stillNoSkills = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const enriched = await astraIntelligence.enrichRequirement({
        ...r,
        raw_text: r.raw_text,
        // The stored title is what the failed pass left; let the AI's win.
        title: r.title === "Untitled Role" ? "" : r.title,
      });
      const skills = enriched.requiredSkills || [];
      await withTransaction((client) => astraRepo.updateEnrichedRequirement(r.id, enriched, client));
      done += 1;
      if (skills.length === 0) stillNoSkills.push(r.id);
      log.info(
        `[REEXTRACT] [${i + 1}/${rows.length}] ${r.id}  skills=${skills.length}  role=${enriched.primaryRole}  "${String(enriched.title).slice(0, 40)}"`,
      );
      await new Promise((res) => setTimeout(res, 120));
    } catch (err) {
      failed.push(r.id);
      log.error(`[REEXTRACT] [${i + 1}/${rows.length}] ${r.id} failed: ${err.message}`);
    }
  }

  console.table({ total: rows.length, done, still_no_skills: stillNoSkills.length, failed: failed.length });
  if (failed.length) log.warn(`[REEXTRACT] failed (run again later): ${failed.join(" ")}`);
  if (stillNoSkills.length) log.warn(`[REEXTRACT] extracted but the text names no skills: ${stillNoSkills.slice(0, 20).join(" ")}${stillNoSkills.length > 20 ? " …" : ""}`);
  await pool.end();
})().catch((err) => {
  log.error(`[REEXTRACT] ${err.message}`);
  process.exit(1);
});
