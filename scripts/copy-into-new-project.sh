#!/usr/bin/env bash
#
# Fill a new Supabase project with the new structure and the real data.
#
#   TARGET_URL='postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres' \
#     ./scripts/copy-into-new-project.sh
#
# Applies V1 and V2, then copies every row of the six owned schemas out of the
# old database and into the new one.
#
# THE OLD DATABASE IS ONLY READ. Every statement against it is a SELECT or a
# pg_dump. Nothing there is modified, and RELAY, INTERVIEW and PRISM carry on
# against it untouched -- they have to, because their tables are not coming and
# their foreign keys point at ones that are staying.
#
# WHAT COMES ACROSS
#
#   platform   organisations, users, membership, applications, queues, features
#   core       people, requirements, resumes, matches, embeddings, files, jobs
#   authoring  workflows, versions, drafts, catalogue, bindings, node registry
#   builder    the admin app's agent model
#   orch       runs, steps, the outbox, run failures
#   syntra     matching policies, scoring log, review queue
#
# WHAT DOES NOT, AND WHY
#
#   the legacy public tables   100 of them, superseded. The new project has
#                              nothing in public at all.
#   relay, interview_agent     another team's schema. Their code still points
#                              at the old database.
#   pgboss, langgraph          the libraries build these at boot and own their
#                              own DDL. Copying in-flight jobs would replay
#                              work that has already happened.
#
# SAFE TO RE-RUN. Each table is emptied and refilled, so a run that dies
# halfway is fixed by running it again rather than by deleting the project.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PGCLIENTENCODING=UTF8

if [ -z "${TARGET_URL:-}" ]; then
  cat >&2 <<'USAGE'
TARGET_URL is not set.

  Supabase dashboard -> Project Settings -> Database -> Connection string -> URI

  Use the DIRECT connection or the SESSION pooler (port 5432), not 6543:
  this copies data and wants one session throughout.

  TARGET_URL='postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres' \
    ./scripts/copy-into-new-project.sh
USAGE
  exit 1
fi

# The old database. Defaults to whatever .env points at, which is usually
# right -- but .env may be pointing at a local reference database, and copying
# that into a new project would fill it with seed data instead of real data.
SOURCE_URL="${SOURCE_URL:-$(cd "$REPO" && node -e "require('dotenv').config();process.stdout.write(process.env.DATABASE_URL||'')")}"

host_of() { node -e "process.stdout.write(new URL(process.argv[1]).hostname)" "$1"; }
src_host="$(host_of "$SOURCE_URL")"
tgt_host="$(host_of "$TARGET_URL")"

echo "  FROM  $src_host   (read only)"
echo "  INTO  $tgt_host"
echo

if [ "$src_host" = "$tgt_host" ]; then
  echo "Source and target are the same database. Refusing." >&2
  exit 1
fi

case "$src_host" in
  127.0.0.1|localhost)
    echo "WARNING: the source is a LOCAL database, not your Supabase project." >&2
    echo "  That copies seed data, not real data. Set SOURCE_URL to the old" >&2
    echo "  project if that is not what you meant." >&2
    echo >&2
    read -r -p "  Continue anyway? [y/N] " ok
    [ "$ok" = "y" ] || exit 1 ;;
esac

# ── the schema ───────────────────────────────────────────────────────────
echo "-> applying the schema"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q -f "$REPO/packages/db/new-project/V1__baseline.sql" >/dev/null
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q -f "$REPO/packages/db/new-project/V2__reference_data.sql" >/dev/null

# ── the order ────────────────────────────────────────────────────────────
#
# Foreign keys are enforced during the copy, so a table has to arrive after
# everything it references. Kahn's algorithm over pg_constraint, computed here
# rather than written down: a hand-kept list of 34 tables goes wrong the first
# time somebody adds a column with a reference in it.
#
# Asked of the TARGET, not the source. The new project defines what should be
# filled; the old one has a hundred tables that are not coming, including the
# legacy syntra shims that share a schema with the three real ones.
#
# `tr -d '\r'` because psql on Windows emits CRLF, and a table name with a
# carriage register on the end matches nothing in pg_dump -- which fails with
# "no matching tables were found" and names neither the table nor the reason.
echo "-> working out the copy order"
ORDER="$(psql "$TARGET_URL" -At <<'SQL' | tr -d '\r'
WITH RECURSIVE
  t AS (
    SELECT c.oid, n.nspname || '.' || c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r'
       AND n.nspname IN ('platform','core','authoring','orch','builder','syntra')
  ),
  dep AS (
    SELECT DISTINCT con.conrelid AS child, con.confrelid AS parent
      FROM pg_constraint con
      JOIN t a ON a.oid = con.conrelid
      JOIN t b ON b.oid = con.confrelid
     WHERE con.contype = 'f' AND con.conrelid <> con.confrelid
  ),
  levels AS (
    SELECT t.oid, t.name, 0 AS depth FROM t
     WHERE NOT EXISTS (SELECT 1 FROM dep WHERE dep.child = t.oid)
    UNION ALL
    SELECT t.oid, t.name, l.depth + 1
      FROM t JOIN dep ON dep.child = t.oid JOIN levels l ON l.oid = dep.parent
     WHERE l.depth < 12
  )
