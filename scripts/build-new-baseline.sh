#!/usr/bin/env bash
#
# Build V1 of a fresh migration set: the new structure, with nothing legacy.
#
#   ./scripts/build-new-baseline.sh
#
# Writes packages/db/new-project/V1__baseline.sql — the schema a NEW Supabase
# project would start from. Six schemas, no shims, no mirrors, no compatibility
# views, no other team's tables.
#
# READ ONLY AGAINST PRODUCTION. One pg_dump --schema-only, exactly like
# dump-baseline.sh. Your current database is not modified in any way: nothing
# is dropped, disabled or renamed there, and RELAY, INTERVIEW and PRISM carry
# on against it untouched.
#
# HOW IT PRUNES, AND WHY NOT WITH A REGEX
#
# The obvious approach is to dump everything and filter the text. That breaks
# quietly: a function body mentioning a table looks the same as a trigger
# creating one, and a missed line becomes a CREATE that fails on first run.
#
# So the pruning is done in SQL, in a throwaway container: restore the whole
# schema, DROP what does not belong, dump what is left. The DROPs are real
# statements against a real catalogue, so anything still depended upon fails
# here rather than in the new project.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="bs-new-baseline"
PORT=55436
LOCAL="postgresql://postgres:test@127.0.0.1:$PORT/newproj"
OUT_DIR="$REPO/packages/db/new-project"
OUT="$OUT_DIR/V1__baseline.sql"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

export PGCLIENTENCODING=UTF8
PGURL="${DATABASE_URL:-$(cd "$REPO" && node -e "require('dotenv').config();process.stdout.write(process.env.DATABASE_URL||'')")}"

mkdir -p "$OUT_DIR"

echo "→ starting a throwaway Postgres"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=newproj \
  -p "$PORT:5432" pgvector/pgvector:pg17 >/dev/null
for _ in $(seq 1 40); do
  docker exec "$CONTAINER" pg_isready -U postgres -d newproj >/dev/null 2>&1 && break
  sleep 0.5
done
sleep 1

echo "→ reading production (schema only, read only)"
FULL="$(mktemp)"
pg_dump "$PGURL" --schema-only --no-owner --no-privileges \
  --schema=app --schema=platform --schema=core --schema=authoring \
  --schema=builder --schema=orch --schema=public --schema=syntra \
  --schema=relay --schema=interview_agent \
  --exclude-table=public.flyway_schema_history > "$FULL"

# psql meta-commands from pg_dump 18, and CREATE SCHEMA public on a database
# that already has one.
sed -i 's/^\\restrict.*$//; s/^\\unrestrict.*$//' "$FULL"
sed -i 's/^CREATE SCHEMA \([a-z_]*\);/CREATE SCHEMA IF NOT EXISTS \1;/' "$FULL"

