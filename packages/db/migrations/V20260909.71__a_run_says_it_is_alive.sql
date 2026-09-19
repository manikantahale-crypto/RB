-- A running workflow says, on a timer, that it is still running.
--
-- WHAT WAS WRONG
--
-- orch.runs has started_at and completed_at and nothing in between. A run
-- whose worker died mid-node — a crash, a deploy, a laptop lid — stays
-- RUNNING for ever: nothing finishes it, nothing notices it, and the runs
-- screen shows it as in progress until somebody edits the row by hand. The
-- old project has three such rows that showed RUNNING for six days with a
-- completion time attached (Orchestrator branch report, 24 Aug, §2.10).
--
-- The engine also had no per-node time limit. Every contract declares
-- execution.timeoutMs — it is a required field — and, like the idempotency
-- key before V20260909.59, nothing read it. A node that never returned held
-- its run, its pg-boss job and its connection for as long as the process
-- lived.
--
-- WHAT THIS DOES
--
-- One nullable column. The compiler writes now() into it when a node starts
-- and every ORCH_RUN_HEARTBEAT_MS while the node runs (30 s by default). The
-- stale-run sweeper in the worker fails any RUNNING run whose last beat is
-- older than ORCH_STALE_RUN_AFTER_MS (10 min by default) — see
-- packages/orchestrator/src/workflow/stale-runs.ts for what "fail" means.
--
-- NULL means "never beat". Runs from before this column exist; the sweeper
-- falls back to started_at for those, so an already-abandoned run is swept on
-- the first pass rather than kept alive by a column it never had.
--
-- The index is partial on RUNNING because that is the only status the
-- sweeper reads, and RUNNING rows are a handful among thousands.
--
-- SAFE TO RE-RUN.

BEGIN;

ALTER TABLE orch.runs ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;

COMMENT ON COLUMN orch.runs.heartbeat_at IS
  'Last time the worker running this run said it was alive. Written by the '
  'graph compiler at every node start and on a timer while a node runs. NULL '
  'for runs that predate V20260909.71 or never reached a node.';

CREATE INDEX IF NOT EXISTS runs_running_heartbeat_idx
  ON orch.runs (COALESCE(heartbeat_at, started_at, created_at))
  WHERE status = 'RUNNING';

DO $$
DECLARE
  running int;
  never_beat int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE heartbeat_at IS NULL)
    INTO running, never_beat
    FROM orch.runs WHERE status = 'RUNNING';
  RAISE NOTICE
    'orch.runs.heartbeat_at added. % run(s) are RUNNING now, % of them with no '
    'beat yet — the sweeper judges those by started_at.',
    running, never_beat;
END $$;

COMMIT;
