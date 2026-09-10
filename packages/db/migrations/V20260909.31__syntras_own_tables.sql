--
-- What is actually SYNTRA's, once the shared entities have moved out.
--
-- SYNTRA had eleven tables. Four — jobs, candidates, resumes, matches — were
-- the business and now live in `core`; what remains of them here is a shim fed
-- by the reverse mirror so RELAY, INTERVIEW and PRISM keep resolving. One,
-- users, is a second identity system. Two are empty and one is a hand-rolled
-- migration record superseded by flyway_schema_history.
--
-- What genuinely belongs to SYNTRA is three tables, and this migration gives
-- them the names and the constraints the rest of the schema already has:
--
--   matching_policies   how a customer wants scoring done
--   scoring_log         was ml_scoring_log — what a model decided, and why
--   review_queue        was recruiter_review_items — what a person must decide
--
-- SAFE TO RE-RUN.
--

-- ══════════════════════════════════════════ 1 · stop pointing at syntra.users ══
--
-- Three foreign keys inside SYNTRA still resolve `created_by` against
-- syntra.users, the identity table that V20260909.14 replaced. All 49 of its
-- rows exist in platform.users with the same ids, so this is a change of
-- target, not of data.
--
-- It also fixes something the reverse mirror was quietly losing: three
-- platform users have no syntra.users row, so any row they created had its
-- created_by dropped on the way into the legacy tables. Pointing at
-- platform.users makes those attributable.
--
-- The five PRISM foreign keys onto syntra.users are left alone. That is
-- another team's schema and their move is theirs to make.
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('syntra.candidates',        'candidates_created_by_fkey'),
      ('syntra.jobs',              'jobs_created_by_fkey'),
      ('syntra.matching_policies', 'matching_policies_created_by_fkey')
    ) AS v(tbl, con)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conname = spec.con
         AND c.confrelid = 'syntra.users'::regclass
    ) THEN
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', spec.tbl, spec.con);
      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (created_by) '
        'REFERENCES platform.users (id)', spec.tbl, spec.con);
      RAISE NOTICE '% now references platform.users', spec.tbl;
    END IF;
  END LOOP;
END $$;


-- ═══════════════════════════════ 2 · the review queue belongs to a customer ══
--
-- It has carried organization_id on all 887 rows from the start, with nothing
-- checking it. Every other tenanted table in the database now has this key.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recruiter_review_items_org_fk'
  ) THEN
    ALTER TABLE syntra.recruiter_review_items
      ADD CONSTRAINT recruiter_review_items_org_fk
      FOREIGN KEY (organization_id) REFERENCES platform.organizations (id);
  END IF;
END $$;


-- ═════════════════════════════════════════════════ 3 · say what they are ══
--
-- `ml_scoring_log` is not about machine learning specifically — it records
-- what any scorer decided, which is why the design calls it scoring_log and
-- gives core.matches a `scored_by` column so a second scorer can coexist.
--
-- `recruiter_review_items` describes its rows rather than its purpose. It is
-- the queue of things waiting for a person, which is what makes it SYNTRA's
-- rather than a list of records.
--
-- Renames, not rebuilds: the rows, ids and constraints all follow.
DO $$
BEGIN
  IF to_regclass('syntra.ml_scoring_log') IS NOT NULL
     AND to_regclass('syntra.scoring_log') IS NULL THEN
    ALTER TABLE syntra.ml_scoring_log RENAME TO scoring_log;
    RAISE NOTICE 'ml_scoring_log -> scoring_log';
  END IF;

  IF to_regclass('syntra.recruiter_review_items') IS NOT NULL
     AND to_regclass('syntra.review_queue') IS NULL THEN
    ALTER TABLE syntra.recruiter_review_items RENAME TO review_queue;
    RAISE NOTICE 'recruiter_review_items -> review_queue';
  END IF;
END $$;


DO $$
DECLARE still_syntra_users int;
BEGIN
  SELECT count(*) INTO still_syntra_users
    FROM pg_constraint
   WHERE contype = 'f'
     AND confrelid = 'syntra.users'::regclass
     AND conrelid::regclass::text LIKE 'syntra.%';

  IF still_syntra_users > 0 THEN
    RAISE WARNING '% SYNTRA foreign keys still point at syntra.users', still_syntra_users;
  END IF;

  RAISE NOTICE 'SYNTRA keeps three tables: matching_policies, scoring_log, review_queue.';
END $$;
