--
-- Two more tables out of `public`.
--
-- Both are orchestrator- or authoring-owned and were only in `public` because
-- everything was, before there were schemas to put things in.
--
--   public.failed_workflows  ->  orch.run_failures     2,805 rows
--   public.node_registry     ->  authoring.node_registry  22 rows
--
-- SAFE TO RE-RUN.
--

-- ══════════════════════════════════════ failed_workflows -> run_failures ══
--
-- SET SCHEMA moves the table with its rows, indexes and constraints intact —
-- it is a rename, not a copy, so there is no window where the data exists
-- twice or not at all. Nothing outside the orchestrator references it.
--
-- `run_failures` is the design's name and the better one: the table holds runs
-- that failed, not workflows that are broken. A workflow whose every run fails
-- is a different thing from a workflow that failed once on bad input, and the
-- old name suggested the first.
DO $$
BEGIN
  IF to_regclass('public.failed_workflows') IS NOT NULL
     AND to_regclass('orch.run_failures') IS NULL THEN
    ALTER TABLE public.failed_workflows SET SCHEMA orch;
    ALTER TABLE orch.failed_workflows RENAME TO run_failures;
    RAISE NOTICE 'public.failed_workflows -> orch.run_failures';
  END IF;
END $$;


-- ══════════════════════════════════════════════════════ node_registry ══
--
-- authoring.node_registry has been kept current by a mirror since
-- V20260909.25. The generator is about to write it directly, so the mirror
-- comes off — two writers and a trigger between them is how a loop starts.
--
-- public.node_registry is left in place, unread, until the new project is
-- created. It is 22 rows and dropping it now would break nothing, but it would
-- also prove nothing.
DROP TRIGGER IF EXISTS node_registry_mirror_authoring ON public.node_registry;

-- Anything the generator wrote since the last mirror run.
INSERT INTO authoring.node_registry (
  registry_key, key, version, application, shareable, title, description, tags,
  input_schema, output_schema, config_schema, admin_exposed, side_effect,
  idempotency, execution, llm, dependencies, persistence, fixture_names,
  has_stub, emits, source, checksum, updated_at)
SELECT n.registry_key, n.key, n.version,
       (SELECT a.key FROM platform.applications a WHERE a.key = n.module),
       n.shareable, n.title, n.description, n.tags, n.input_schema,
       n.output_schema, n.config_schema, n.admin_exposed, n.side_effect,
       n.idempotency, n.execution, n.llm, n.dependencies, n.persistence,
       n.fixture_names, n.has_stub, n.emits, n.source, n.checksum, n.updated_at
  FROM public.node_registry n
ON CONFLICT (registry_key) DO UPDATE SET
  version = EXCLUDED.version, title = EXCLUDED.title,
  description = EXCLUDED.description, input_schema = EXCLUDED.input_schema,
  output_schema = EXCLUDED.output_schema, config_schema = EXCLUDED.config_schema,
  admin_exposed = EXCLUDED.admin_exposed, emits = EXCLUDED.emits,
  checksum = EXCLUDED.checksum, updated_at = EXCLUDED.updated_at;


DO $$
BEGIN
  RAISE NOTICE 'orch.run_failures: % rows. authoring.node_registry: % nodes.',
    (SELECT count(*) FROM orch.run_failures),
    (SELECT count(*) FROM authoring.node_registry);
END $$;
