#!/usr/bin/env bash
#
# How far has `core` fallen behind `syntra`?
#
#   ./scripts/core-drift.sh
#
# Step 4 copied the business entities into core. The application still writes
# to syntra, so every write since then exists in one place and not the other.
# That is deliberate and temporary — core is derived, syntra is the source —
# but "temporary" has a way of lasting, and an unnoticed gap is how the
# agent_runs dual write quietly lost 36 rows.
#
# Run this before trusting anything in core, and before step 6 moves the code.
# To close a gap, re-run V20260909.09: it is keyed ON CONFLICT DO NOTHING, so
# it picks up new rows and changes nothing else.
#
# READ ONLY.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGURL="$(cd "$REPO" && node -e "require('dotenv').config();process.stdout.write(process.env.DATABASE_URL||'')")"
if [ -z "$PGURL" ]; then echo "DATABASE_URL is not set in $REPO/.env" >&2; exit 1; fi

psql "$PGURL" -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
WITH pairs AS (
  SELECT 'people'       AS entity,
         (SELECT count(*) FROM syntra.candidates) AS source,
         (SELECT count(*) FROM core.people)                                   AS core,
         1 AS expected_gap,
         'one row with no name and no email' AS known
  UNION ALL
  SELECT 'requirements',
         (SELECT count(*) FROM syntra.jobs),
         (SELECT count(*) FROM core.requirements), 0, ''
  UNION ALL
  SELECT 'resumes',
         (SELECT count(*) FROM syntra.resumes),
         (SELECT count(*) FROM core.resumes), 0, ''
  UNION ALL
  SELECT 'matches',
         (SELECT count(*) FROM syntra.matches),
         (SELECT count(*) FROM core.matches), 263, 'cross-tenant, cannot be represented'
)
SELECT entity,
       source,
       core,
       source - core AS gap,
       CASE
         WHEN source - core = expected_gap AND expected_gap = 0 THEN 'in sync'
         WHEN source - core = expected_gap                      THEN 'as expected: ' || known
         WHEN source - core > expected_gap
           THEN 'DRIFTED by ' || (source - core - expected_gap) || ' — re-run V20260909.09'
         ELSE 'core has MORE than source — investigate'
       END AS status
  FROM pairs
 ORDER BY entity;
SQL
