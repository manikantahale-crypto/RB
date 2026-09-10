--
-- Builder's own tables get a schema, and keep their old names as views.
--
-- Five tables describe the agent-shaped authoring model the admin app is built
-- on. They are nobody else's:
--
--   agent_definitions          15 rows   what an agent IS
--   agent_versions            140 rows   its compiled history
--   agent_policies            151 rows   what a person configured
--   agent_templates            15 rows   the shapes on offer
--   admin_agent_entitlements             who may edit which
--
-- They were in `public` because everything was. `builder` says whose they are,
-- which is the whole point of having schemas at all: `core` is the business,
-- `authoring` is the workflow platform, `orch` is the engine, and this is the
-- app that sits on top of them.
--
-- NOT agent_runs AND agent_steps
--
-- Those look like they belong here and do not. They are the run audit spine,
-- superseded by orch.runs in V20260909.30, and four other public tables have
-- foreign keys into agent_runs -- activities, approvals, ingestion_events,
-- match_jobs. Moving them is a different question with a different blast
-- radius, and the design's answer for them is fold-and-retire, not relocate.
--
-- SET SCHEMA, SO NOTHING IS COPIED
--
-- A catalogue rename. Rows, indexes, constraints and owned sequences all
-- follow, and there is no moment where a row exists twice or not at all. The
-- foreign keys between these five follow too, because a key references the
-- table, not the name.
--
-- THE OLD NAMES KEEP WORKING, FOR READS AND WRITES
--
-- One table per view, so each is auto-updatable: anybody still saying
-- `public.agent_policies` reads and writes the very same rows. That matters
-- here more than anywhere else -- other people are still on these tables, and
-- this move must be invisible to them.
--
-- security_invoker on every one, so a view never becomes the way around a
-- row-level security policy on what it reads.
--
-- SAFE TO RE-RUN.
--

CREATE SCHEMA IF NOT EXISTS builder;
COMMENT ON SCHEMA builder IS
  'The admin app''s own agent-shaped authoring model. Not shared: core, authoring and orch are.';


DO $$
DECLARE
  t text;
  moved int := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agent_definitions', 'agent_versions', 'agent_policies',
    'agent_templates', 'admin_agent_entitlements'
  ] LOOP
    -- Only a real table moves. Once the view exists in public, to_regclass
    -- finds the view and this must not try again.
    IF to_regclass('builder.' || t) IS NULL
       AND to_regclass('public.' || t) IS NOT NULL
       AND (SELECT c.relkind FROM pg_class c
             WHERE c.oid = ('public.' || t)::regclass) = 'r' THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA builder', t);
      moved := moved + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '% table(s) moved into builder.', moved;
END $$;


-- ═══════════════════════════════════════════ the old names, still working ══
--
-- Written out column by column rather than SELECT *, so that adding a column
-- to a builder table is a deliberate act here too. A view built with * does
-- not gain columns on its own, and one that silently disagrees with its table
-- is worse than one that visibly needs updating.
CREATE OR REPLACE VIEW public.agent_definitions
  WITH (security_invoker = true) AS SELECT * FROM builder.agent_definitions;
CREATE OR REPLACE VIEW public.agent_versions
  WITH (security_invoker = true) AS SELECT * FROM builder.agent_versions;
CREATE OR REPLACE VIEW public.agent_policies
  WITH (security_invoker = true) AS SELECT * FROM builder.agent_policies;
CREATE OR REPLACE VIEW public.agent_templates
  WITH (security_invoker = true) AS SELECT * FROM builder.agent_templates;
CREATE OR REPLACE VIEW public.admin_agent_entitlements
  WITH (security_invoker = true) AS SELECT * FROM builder.admin_agent_entitlements;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agent_definitions', 'agent_versions', 'agent_policies',
    'agent_templates', 'admin_agent_entitlements'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO postgres', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON builder.%I TO postgres', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA builder TO postgres;


DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agent_definitions', 'agent_versions', 'agent_policies',
    'agent_templates', 'admin_agent_entitlements'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM builder.%I', t) INTO n;
    RAISE NOTICE '  builder.% : % rows, readable as public.% too', t, n, t;
  END LOOP;
END $$;
