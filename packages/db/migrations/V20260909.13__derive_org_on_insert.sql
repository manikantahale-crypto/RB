--
-- URGENT FIX: restore writes broken by V20260909.06.
--
-- WHAT BROKE
--
-- V20260909.06 made org_id NOT NULL on five SYNTRA tables. Nothing in the
-- application sets it — there are eight INSERT sites across node-api and
-- admin-api and none of them mention the column, because it did not exist
-- until an hour earlier. So every insert has been failing:
--
--   ERROR: null value in column "org_id" of relation "candidates"
--          violates not-null constraint
--
-- That means no new candidate, job, resume or match could be written. The
-- constraint is right; adding it without giving the writers a way to satisfy
-- it was not.
--
-- WHY A TRIGGER RATHER THAN EIGHT CODE CHANGES
--
-- Both, in that order. The trigger goes first because it restores writes in one
-- statement and cannot be forgotten at a call site nobody remembered. It also
-- states the rule that is actually true today, in the one place that can
-- enforce it:
--
--   a row belongs to the organisation of whoever created it
--   a resume belongs to its candidate
--   a match and a scoring row belong to their requirement
--
-- This is the same derivation V20260909.04 used to backfill 9,378 rows, so the
-- rule for new rows and the rule for old ones cannot drift apart.
--
-- The trigger only fills a NULL. A caller that supplies org_id explicitly —
-- which application code should start doing — is left alone, so this does not
-- become a thing that silently overrides intent.
--
-- IF IT CANNOT DERIVE, IT RAISES. A candidate with no creator has no knowable
-- owner, and inventing one is how the wrong tenant ends up owning a person's
-- data. Failing loudly at the insert is the correct outcome.
--

-- ══════════════════════════════════════════════ from whoever created it ══
CREATE OR REPLACE FUNCTION app.org_from_creator()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE memberships int;
BEGIN
  IF NEW.org_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.created_by IS NULL THEN
    RAISE EXCEPTION
      '%.% needs org_id, or a created_by whose organisation can be looked up',
      TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  -- A user with exactly one membership. Deliberately refuses to guess for
  -- somebody who belongs to two organisations: at that point the caller must
  -- say which one it is acting for.
  SELECT count(*) INTO memberships
    FROM platform.org_members m WHERE m.user_id = NEW.created_by;

  IF memberships = 1 THEN
    SELECT m.org_id INTO NEW.org_id
      FROM platform.org_members m WHERE m.user_id = NEW.created_by;
  END IF;

  IF NEW.org_id IS NULL THEN
    SELECT u.organization_id INTO NEW.org_id
      FROM public.users u WHERE u.id = NEW.created_by;
  END IF;

  IF NEW.org_id IS NULL THEN
    RAISE EXCEPTION 'cannot derive an organisation for created_by %', NEW.created_by;
  END IF;

  RETURN NEW;
END $$;


-- ═══════════════════════════════════════════════ from the person it is about ══
CREATE OR REPLACE FUNCTION app.org_from_candidate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT c.org_id INTO NEW.org_id
    FROM syntra.candidates c WHERE c.id = NEW.candidate_id;

  IF NEW.org_id IS NULL THEN
    RAISE EXCEPTION 'cannot derive an organisation from candidate %', NEW.candidate_id;
  END IF;

  RETURN NEW;
END $$;


-- ══════════════════════════════════════════ from the requirement it scores ══
--
-- The requirement side, matching the choice V20260909.04 made when it
-- backfilled: a match is work done against a requirement.
CREATE OR REPLACE FUNCTION app.org_from_job()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT j.org_id INTO NEW.org_id
    FROM syntra.jobs j WHERE j.id = NEW.job_id;

  IF NEW.org_id IS NULL AND NEW.candidate_id IS NOT NULL THEN
    SELECT c.org_id INTO NEW.org_id
      FROM syntra.candidates c WHERE c.id = NEW.candidate_id;
  END IF;

  IF NEW.org_id IS NULL THEN
    RAISE EXCEPTION 'cannot derive an organisation from job %', NEW.job_id;
  END IF;

  RETURN NEW;
END $$;


CREATE OR REPLACE TRIGGER jobs_org_default
  BEFORE INSERT ON syntra.jobs
  FOR EACH ROW EXECUTE FUNCTION app.org_from_creator();

CREATE OR REPLACE TRIGGER candidates_org_default
  BEFORE INSERT ON syntra.candidates
  FOR EACH ROW EXECUTE FUNCTION app.org_from_creator();

CREATE OR REPLACE TRIGGER resumes_org_default
  BEFORE INSERT ON syntra.resumes
  FOR EACH ROW EXECUTE FUNCTION app.org_from_candidate();

CREATE OR REPLACE TRIGGER matches_org_default
  BEFORE INSERT ON syntra.matches
  FOR EACH ROW EXECUTE FUNCTION app.org_from_job();

CREATE OR REPLACE TRIGGER ml_scoring_log_org_default
  BEFORE INSERT ON syntra.ml_scoring_log
  FOR EACH ROW EXECUTE FUNCTION app.org_from_job();


DO $$
BEGIN
  RAISE NOTICE 'org_id is now derived on insert for the five SYNTRA tables.';
  RAISE NOTICE 'Application inserts work again without naming the column.';
END $$;
