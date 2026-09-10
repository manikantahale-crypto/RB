#!/usr/bin/env bash
#
# Can this database be rebuilt from source? Answer it, out loud, in 30 seconds.
#
#   ./scripts/rebuild-check.sh
#
# Builds a throwaway Postgres in Docker, applies the baseline and every
# migration after it, then diffs the result against a fresh dump of production.
#
# A clean diff means the files ARE the schema. Anything else is drift, and the
# lines tell you exactly what somebody created outside a migration — which is
# how this database got into the state the baseline had to rescue it from.
#
# READ ONLY against production: one pg_dump --schema-only. Everything else
# happens in a container that is destroyed at the end.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="bs-rebuild-check"
PORT=55432
LOCAL="postgresql://postgres:test@127.0.0.1:$PORT/rebuild"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "→ starting a throwaway Postgres"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rebuild \
  -p "$PORT:5432" pgvector/pgvector:pg17 >/dev/null

# The container reports ready before it actually accepts connections; the first
# readiness is the initdb bootstrap, which then restarts.
for _ in $(seq 1 40); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d rebuild >/dev/null 2>&1; then break; fi
  sleep 0.5
done
sleep 1

echo "→ applying migrations"
APPLIED=0
for f in "$REPO"/packages/db/migrations/V*.sql; do
  [ -e "$f" ] || continue
  psql "$LOCAL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || { echo "FAILED: $(basename "$f")"; exit 1; }
  APPLIED=$((APPLIED + 1))
done
echo "  applied $APPLIED"

echo "→ dumping both"
# Every schema this system owns. ADD NEW ONES HERE as the migration
# proceeds — core, authoring — or the check silently stops covering them.
SCHEMAS="--schema=app --schema=platform --schema=core --schema=authoring --schema=public --schema=syntra --schema=orch --schema=relay --schema=interview_agent"

# Flyway's own bookkeeping. It exists in production because `flyway baseline`
# created it, and never in a freshly built database until Flyway runs there
# too. It is not part of the schema this repository describes, so comparing it
# would report drift on every run. Excluded at the dump rather than filtered by
# line, because the column definitions inside its CREATE TABLE do not mention
# the table name.
SCHEMAS="$SCHEMAS --exclude-table=public.flyway_schema_history"
PGURL="$(cd "$REPO" && node -e "require('dotenv').config();process.stdout.write(process.env.DATABASE_URL||'')")"

A="$(mktemp)"; B="$(mktemp)"
trap 'rm -f "$A" "$B"; cleanup' EXIT

# Compare statements, not formatting. Dropped from both sides:
#
#   --  lines        pg_dump's own section headers, derived from the objects
#                    they precede, so they add nothing and make the diff
#                    unreadable when one object moves
#   blank lines      same
#   \restrict        psql meta-commands, an artifact of pg_dump 18
#   the public       stock Postgres ships this comment and Supabase strips it.
#   schema comment   A difference in the container, not in our schema.
normalise() {
  grep -v '^\\restrict\|^\\unrestrict\|^--\|^$' \
    | grep -v "^COMMENT ON SCHEMA public IS 'standard public schema';$"
}

# shellcheck disable=SC2086
pg_dump "$PGURL"  --schema-only --no-owner --no-privileges $SCHEMAS | normalise > "$A"
# shellcheck disable=SC2086
pg_dump "$LOCAL"  --schema-only --no-owner --no-privileges $SCHEMAS | normalise > "$B"

echo
if diff -q "$A" "$B" >/dev/null; then
  echo "CLEAN — the migrations reproduce production exactly."
else
  echo "DRIFT — production has $(diff "$A" "$B" | grep -c '^<') lines no migration accounts for,"
  echo "        and the migrations have $(diff "$A" "$B" | grep -c '^>') lines production does not."
  echo
  diff "$A" "$B" | head -60
  echo
  echo "(full diff: diff <(...) — rerun with the two dumps kept if you need it)"
fi
