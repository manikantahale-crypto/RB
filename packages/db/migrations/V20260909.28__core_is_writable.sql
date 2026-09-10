--
-- Make `core` writable in its own right.
--
-- Everything in core arrived by copy, so it never needed to generate an id or
-- work out an owner — the mirror always had both. Now that code is about to
-- write to it directly, it needs what any table needs: an id it can generate
-- and an organisation it can derive.
--
-- Without this, the first INSERT into core.people fails twice over: no default
-- for the primary key, and org_id NOT NULL with nothing to fill it. The
-- equivalent triggers built in V20260909.13 sit on the LEGACY tables, which is
-- the wrong side now.
--
-- SAFE TO RE-RUN.
--

ALTER TABLE core.people       ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE core.requirements ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE core.resumes      ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE core.matches      ALTER COLUMN id SET DEFAULT gen_random_uuid();


-- ═══════════════════════════════════════════ who does this row belong to ══
--
-- Same rules as V20260909.13, on the other side:
--
--   a person or a requirement  the organisation of whoever created it
--   a resume                   the person it describes
--   a match                    the requirement it scores against
--
-- The caller SHOULD pass org_id — it comes from the session, which is what
-- row-level security will eventually read. These only fill a NULL, so a caller
-- that knows better is never overridden.
CREATE OR REPLACE FUNCTION app.core_org_from_creator()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE memberships int;
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.created_by IS NULL THEN
    RAISE EXCEPTION
      'core.% needs org_id, or a created_by whose organisation can be looked up',
      TG_TABLE_NAME;
  END IF;

  -- Refuses to guess for somebody who belongs to two organisations: at that
  -- point only the caller knows which one it is acting for.
  SELECT count(*) INTO memberships
    FROM platform.org_members m WHERE m.user_id = NEW.created_by;

  IF memberships = 1 THEN
    SELECT m.org_id INTO NEW.org_id
      FROM platform.org_members m WHERE m.user_id = NEW.created_by;
  END IF;

  IF NEW.org_id IS NULL THEN
    RAISE EXCEPTION 'cannot derive an organisation for created_by %', NEW.created_by;
  END IF;

  RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION app.core_org_from_person()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT p.org_id INTO NEW.org_id FROM core.people p WHERE p.id = NEW.person_id;
  IF NEW.org_id IS NULL THEN
    RAISE EXCEPTION 'cannot derive an organisation from person %', NEW.person_id;
  END IF;
  RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION app.core_org_from_requirement()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT q.org_id INTO NEW.org_id
    FROM core.requirements q WHERE q.id = NEW.requirement_id;
  IF NEW.org_id IS NULL THEN
    RAISE EXCEPTION 'cannot derive an organisation from requirement %', NEW.requirement_id;
  END IF;
  RETURN NEW;
END $$;


CREATE OR REPLACE TRIGGER people_org_default
  BEFORE INSERT ON core.people
  FOR EACH ROW EXECUTE FUNCTION app.core_org_from_creator();

CREATE OR REPLACE TRIGGER requirements_org_default
  BEFORE INSERT ON core.requirements
  FOR EACH ROW EXECUTE FUNCTION app.core_org_from_creator();

CREATE OR REPLACE TRIGGER resumes_org_default
  BEFORE INSERT ON core.resumes
  FOR EACH ROW EXECUTE FUNCTION app.core_org_from_person();

CREATE OR REPLACE TRIGGER matches_org_default
  BEFORE INSERT ON core.matches
  FOR EACH ROW EXECUTE FUNCTION app.core_org_from_requirement();


DO $$
BEGIN
  RAISE NOTICE 'core generates its own ids and derives its own owners.';
END $$;
