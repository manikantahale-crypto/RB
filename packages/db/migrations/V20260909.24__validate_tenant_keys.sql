--
-- Validate the two tenant keys that V20260909.06 could not.
--
-- They were added NOT VALID because 263 matches joined a job and a candidate
-- from different organisations. V20260909.17 resolved those by giving each
-- person a second row in the other organisation, so the keys can now be
-- checked against every existing row, not just new ones.
--
-- WHY THIS IS A MIGRATION AND NOT A COMMAND SOMEBODY RAN
--
-- It was a command somebody ran — me, with ALTER TABLE, straight against
-- production. scripts/rebuild-check.sh caught it on the next run: production
-- had validated constraints, a database rebuilt from these files did not.
--
-- That is the whole point of the check. Anything done to the database that is
-- not in a migration is invisible to everyone else and disappears the next
-- time the schema is built from source.
--
-- SAFE TO RE-RUN. Validating an already-valid constraint is a no-op, and the
-- guard means a database where the constraint does not exist yet is skipped
-- rather than failing.
--

DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['matches_candidate_org_fk', 'matches_resume_org_fk'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = c AND NOT convalidated
    ) THEN
      EXECUTE format('ALTER TABLE syntra.matches VALIDATE CONSTRAINT %I', c);
      RAISE NOTICE 'validated %', c;
    END IF;
  END LOOP;
END $$;


DO $$
DECLARE unvalidated int;
BEGIN
  SELECT count(*) INTO unvalidated
    FROM pg_constraint
   WHERE conname IN ('matches_candidate_org_fk', 'matches_resume_org_fk', 'matches_job_org_fk')
     AND NOT convalidated;

  IF unvalidated > 0 THEN
    RAISE EXCEPTION '% tenant keys are still unvalidated', unvalidated;
  END IF;

  RAISE NOTICE 'all three tenant keys are enforced on every row, not just new ones.';
END $$;
