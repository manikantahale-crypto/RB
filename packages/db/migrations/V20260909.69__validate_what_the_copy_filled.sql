-- Validate the foreign keys that were waiting for the copy.
--
-- WHY THESE KEYS WERE NOT VALID
--
-- V20260909.63–.67 created vendors, prism.*, relay.*, core.activities and
-- orbit.* with foreign keys into core.people, core.requirements, core.resumes,
-- core.matches, core.vendors and platform.users — and marked every one of
-- those keys NOT VALID. At that moment the parents were not all there: the
-- new project's core.* was the 2026-09-10 copy, and the rows that satisfy the
-- keys (people and requirements created since, every vendor) arrive with
-- scripts/copy-delta.mjs (ref/Data_Migration_Plan.md §3.5). A NOT VALID key
-- is enforced for every NEW row from the moment it exists; only the rows
-- already present are unchecked. This file checks them.
--
-- WHEN TO RUN IT
--
-- After copy-delta.mjs has completed every step in §3.5, and its skip report
-- is empty or accepted. Not before: it will fail, by design, naming the key
-- that has a dangling reference. That failure is information, not a bug —
-- it means the copy left something out, and the answer is in the copy's
-- skip report, not in this file.
--
-- SAFE TO RE-RUN. Validating a valid key is a no-op.

BEGIN;

DO $$
DECLARE
  k record;
  n int := 0;
BEGIN
  FOR k IN
    SELECT c.conname, n.nspname AS sch, r.relname AS tbl
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE c.contype = 'f' AND NOT c.convalidated
       AND n.nspname IN ('core', 'prism', 'relay', 'orbit')
     ORDER BY 2, 3, 1
  LOOP
    EXECUTE format('ALTER TABLE %I.%I VALIDATE CONSTRAINT %I', k.sch, k.tbl, k.conname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'validated % foreign key(s).', n;
END $$;

DO $$
DECLARE pending text;
BEGIN
  SELECT string_agg(n.nspname || '.' || r.relname || '.' || c.conname, ', ') INTO pending
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE c.contype = 'f' AND NOT c.convalidated
     AND n.nspname IN ('core', 'prism', 'relay', 'orbit');
  IF pending IS NOT NULL THEN
    RAISE EXCEPTION 'foreign keys still NOT VALID: %', pending;
  END IF;
  RAISE NOTICE 'every foreign key in core, prism, relay and orbit is valid.';
END $$;

COMMIT;
