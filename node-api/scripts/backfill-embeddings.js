/**
 * Give every processed resume and requirement an embedding.
 *
 *   node node-api/scripts/backfill-embeddings.js --dry-run
 *   node node-api/scripts/backfill-embeddings.js [--limit 50] [--only resumes|requirements]
 *
 * WHY. Tier 1 of matching finds candidates by vector; a resume with no
 * embedding never enters the pool, whatever its skills say. On 2026-09-20,
 * 69 current resumes had skills and no embedding (ref/SYNTRA_Matching_Study.md
 * §2). Tier 1 now also unions the SQL pool so they are reachable, but the
 * vector neighbourhood is the better first cut, and this fills it.
 *
 * Ported from the deployed branch's scripts/backfill-embeddings.js on
 * 2026-09-20 and repointed at core: the embedding text is the same
 * (role + skills + experience + summary for a resume; title + summary +
 * skills for a requirement), the write goes through core-writes.setEmbedding
 * so it lands in core.embeddings versioned by model, like every other vector.
 *
 * Reads the embedding provider from config/aiConfig.js getEmbeddingConfig —
 * OpenAI or OpenRouter; never Gemini or Groq, which do not serve
 * text-embedding-3-small. Every vector in the table is that model at 1536
 * dims and the query compares by cosine, so a different model here would
 * silently rank against incomparable vectors.
 *
 * Costs API calls: one per row. Pauses 80 ms between rows. Prints nothing
 * secret. --dry-run lists what it would embed and stops.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const { pool, withTransaction } = require("../src/config/db");
const { generateEmbedding } = require("../src/ai/embedding");
const { setEmbedding } = require("../src/repositories/core-writes");
const { getEmbeddingConfig } = require("../src/config/aiConfig");
const log = require("../src/utils/logger");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = Number(args[args.indexOf("--limit") + 1]) || 0;
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

function skillsOf(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function missing(subjectType) {
  const table = subjectType === "resume" ? "core.resumes" : "core.requirements";
  const cols =
    subjectType === "resume"
      ? "r.id, r.primary_role, r.skills, r.summary, r.profile_summary, r.total_experience, r.years_experience"
      : "r.id, r.title, r.required_skills, r.summary";
  const { rows } = await pool.query(
    `SELECT ${cols}
       FROM ${table} r
      WHERE ${subjectType === "resume" ? "r.is_current = true AND " : ""}
            EXISTS (SELECT 1 FROM core.processing_jobs p
                     WHERE p.subject_type = $1 AND p.subject_id = r.id
                       AND p.stage = 'extract' AND p.finished_at IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM core.embeddings e
                         WHERE e.subject_type = $1 AND e.subject_id = r.id)
      ORDER BY r.id
      ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ""}`,
    [subjectType],
  );
  return rows;
}

function textOf(subjectType, row) {
  if (subjectType === "resume") {
    const skills = skillsOf(row.skills);
    const summary = row.summary || row.profile_summary || "";
    const exp = row.total_experience ?? row.years_experience ?? "";
    return `${row.primary_role || ""} ${skills.join(" ")} ${exp} ${summary}`.trim();
  }
  const skills = skillsOf(row.required_skills);
  return `${row.title || ""} ${row.summary || ""} ${skills.join(" ")}`.trim();
}

async function backfill(subjectType) {
  const rows = await missing(subjectType);
  log.info(`[BACKFILL] ${subjectType}: ${rows.length} processed row(s) without an embedding${LIMIT ? ` (limit ${LIMIT})` : ""}`);
  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const text = textOf(subjectType, row);
    if (!text) {
      skipped += 1;
      log.warn(`[BACKFILL] ${subjectType} ${row.id}: nothing to embed (no role, skills or summary)`);
      continue;
    }
    if (DRY) {
      log.info(`[BACKFILL] would embed ${subjectType} ${row.id} (${text.length} chars)`);
      continue;
    }
    try {
      log.info(`[BACKFILL] [${i + 1}/${rows.length}] ${subjectType} ${row.id}`);
      const res = await generateEmbedding(text);
      await withTransaction((client) =>
        setEmbedding(client, {
          subjectType,
          subjectId: row.id,
          embedding: `[${res.embedding.join(",")}]`,
          model: res.model,
          modelVersion: String(res.version ?? "1"),
        }),
      );
      done += 1;
      await new Promise((r) => setTimeout(r, 80));
    } catch (err) {
      failed += 1;
      log.error(`[BACKFILL] ${subjectType} ${row.id} failed: ${err.message}`);
    }
  }
  return { total: rows.length, done, skipped, failed };
}

(async () => {
  const emb = getEmbeddingConfig();
  log.info(`[BACKFILL] embeddings via ${emb.provider} model=${emb.model}${DRY ? " — DRY RUN" : ""}`);
  if (emb.provider === "openrouter" && !emb.apiKey) {
    log.error("[BACKFILL] no embedding key: set OPENAI_API_KEY, or OPENROUTER_API_KEY / AI_API_KEY, or AI_EMBEDDING_*");
    process.exit(1);
  }
  const results = {};
  if (ONLY !== "requirements") results.resumes = await backfill("resume");
  if (ONLY !== "resumes") results.requirements = await backfill("requirement");
  console.table(results);
  await pool.end();
})().catch((err) => {
  log.error(`[BACKFILL] ${err.message}`);
  process.exit(1);
});
