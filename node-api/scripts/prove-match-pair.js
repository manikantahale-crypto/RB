/**
 * Prove matching on one requirement and one candidate, end to end.
 *
 *   node node-api/scripts/prove-match-pair.js --job <requirement id>
 *   node node-api/scripts/prove-match-pair.js --job <id> --resume <resume id> [--keep]
 *
 * WHAT IT DOES, in the order the product does it:
 *   1. tier 1  — the pool for the requirement (vector neighbours ∪ SQL pool,
 *                role-family gate) — read only
 *   2. tier 2  — skill overlap, floor, topN — pure; picks the top finalist
 *                unless --resume names one
 *   3. shortlist row — ONE core.matches row for the pair, status requested
 *                (the only write before scoring; reused if one exists)
 *   4. tier 3  — the model scores the pair through the provider chain, the
 *                caps apply, the row becomes completed
 *   5. read back — what the matching workspace would show:
 *                score, llm_score, score_source, caps, tier, reasoning
 *
 * THEN IT CLEANS UP. The match row and its processing record are deleted
 * unless --keep is given, or the row existed before this ran. --keep leaves
 * a real completed match the recruiter can open in the workspace — which is
 * the 2026-09-19 testing report's exit criterion for MATCH-001:
 * "Matching returns expected candidates for a controlled known-good
 * job/candidate pair."
 *
 * Costs one chat completion. Reads .env for the provider chain.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const { pool, withTransaction } = require("../src/config/db");
const matchRepo = require("../src/repositories/match.repository");
const { filterCandidatesForJob } = require("../src/modules/syntra/matching/tier1Filter");
const { rankCandidates } = require("../src/modules/syntra/matching/tier2Rank");
const { processBatchForJob } = require("../src/modules/syntra/workers/matchRequested.worker");
const env = require("../src/config/env");
const log = require("../src/utils/logger");

const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const JOB = arg("--job");
const RESUME = arg("--resume");
const KEEP = args.includes("--keep");

if (!JOB) {
  console.error("usage: prove-match-pair.js --job <requirement id> [--resume <resume id>] [--keep]");
  process.exit(2);
}

(async () => {
  // 1 + 2 — read only
  const { job, pool: tier1Pool, survivors } = await filterCandidatesForJob(JOB);
  if (!job) throw new Error(`requirement ${JOB} not found`);
  if (job.processed_at == null) throw new Error(`requirement ${JOB} is not processed yet`);
  const ranked = rankCandidates({
    requiredSkills: job.required_skills,
    candidates: survivors,
    skillFloor: env.MATCH_SKILL_FLOOR,
    topN: env.MATCH_TOP_N,
  });
  log.info(
    `[PROVE] "${job.title}"  skills=${(job.required_skills || []).length}` +
      `  tier1: pool=${tier1Pool.length} roleFit=${survivors.length}` +
      `  tier2: finalists=${ranked.finalists.length} floor=${env.MATCH_SKILL_FLOOR}` +
      (ranked.noSkillEvidence ? " (no skills on the requirement — floor not applied)" : ""),
  );

  const pick = RESUME
    ? ranked.scored.find((s) => s.resumeId === RESUME) ??
      survivors.filter((s) => s.resume_id === RESUME).map((s) => ({ resumeId: s.resume_id, candidateId: s.candidate_id, skillMatchScore: null }))[0]
    : ranked.finalists[0];
  if (!pick) {
    throw new Error(RESUME ? `resume ${RESUME} is not in this requirement's pool` : "no finalist to score");
  }
  log.info(`[PROVE] pair: resume=${pick.resumeId} candidate=${pick.candidateId} tier2=${pick.skillMatchScore}`);

  // 3 — the one write before scoring
  const existing = await matchRepo.findMatchIdByJobResume(JOB, pick.resumeId);
  let matchId = existing?.id ?? existing ?? null;
  let created = false;
  if (!matchId) {
    const row = await withTransaction((client) =>
      matchRepo.insertShortlistRow(client, {
        jobId: JOB,
        candidateId: pick.candidateId,
        resumeId: pick.resumeId,
        skillMatchScore: pick.skillMatchScore ?? 0,
      }),
    );
    matchId = row?.id ?? null;
    created = Boolean(matchId);
  }
  if (!matchId) throw new Error("could not create or find a match row for the pair");
  log.info(`[PROVE] match row ${matchId} (${created ? "created for this run" : "already existed — will be left in place"})`);

  // 4 — tier 3
  const outcome = await processBatchForJob(JOB, [{ resumeId: pick.resumeId, candidateId: pick.candidateId }]);
  log.info(`[PROVE] tier 3: scored=${outcome.scored} failed=${outcome.failed} missingSummary=${outcome.missingSummary}`);

  // 5 — what the workspace shows
  const { rows } = await pool.query(
    `SELECT m.status, m.score, m.llm_score, m.score_source, m.tier, m.confidence_score,
            m.evidence->'caps_applied' AS caps, m.evidence->>'required_coverage' AS required_coverage,
            m.evidence->>'mandatory_coverage' AS mandatory_coverage,
            left(m.reasoning, 240) AS reasoning, m.model_name,
            (SELECT status FROM core.processing_jobs p WHERE p.subject_type='match' AND p.subject_id=m.id AND p.stage='score' ORDER BY p.attempt DESC LIMIT 1) AS score_stage
       FROM core.matches m WHERE m.id = $1`,
    [matchId],
  );
  console.table(rows.map((r) => ({ ...r, caps: JSON.stringify(r.caps), reasoning: undefined })));
  if (rows[0]?.reasoning) console.log("reasoning:", rows[0].reasoning);

  const verdict =
    rows[0]?.status === "completed" && rows[0]?.score != null
      ? `PROVEN — the workspace lists this candidate at score ${rows[0].score} for "${job.title}" (minScore up to ${rows[0].score})`
      : `NOT PROVEN — row status ${rows[0]?.status}, see the tier 3 log above`;
  log.info(`[PROVE] ${verdict}`);

  // clean up
  if (created && !KEEP) {
    await pool.query(`DELETE FROM core.processing_jobs WHERE subject_type = 'match' AND subject_id = $1`, [matchId]);
    await pool.query(`DELETE FROM core.matches WHERE id = $1`, [matchId]);
    log.info(`[PROVE] cleaned up: match row ${matchId} and its processing record deleted (use --keep to leave it for the workspace)`);
  } else if (created) {
    log.info(`[PROVE] kept: open the requirement in the matching workspace to see it`);
  }
  await pool.end();
})().catch(async (err) => {
  log.error(`[PROVE] ${err.message}`);
  await pool.end().catch(() => {});
  process.exit(1);
});
