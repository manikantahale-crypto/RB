/**
 * Who gets the consent email for a requirement: the top matches, one per
 * person, real inbox addresses preferred. Ported from utils/shortlistCandidates.js
 * on 2026-09-18 (ref/SYNTRA_Onboarding.md stage 4) and repointed at core.
 */
const { pool } = require("../../../config/db");

function normalizePersonKey(name) {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function emailQuality(email) {
  if (!email || !String(email).trim()) return 0;
  const e = String(email).trim().toLowerCase();
  if (/@email\.com$/i.test(e) || /@example\.com$/i.test(e) || /@test\.com$/i.test(e)) {
    return 1;
  }
  if (/^[^\s@]+@(gmail|googlemail|yahoo|outlook|hotmail|icloud)\./i.test(e)) {
    return 3;
  }
  return 2;
}

function isPlaceholderEmail(email) {
  return emailQuality(email) <= 1;
}

function pickBetterRow(a, b) {
  const scoreA = Number(a.effective_score ?? a.score ?? a.skill_match_score ?? 0);
  const scoreB = Number(b.effective_score ?? b.score ?? b.skill_match_score ?? 0);
  const qualA = emailQuality(a.email);
  const qualB = emailQuality(b.email);

  if (scoreA > scoreB + 0.01) return a;
  if (scoreB > scoreA + 0.01) return b;
  if (qualA > qualB) return a;
  if (qualB > qualA) return b;
  return scoreA >= scoreB ? a : b;
}

/** Dedupe shortlist rows by person; prefer higher score and real inbox emails. */
function dedupeShortlistRows(rows, limit = 5) {
  const byPerson = new Map();
  for (const row of rows) {
    const key = normalizePersonKey(row.full_name);
    const existing = byPerson.get(key);
    byPerson.set(key, existing ? pickBetterRow(row, existing) : row);
  }

  return Array.from(byPerson.values())
    .sort(
      (a, b) =>
        Number(b.effective_score ?? b.score ?? b.skill_match_score ?? 0) -
        Number(a.effective_score ?? a.score ?? a.skill_match_score ?? 0),
    )
    .slice(0, limit);
}

/** If the matched row has a placeholder email, use the best email for the same person (same recruiter). */
async function enrichShortlistEmails(rows, jobId) {
  const enriched = [];
  for (const row of rows) {
    if (!isPlaceholderEmail(row.email)) {
      enriched.push(row);
      continue;
    }
    const key = normalizePersonKey(row.full_name);
    if (!key) {
      enriched.push(row);
      continue;
    }
    const { rows: emailRows } = await pool.query(
      `SELECT c.email::text AS email
         FROM core.people c
         JOIN core.requirements j ON j.id = $2
        WHERE LOWER(REGEXP_REPLACE(TRIM(c.full_name), '\\s+', ' ', 'g')) = $1
          AND j.created_by IS NOT NULL
          AND c.created_by = j.created_by
          AND c.email IS NOT NULL
          AND TRIM(c.email::text) <> ''
        ORDER BY
          CASE
            WHEN c.email::text ~* '@email\\.com$|@example\\.com$|@test\\.com$' THEN 0
            ELSE 1
          END DESC,
          c.updated_at DESC NULLS LAST,
          c.created_at DESC NULLS LAST
        LIMIT 1`,
      [key, jobId],
    );
    const bestEmail = emailRows[0]?.email || row.email;
    enriched.push({ ...row, email: bestEmail });
  }
  return enriched;
}

async function buildShortlistCandidates(jobId, { minScore = 0, limit = 5 } = {}) {
  const fetchLimit = Math.min(Math.max(Number(limit) || 5, 1) * 4, 40);
  const matchRepo = require("../../../repositories/match.repository");
  const rows = await matchRepo.listMatchesForShortlist(jobId, {
    minEffectiveScore: minScore,
    limit: fetchLimit,
  });
  const deduped = dedupeShortlistRows(rows, limit);
  const withEmails = await enrichShortlistEmails(deduped, jobId);
  return withEmails.map((row) => ({
    id: row.candidate_id,
    email: row.email,
    name: row.full_name,
    resume_id: row.resume_id,
    score: row.effective_score ?? row.score ?? row.skill_match_score,
    match_id: row.match_id,
  }));
}

module.exports = {
  normalizePersonKey,
  emailQuality,
  isPlaceholderEmail,
  dedupeShortlistRows,
  enrichShortlistEmails,
  buildShortlistCandidates,
};
