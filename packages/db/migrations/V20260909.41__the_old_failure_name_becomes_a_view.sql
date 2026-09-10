--
-- public.failed_workflows becomes a view of orch.run_failures.
--
-- V20260909.37 dropped the empty shell an already-running worker had created
-- after V20260909.33 moved the table. It came back, and this time it is not
-- empty: 20 permanent-system failures of syntra.match.workflow, written
-- between 06:39 and 07:26 on 2026-09-10 by the same older copy of this
-- repository that keeps recreating syntra.recruiter_review_items.
--
-- Those 20 are real. They are runs that failed and were recorded for replay,
-- and none of them is in orch.run_failures -- 0 shared ids -- so ops looking
-- at the failure list has been seeing 2,805 and not these. They are carried
-- across first, then the shell goes, and then the old name becomes a view so
-- the next one lands in the right place on its own.
--
-- THIS VIEW IS WRITABLE, UNLIKE public.graph_definitions
--
-- One table wearing two names, so it is auto-updatable: the old copy's INSERT
-- through `failed_workflows` writes an orch.run_failures row, and its SELECT
-- reads all of them. Nothing is lost while it stays out of date.
--
-- Its boot DDL is a different matter. CREATE TABLE IF NOT EXISTS skips
-- quietly against a view, but CREATE INDEX IF NOT EXISTS raises `cannot
-- create index on relation ... not supported for views` -- IF NOT EXISTS
-- checks the relation KIND before the name. So that copy will fail where it
-- tries to author schema, and work where it does not. That is the right way
-- round, and it is the third time today the same fix has been the answer.
--
-- SAFE TO RE-RUN.
--

-- ═══════════════════════════════════════ 1 · keep the failures it recorded ══
DO $$
DECLARE
  carried int;
BEGIN
  IF to_regclass('public.failed_workflows') IS NULL THEN
    RAISE NOTICE 'nothing to carry - public.failed_workflows does not exist.';
    RETURN;
  END IF;

  -- Separate branch, not an OR: `::regclass` on a missing name raises, and SQL
  -- does not promise to skip the second operand once the first is true.
  IF (SELECT c.relkind FROM pg_class c
       WHERE c.oid = 'public.failed_workflows'::regclass) <> 'r' THEN
    RAISE NOTICE 'public.failed_workflows is already the view.';
    RETURN;
  END IF;

  EXECUTE $q$
    INSERT INTO orch.run_failures (
      id, organization_id, event_id, thread_id, graph_key, graph_version,
      queue, error_class, error_message, pinned_payload, created_at, replayed_at)
    SELECT id, organization_id, event_id, thread_id, graph_key, graph_version,
           queue, error_class, error_message, pinned_payload, created_at, replayed_at
      FROM public.failed_workflows
    ON CONFLICT (id) DO NOTHING
  $q$;
  GET DIAGNOSTICS carried = ROW_COUNT;

  EXECUTE 'DROP TABLE public.failed_workflows';
  RAISE NOTICE 'carried % failure(s) into orch.run_failures, then dropped the shell.', carried;
END $$;


-- ══════════════════════════════════════════════ 2 · the old name still works ══
CREATE OR REPLACE VIEW public.failed_workflows
  WITH (security_invoker = true) AS
  SELECT id, organization_id, event_id, thread_id, graph_key, graph_version,
         queue, error_class, error_message, pinned_payload, created_at,
         replayed_at
    FROM orch.run_failures;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.failed_workflows TO postgres;


DO $$
BEGIN
  RAISE NOTICE 'orch.run_failures: % failures, reachable under both names.',
    (SELECT count(*) FROM orch.run_failures);
END $$;