SELECT name FROM (SELECT name, max(depth) AS d FROM levels GROUP BY name) x
 ORDER BY d, name;
SQL
)"

echo "   $(echo "$ORDER" | grep -c .) tables"

# ── the data ─────────────────────────────────────────────────────────────
#
# Triggers off while copying. `set_updated_at` would stamp every row with the
# time of the copy, and the derive-org triggers would recompute a value the
# source already settled. The rows arrive as they are, not as a fresh insert
# would make them.
echo "-> copying"
for tbl in $ORDER; do
  psql "$TARGET_URL" -q -c "ALTER TABLE $tbl DISABLE TRIGGER USER" >/dev/null 2>&1 || true
done

copied=0
for tbl in $ORDER; do
  exists="$(psql "$SOURCE_URL" -At -c "SELECT to_regclass('$tbl') IS NOT NULL" 2>/dev/null | tr -d '\r')"
  if [ "$exists" != "t" ]; then
    # Not an error: authoring.plans and plan_steps are new, and a fresh
    # project starts them empty.
    printf '   %-34s %s\n' "$tbl" "not in the old database"
    continue
  fi

  n="$(psql "$SOURCE_URL" -At -c "SELECT count(*) FROM $tbl" | tr -d '\r')"
  if [ "$n" = "0" ]; then
    printf '   %-34s %s\n' "$tbl" "empty"
    continue
  fi

  # COPY has no ON CONFLICT, so a table holding rows already (V2's reference
  # data, or a previous run) is emptied first.
  psql "$TARGET_URL" -q -c "TRUNCATE $tbl CASCADE" >/dev/null 2>&1 || true
  pg_dump "$SOURCE_URL" --data-only --no-owner --no-privileges --table="$tbl" \
    | grep -v '^\\restrict\|^\\unrestrict' \
    | psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q
  printf '   %-34s %8s rows\n' "$tbl" "$n"
  copied=$((copied + 1))
done

for tbl in $ORDER; do
  psql "$TARGET_URL" -q -c "ALTER TABLE $tbl ENABLE TRIGGER USER" >/dev/null 2>&1 || true
done

# ── the one column that generates its own values ─────────────────────────
#
# orch.event_outbox.id is GENERATED ALWAYS AS IDENTITY. COPY brings the ids
# across but does not move the sequence, so without this the next event
# published collides with row 1 and the outbox stops accepting writes.
echo "-> resetting the outbox sequence"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -At -c "
  SELECT setval(pg_get_serial_sequence('orch.event_outbox','id'),
                greatest(coalesce((SELECT max(id) FROM orch.event_outbox), 1), 1));" >/dev/null

# ── did it all arrive ────────────────────────────────────────────────────
echo
echo "-> checking every table against the old database"
BAD=0
for tbl in $ORDER; do
  exists="$(psql "$SOURCE_URL" -At -c "SELECT to_regclass('$tbl') IS NOT NULL" 2>/dev/null | tr -d '\r')"
  [ "$exists" = "t" ] || continue
  a="$(psql "$SOURCE_URL" -At -c "SELECT count(*) FROM $tbl" | tr -d '\r')"
  b="$(psql "$TARGET_URL" -At -c "SELECT count(*) FROM $tbl" | tr -d '\r')"
  if [ "$a" != "$b" ]; then
    printf '   MISMATCH %-30s old %s, new %s\n' "$tbl" "$a" "$b"
    BAD=$((BAD + 1))
  fi
done

if [ "$BAD" -gt 0 ]; then
  echo >&2
  echo "$BAD table(s) do not match. Nothing in the old database was changed;" >&2
  echo "run this again once the reason is understood." >&2
  exit 1
fi

echo "   all $copied table(s) with rows match the old database."
echo
cat <<'EOF'
Done. The new project has the new structure and your data.

Next, against the new project:

  1. Put its URL in .env (keep a copy of the old one first):
       DATABASE_URL=<the new project URI>
       DATABASE_MIGRATOR_URL=<same>
       DATABASE_RELAY_URL=<same>

  2. Let the two libraries build their own tables:
       npm run bootstrap:runtime -w @tekisho/worker

  3. Publish the node registry from the contracts in git:
       npm run materialize:nodes -w @tekisho/worker

  4. Start it:
       npm run dev:full

RELAY, INTERVIEW and PRISM stay on the old project: their tables are not here,
and their foreign keys point at ones that are staying there.
EOF
