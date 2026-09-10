#!/usr/bin/env bash
#
# Re-take the production baseline.
#
#   ./scripts/dump-baseline.sh [output.sql]
#
# Do NOT run this to "refresh" the baseline. It is taken once, and after that
# every change is a new migration after it. Re-baselining discards the record
# of how the schema got from there to here, which is the whole point of having
# migrations at all.
#
# Legitimate reasons to run it again:
#   - the first baseline was taken wrongly and nothing has been built on it
#   - you are deliberately squashing, and you have said so to the team
#
# READ ONLY against production. It runs one pg_dump --schema-only and writes a
# file. No DDL, no data, nothing written to the database.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$REPO/packages/db/migrations/V20260909.01__baseline_from_production.sql}"

# The six schemas this system owns. `app` holds the RLS helper functions —
# no tables, so it is easy to miss and 23 triggers depend on it. Everything else in the Supabase project is
# either managed by Supabase (auth, storage, realtime, vault, extensions) or
# created at runtime by a library (pgboss by pg-boss, langgraph by the
# checkpointer). Dumping those would produce a file that cannot be replayed.
# Every schema this system owns. ADD NEW ONES HERE as the migration
# proceeds — core, authoring — or the check silently stops covering them.
SCHEMAS="--schema=app --schema=platform --schema=core --schema=authoring --schema=public --schema=syntra --schema=orch --schema=relay --schema=interview_agent"

PGURL="$(cd "$REPO" && node -e "require('dotenv').config();process.stdout.write(process.env.DATABASE_URL||'')")"
if [ -z "$PGURL" ]; then
  echo "DATABASE_URL is not set in $REPO/.env" >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# shellcheck disable=SC2086
pg_dump "$PGURL" --schema-only --no-owner --no-privileges $SCHEMAS -f "$TMP"

python - "$TMP" "$OUT" <<'PY'
import io, re, sys

raw = io.open(sys.argv[1], encoding="utf-8").read()

# \restrict and \unrestrict are psql meta-commands. Flyway speaks JDBC and
# cannot parse a backslash command.
lines = [l for l in raw.splitlines()
         if not l.startswith("\\restrict") and not l.startswith("\\unrestrict")]
body = "\n".join(lines)

# CREATE SCHEMA public fails on any fresh database, where it already exists.
body = re.sub(r"^CREATE SCHEMA (\w+);", r"CREATE SCHEMA IF NOT EXISTS \1;", body, flags=re.M)

header = io.open(sys.argv[2], encoding="utf-8").read().split("-- The dump names types")[0] \
    if __import__("os").path.exists(sys.argv[2]) else ""

if not header:
    header = "-- BASELINE — the schema as it stood in production.\n\n"

# The dumped schemas use these but cannot create them, because extensions live
# outside them. Each one here was found by scripts/rebuild-check.sh failing,
# which is the only reliable way to find them: pg_dump does not say.
header += ("-- The dump names types and operator classes from these extensions but cannot\n"
           "-- create them: extensions live outside the dumped schemas.\n"
           "CREATE EXTENSION IF NOT EXISTS vector;   -- vector columns, hnsw, vector_cosine_ops\n"
           "CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive email columns\n"
           "CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- gin_trgm_ops, on the fuzzy-name indexes\n\n")

# Roles are cluster-level, so --schema never dumps them, but the RLS policies
# GRANT to them by name and fail if they are absent. These four are what
# production has. NOLOGIN on purpose: this creates the grant targets, not the
# accounts. Passwords and LOGIN belong to whoever provisions the environment.
header += ("-- Roles the policies below grant to. Cluster-level, so no dump contains them.\n"
           "DO $$\n"
           "DECLARE r text;\n"
           "BEGIN\n"
           "  FOREACH r IN ARRAY ARRAY['syntra_relay','syntra_app','syntra_migrator','anon'] LOOP\n"
           "    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN\n"
           "      EXECUTE format('CREATE ROLE %I NOLOGIN', r);\n"
           "    END IF;\n"
           "  END LOOP;\n"
           "END $$;\n\n")

io.open(sys.argv[2], "w", encoding="utf-8", newline="\n").write(header + body + "\n")
print("wrote", sys.argv[2])
PY

grep -c "CREATE TABLE" "$OUT" | xargs echo "tables:"
