--
-- The same accident as V20260909.35, one table along.
--
-- V20260909.33 moved public.failed_workflows to orch.run_failures with
-- SET SCHEMA, rows and all. An orchestrator worker that was already running --
-- on code from before the boot DDL was removed -- then created an empty
-- public.failed_workflows for itself, because that is what
-- CREATE TABLE IF NOT EXISTS does when the table it expects has been renamed.
--
-- It holds 0 rows. All 2,805 are in orch.run_failures. Nothing was written to
-- the shell, so unlike the review queue there is not even a duplicate to weigh
-- up: this is an empty table no migration created.
--
-- WHY THIS SHOULD BE THE LAST ONE
--
-- Both strays were made by processes running code that predated the sweep.
-- There is no CREATE TABLE, CREATE INDEX or CREATE SCHEMA left in
-- node-api/src, packages/*/src or apps/*/src -- the last one went with
-- V20260909.35 -- so no running process can author a table any more. What is
-- left is only the processes that were already up, and a restart settles those.
--
-- NO-OP ON A DATABASE BUILT FROM THESE FILES.
--
-- SAFE TO RE-RUN.
--

DO $$
DECLARE
  shell_rows int;
BEGIN
  IF to_regclass('public.failed_workflows') IS NULL THEN
    RAISE NOTICE 'nothing to remove - public.failed_workflows does not exist.';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.failed_workflows' INTO shell_rows;

  -- A row here is a failure somebody's worker recorded and nothing else knows
  -- about. It would be lost by a drop, so the drop refuses and says where to
  -- put it instead.
  IF shell_rows > 0 THEN
    RAISE EXCEPTION
      'public.failed_workflows holds % rows. They were written after the table '
      'moved, so they are not in orch.run_failures. Copy them across before '
      'dropping this.', shell_rows;
  END IF;

  EXECUTE 'DROP TABLE public.failed_workflows';
  RAISE NOTICE 'dropped the empty public.failed_workflows. orch.run_failures keeps % rows.',
    (SELECT count(*) FROM orch.run_failures);
END $$;
