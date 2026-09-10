--
-- Row-level security on every table this system owns.
--
-- 29 tables in `public` had RLS ENABLED with ZERO policies, and 22 tables
-- across the new schemas had no RLS at all. Neither state is what anyone
-- intended: RLS with no policy denies everything, and no RLS permits
-- everything, and both were reached by accident rather than decision.
--
-- READ THIS BEFORE BELIEVING THE DATABASE IS NOW ISOLATED
--
-- The application connects as `postgres`, which has rolbypassrls, and holds
-- grants on 114 tables. A role that bypasses RLS bypasses it completely --
-- FORCE included -- so NONE of what follows changes what the application can
-- read today. These policies are correct and inert at the same time.
--
-- They become real the day the application connects as a role that does not
-- bypass. That is a separate change -- roles, grants, connection strings --
-- and it is the one that actually closes the hole. This migration is the half
-- that has to exist first: you cannot switch to a constrained role until the
-- constraints are written.
--
-- Three roles already do not bypass -- syntra_app, syntra_relay and
-- syntra_migrator -- and they hold grants on nine relations. For those nine,
-- this is not theoretical, which is why one of them is a bug fix:
-- builder.agent_definitions had RLS on and no policy while all three had
-- grants on it, so all three were being denied everything.
--
-- THE RULE, APPLIED THE SAME WAY EVERYWHERE
--
-- A table with a tenant column (`organization_id`, else `org_id`) gets a
-- policy that admits a row when the column matches the session's org, or is
-- NULL. NULL means shared -- a global workflow, a platform-wide event schema
-- -- and every such column in this database already carries that meaning.
--
-- A table with no tenant column gets a permissive policy and a comment saying
-- so. That is not security theatre: it makes the table's status explicit and
-- puts it under R__rls_assert, so the day somebody adds an organization_id
-- here, the backstop is already watching the table and the wrong policy is
-- visible rather than absent.
--
-- syntra_migrator keeps a policy of its own on every table, matching what the
-- existing policies do, because seeds and migrations run as that role and must
-- not be filtered by a session org they never set.
--
-- SAFE TO RE-RUN. Every policy is dropped and recreated.
--

DO $$
DECLARE
  t        record;
  org_col  text;
  tenanted int := 0;
  shared   int := 0;
BEGIN
  FOR t IN
    SELECT n.nspname AS schema, c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r'
       AND n.nspname IN ('public', 'core', 'authoring', 'orch',
                         'platform', 'builder', 'syntra')
       -- Flyway's own bookkeeping is not ours to police, and locking it is a
       -- good way to make a migration unable to record that it ran.
       AND c.relname <> 'flyway_schema_history'
     ORDER BY n.nspname, c.relname
  LOOP
    SELECT a.attname INTO org_col
      FROM pg_attribute a
     WHERE a.attrelid = format('%I.%I', t.schema, t.name)::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname IN ('organization_id', 'org_id')
     -- If a table somehow had both, organization_id is the one every foreign
     -- key in this database uses.
     ORDER BY CASE a.attname WHEN 'organization_id' THEN 0 ELSE 1 END
     LIMIT 1;

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schema, t.name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   t.name || '_tenant', t.schema, t.name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   t.name || '_shared', t.schema, t.name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   t.name || '_migrator_all', t.schema, t.name);

    IF org_col IS NOT NULL THEN
      -- ::text on both sides: the column is uuid in the new schemas and text
      -- in some of the older ones, and current_setting always returns text.
      -- nullif('' ) because an unset session variable reads as empty string,
      -- not NULL, and '' = anything is false rather than unknown.
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR ALL USING (%I IS NULL OR %I::text = nullif(current_setting(''app.org_id'', true), '''')) '
        'WITH CHECK (%I IS NULL OR %I::text = nullif(current_setting(''app.org_id'', true), ''''))',
        t.name || '_tenant', t.schema, t.name, org_col, org_col, org_col, org_col);
      tenanted := tenanted + 1;
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR ALL USING (true) WITH CHECK (true)',
        t.name || '_shared', t.schema, t.name);
      shared := shared + 1;
    END IF;

    -- Seeds and migrations run as syntra_migrator and never set a session org.
    BEGIN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR ALL TO syntra_migrator USING (true) WITH CHECK (true)',
        t.name || '_migrator_all', t.schema, t.name);
    EXCEPTION WHEN undefined_object THEN
      NULL;  -- role absent in this environment; nothing to grant it
    END;
  END LOOP;

  RAISE NOTICE 'RLS: % tenant-scoped table(s), % with no tenant column.',
    tenanted, shared;
END $$;


DO $$
DECLARE
  unprotected int;
BEGIN
  SELECT count(*) INTO unprotected
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'r'
     AND n.nspname IN ('public','core','authoring','orch','platform','builder','syntra')
     AND c.relname <> 'flyway_schema_history'
     AND (NOT c.relrowsecurity
          OR NOT EXISTS (SELECT 1 FROM pg_policies p
                          WHERE p.schemaname = n.nspname AND p.tablename = c.relname));

  IF unprotected > 0 THEN
    RAISE EXCEPTION '% table(s) still have no RLS or no policy.', unprotected;
  END IF;

  RAISE NOTICE 'every table in the seven owned schemas has RLS and at least one policy.';
  RAISE NOTICE 'NOTE: the app connects as postgres, which bypasses RLS. These bite when it stops.';
END $$;