echo "→ restoring it, then pruning"
psql "$LOCAL" -v ON_ERROR_STOP=1 -q <<'SQL' >/dev/null
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- BEFORE the restore, not after. A CREATE POLICY ... TO syntra_migrator against
-- a role that does not exist fails, and pg_dump's output is applied with errors
-- tolerated -- so without these the role-scoped policies would be dropped on
-- the floor and the count would look plausible. It was 32 instead of 78 once.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['syntra_relay','syntra_app','syntra_migrator'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;
SQL
psql "$LOCAL" -q -f "$FULL" >/dev/null 2>&1 || true

psql "$LOCAL" -v ON_ERROR_STOP=1 <<'SQL'
-- ─────────────────────────────────────────────── other teams' schemas ──
-- Their tables and their foreign keys stay in the old database, which is
-- where their applications keep pointing.
DROP SCHEMA IF EXISTS relay CASCADE;
DROP SCHEMA IF EXISTS interview_agent CASCADE;

-- ──────────────────────────────────────────────── everything in public ──
-- Legacy tables, the compatibility views over them, and PRISM's tables. The
-- new structure puts nothing in public at all, which is the point: a table
-- with no schema is a table nobody has decided the owner of.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m')
  LOOP
    EXECUTE format('DROP %s IF EXISTS public.%I CASCADE',
                   CASE r.relkind WHEN 'v' THEN 'VIEW'
                                  WHEN 'm' THEN 'MATERIALIZED VIEW'
                                  ELSE 'TABLE' END, r.relname);
  END LOOP;
END $$;

-- ───────────────────────────────────────────────────── SYNTRA's shims ──
-- Four are `core` entities wearing their old names, fed by a mirror; users is
-- a second identity system platform.users replaced; the rest is scaffolding.
-- What is genuinely SYNTRA's is the three kept below.
DROP TABLE IF EXISTS syntra.matches CASCADE;
DROP TABLE IF EXISTS syntra.resumes CASCADE;
DROP TABLE IF EXISTS syntra.jobs CASCADE;
DROP TABLE IF EXISTS syntra.candidates CASCADE;
DROP TABLE IF EXISTS syntra.users CASCADE;
DROP TABLE IF EXISTS syntra.event_log CASCADE;
DROP TABLE IF EXISTS syntra.job_board_staging CASCADE;
DROP TABLE IF EXISTS syntra.schema_migrations CASCADE;

-- ────────────────────────────────────────────── mirrors and their kin ──
-- Every function whose job was to keep two copies of something in step. With
-- one copy there is nothing to keep in step. CASCADE takes the triggers.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app'
             AND (p.proname LIKE 'legacy\_%' OR p.proname LIKE 'mirror\_%'
                  OR p.proname = 'org_from_candidate'
                  OR p.proname = 'graph_definitions_write')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────── the empty schemas ──
-- pg-boss and the LangGraph checkpointer create their own tables at boot and
-- version their own DDL. Reproducing that here would guarantee drift on the
-- next library upgrade; the schemas have to exist first, though.
CREATE SCHEMA IF NOT EXISTS pgboss;
CREATE SCHEMA IF NOT EXISTS langgraph;

-- ─────────────────────────────────────────────────────────── prove it ──
DO $$
DECLARE
  leftovers int;
  dangling  int;
BEGIN
  SELECT count(*) INTO leftovers FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r','v') AND n.nspname = 'public';
  IF leftovers > 0 THEN
    RAISE EXCEPTION '% relation(s) still in public.', leftovers;
  END IF;

  -- Nothing kept may point at anything dropped. If the earlier survey was
  -- wrong, a foreign key would have been silently removed by a CASCADE above,
  -- and this is where that shows up.
  SELECT count(*) INTO dangling FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE con.contype = 'f'
     AND n.nspname IN ('platform','core','authoring','orch','builder','syntra')
     AND (SELECT nf.nspname FROM pg_class cf
            JOIN pg_namespace nf ON nf.oid = cf.relnamespace
           WHERE cf.oid = con.confrelid)
         NOT IN ('platform','core','authoring','orch','builder','syntra');
  IF dangling > 0 THEN
    RAISE EXCEPTION '% foreign key(s) point outside the kept schemas.', dangling;
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname IN ('platform','core','authoring','orch','builder','syntra')) < 60 THEN
    RAISE EXCEPTION 'only % policies survived the restore -- expected around 78. '
      'The usual cause is a role that did not exist when the policies were applied.',
      (SELECT count(*) FROM pg_policies
        WHERE schemaname IN ('platform','core','authoring','orch','builder','syntra'));
  END IF;

  RAISE NOTICE 'pruned: % tables across six schemas.',
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname IN ('platform','core','authoring','orch','builder','syntra'));
END $$;
SQL

echo "→ writing $OUT"
{
  cat <<'HEADER'
--
-- V1 — the schema a new project starts from.
--
-- Generated by scripts/build-new-baseline.sh from the live database, with
-- everything legacy pruned. Do not edit by hand; regenerate instead.
--
-- WHAT IS HERE
--
--   platform   organisations, users, applications, queues, features
--   core       the business: people, requirements, resumes, matches
--   authoring  workflows, their versions and drafts, the event catalogue
--   orch       runs, steps, the outbox, run failures
--   builder    the admin app's agent-shaped authoring model
--   syntra     what is genuinely SYNTRA's: policies, scoring log, review queue
--
-- WHAT IS NOT, AND WHY
--
--   public.*            100 legacy tables. The new structure puts nothing in
--                       public: a table with no schema is a table whose owner
--                       nobody has decided.
--   syntra shims        candidates, jobs, resumes, matches -- `core` entities
--                       wearing their old names for applications that have not
--                       moved yet. There is nothing to be compatible with here.
--   app.legacy_*        the mirrors that kept the two copies in step. One copy.
--   relay, interview_*  another team's schema, in the old database, where their
--                       code still points.
--
-- The old database keeps ALL of the above, unchanged. This file describes a
-- different, empty database; it removes nothing from anywhere.
--
-- pg-boss and the LangGraph checkpointer own their own DDL and create it at
-- boot. Their schemas are created empty at the end.
--

CREATE EXTENSION IF NOT EXISTS vector;   -- vector columns, hnsw, vector_cosine_ops
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive email columns
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- gin_trgm_ops, on the fuzzy-name indexes

-- The roles policies and grants name. NOLOGIN: a new project decides its own
-- passwords, and a role that cannot log in cannot be used by accident.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['syntra_relay','syntra_app','syntra_migrator'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;

HEADER
  pg_dump "$LOCAL" --schema-only --no-owner --no-privileges \
    --schema=app --schema=platform --schema=core --schema=authoring \
    --schema=builder --schema=orch --schema=syntra \
    --schema=pgboss --schema=langgraph \
  | sed 's/^\\restrict.*$//; s/^\\unrestrict.*$//' \
  | sed 's/^CREATE SCHEMA \([a-z_]*\);/CREATE SCHEMA IF NOT EXISTS \1;/'
} > "$OUT"

rm -f "$FULL"

echo
echo "tables:   $(grep -c '^CREATE TABLE' "$OUT")"
echo "policies: $(grep -c '^CREATE POLICY' "$OUT")"
echo "triggers: $(grep -c '^CREATE TRIGGER' "$OUT")"
echo "wrote $OUT"
