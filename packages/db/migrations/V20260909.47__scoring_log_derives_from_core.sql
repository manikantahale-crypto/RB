--
-- syntra.scoring_log stops deriving its organisation through a shim.
--
-- `app.org_from_job()` stamps org_id on every scoring_log row, and it reads
-- syntra.jobs and syntra.candidates to do it. Those are shims now, fed by the
-- mirror from core, so the value arrives one hop later than it needs to and
-- via a table that only still exists for other teams.
--
-- It matters twice:
--
--   Today   a scorer writing a row for a requirement that reached core but has
--           not yet been mirrored would fail to derive an org and RAISE.
--
--   Later   the new project will not have the shims at all, and every insert
--           into scoring_log would fail on a missing table.
--
-- The ids are the same on both sides -- V20260909.09 moved the rows keeping
-- their ids, and the mirror preserves them -- so this is a change of which
-- table is asked, not of what the answer is.
--
-- SAFE TO RE-RUN.
--

CREATE OR REPLACE FUNCTION app.org_from_job()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT r.org_id INTO NEW.org_id
    FROM core.requirements r WHERE r.id = NEW.job_id;

  IF NEW.org_id IS NULL AND NEW.candidate_id IS NOT NULL THEN
    SELECT p.org_id INTO NEW.org_id
      FROM core.people p WHERE p.id = NEW.candidate_id;
  END IF;

  IF NEW.org_id IS NULL THEN
    RAISE EXCEPTION
      'cannot derive an organisation for scoring_log: neither core.requirements % '
      'nor core.people % exists', NEW.job_id, NEW.candidate_id;
  END IF;

  RETURN NEW;
END $$;


DO $$
DECLARE
  orphans int;
BEGIN
  -- Rows already written whose requirement is not in core. They keep the org
  -- they were stamped with; this only reports that the link is broken, because
  -- a scoring decision about a requirement nobody can find is worth knowing
  -- about whether or not this migration caused it.
  SELECT count(*) INTO orphans
    FROM syntra.scoring_log s
   WHERE NOT EXISTS (SELECT 1 FROM core.requirements r WHERE r.id = s.job_id);

  IF orphans > 0 THEN
    RAISE WARNING '% scoring_log row(s) name a requirement that is not in core.', orphans;
  END IF;

  RAISE NOTICE 'scoring_log derives its organisation from core.';
END $$;
