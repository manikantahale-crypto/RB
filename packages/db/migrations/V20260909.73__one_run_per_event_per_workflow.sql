-- One event starts one workflow at most once.
--
-- WHAT WAS WRONG
--
-- The runner checked for an existing run on (trigger_event_id, graph_key)
-- and then either restarted it or inserted a new one — two statements, no
-- lock, no uniqueness. Two workers handed the same event for the same
-- workflow (ingress is at-least-once; a job retried after the worker died
-- between finishing and acknowledging) could both read "no run" and both
-- insert. And a run that had COMPLETED was restarted on redelivery as if it
-- had not: status back to RUNNING, completed_at cleared, the graph invoked
-- again on a finished thread. Node idempotency (V20260909.59) protects the
-- module calls; it does not protect a pure step — a human gate run again
-- asks for approval again.
--
-- The other branch answers this with a `processed_events (event_id,
-- consumer)` table created at worker start. We do not need a second record
-- of what orch.runs already records: the run row IS the fact that this
-- consumer took this event. It only has to be unique.
--
-- Measured on 2026-09-19: 4,164 runs, 0 with a null trigger, 0 pairs of
-- (trigger_event_id, graph_key) that occur more than once. The index can go
-- on without touching a row.
--
-- WHAT THIS DOES
--
-- A unique index on (trigger_event_id, graph_key). The runner's start
-- becomes one INSERT ... ON CONFLICT DO UPDATE ... WHERE, which is a claim:
-- it returns the row when this delivery may run — new, or a FAILED/RUNNING
-- attempt being retried — and nothing when the run already COMPLETED,
-- PARKED, CANCELLED or EXPIRED, in which case the delivery is declined
-- (workflow/agent-runs.ts claimRun).
--
-- SAFE TO RE-RUN.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS runs_one_per_event_and_workflow
  ON orch.runs (trigger_event_id, graph_key)
  WHERE trigger_event_id IS NOT NULL;

DO $$
DECLARE
  runs int;
BEGIN
  SELECT count(*) INTO runs FROM orch.runs WHERE trigger_event_id IS NOT NULL;
  RAISE NOTICE 'orch.runs: one run per (event, workflow) enforced over % run(s).', runs;
END $$;

COMMIT;
