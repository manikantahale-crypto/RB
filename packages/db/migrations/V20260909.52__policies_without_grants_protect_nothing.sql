--
-- The three syntra_* roles are named by 80 policies and granted nothing.
--
-- V20260909.45 put row-level security on every table and wrote the policies
-- that decide which rows syntra_app, syntra_relay and syntra_migrator may see.
-- It did not GRANT those roles anything, and a policy is not a grant.
--
-- Postgres checks them in that order: privileges first, then policies. A role
-- with no SELECT privilege is refused with "permission denied for table"
-- before a single policy is consulted, so every one of those 80 policies is
-- currently unreachable. The tables are not protected by them; they are
-- protected by the absence of a grant, which is a different thing and not one
-- anybody wrote down.
--
-- Nothing is broken today because every application connects as `postgres`,
-- which is a superuser and bypasses both. That is exactly why this went
-- unnoticed, and exactly why it has to be fixed before anyone moves to the
-- least-privilege roles the policies were written for -- at which point the
-- apps would stop working entirely, on every table at once, with an error
-- that points at permissions rather than at this.
--
-- WHY THE GRANTS ARE BROAD AND THE POLICIES ARE NOT
--
-- SELECT, INSERT, UPDATE, DELETE on everything in the six owned schemas. The
-- grant opens the door; the policy decides which rows are behind it. Narrowing
-- the grant as well would mean maintaining the same rule twice, in two places
-- that cannot be compared, and the one that silently wins is the grant.
--
-- A role with DELETE and no delete policy can delete nothing. That is the
-- design, not an oversight.
--
-- Two things are granted beyond the tables:
--
--   USAGE ON SCHEMA   without it the role cannot name the table at all, and
--                     the table grant is unreachable.
--   USAGE ON SEQUENCE orch.event_outbox.id is GENERATED ALWAYS AS IDENTITY.
--                     Its sequence needs USAGE or every publish fails.
--
-- DEFAULT PRIVILEGES are set too, so a table added by a later migration is
-- granted on creation rather than being missed until someone notices a
-- permission error in an environment nobody runs as postgres.
--
-- SAFE TO RE-RUN.
--

DO $$
DECLARE
  target_role text;
  target_schema text;
  granted int := 0;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['syntra_app','syntra_relay','syntra_migrator']
  LOOP
    -- A role missing in this environment is skipped, not invented. Creating
    -- login roles from a migration puts passwords in git.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
      RAISE NOTICE 'role % does not exist here -- skipped', target_role;
      CONTINUE;
    END IF;

    FOREACH target_schema IN ARRAY ARRAY['platform','core','authoring','orch','builder','syntra']
    LOOP
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', target_schema, target_role);
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I',
        target_schema, target_role);
      EXECUTE format(
        'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I',
        target_schema, target_role);

      -- What the next migration creates, without it having to remember.
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I
           GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
        target_schema, target_role);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I
           GRANT USAGE, SELECT ON SEQUENCES TO %I',
        target_schema, target_role);

      granted := granted + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE '% role/schema pair(s) granted', granted;
END $$;


--
-- Every table carrying a policy for a role must also grant that role, or the
-- policy is dead. This is the check that would have caught the original gap.
--
DO $$
DECLARE
  unreachable int;
  example text;
BEGIN
  SELECT count(*), min(p.schemaname || '.' || p.tablename || ' -> ' || r.role)
    INTO unreachable, example
    FROM pg_policies p
    CROSS JOIN LATERAL unnest(p.roles) AS r(role)
   WHERE p.schemaname IN ('platform','core','authoring','orch','builder','syntra')
     AND r.role <> 'public'
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.role)
     AND NOT has_table_privilege(
           r.role, (p.schemaname || '.' || p.tablename)::regclass, 'SELECT');

  IF unreachable > 0 THEN
    RAISE EXCEPTION
      '% policy/role pair(s) still have no SELECT privilege, e.g. %',
      unreachable, example;
  END IF;

  RAISE NOTICE 'every policy in the six owned schemas is reachable by the role it names.';
END $$;
