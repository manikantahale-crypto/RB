-- A run waiting on a person has one status, and it is PARKED.
--
-- WHAT WAS WRONG
--
-- The runner wrote WAITING_APPROVAL to orch.runs and answered PARKED to its
-- caller, for the same run at the same moment (runner.ts:109 and :123 before
-- this change). Every reader then had to know both: the admin API guessed
-- "needs a human" from the string containing INTERRUPT, or equalling PAUSED,
-- or WAITING_APPROVAL, or having a thread and not being finished
-- (runtime.ts:504-510); the runs screen mapped both; the sweeper's comment
-- named one. On this project on 2026-09-19: 10 rows say WAITING_APPROVAL,
-- 2 say PARKED (copied from the old project, whose code says PARKED).
--
-- orch.runs.status also had no CHECK at all — any spelling was accepted, so
-- the split could never have been caught by the database.
--
-- WHAT THIS DOES
--
-- 1. The ten rows become PARKED. Nothing else about them changes.
-- 2. A CHECK on orch.runs.status naming the seven statuses the code writes.
--    WAITING_APPROVAL is deliberately NOT in it: a writer still using the
--    old word fails loudly instead of quietly reintroducing the split.
-- 3. An index for finding a parked run by the correlation it belongs to.
--    A decision that reaches us from outside the platform — a candidate's
--    reply through RELAY, a recruiter's click — knows which conversation it
--    is about, not which LangGraph thread. orch.runs.input_ref carries the
--    correlation_id (runner.ts:57-60) and all 12 parked rows have it.
-- 4. relay.consent.decided becomes a `resume` event in the catalogue. Its
--    own description says it "resumes consent workflow"; it was `terminal`,
--    which the router reads as "acknowledge and drop".
--
-- SAFE TO RE-RUN.

BEGIN;

UPDATE orch.runs SET status = 'PARKED' WHERE status = 'WAITING_APPROVAL';

ALTER TABLE orch.runs DROP CONSTRAINT IF EXISTS runs_status_check;
ALTER TABLE orch.runs
  ADD CONSTRAINT runs_status_check CHECK (status IN (
    'QUEUED', 'RUNNING', 'PARKED', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'
  ));

CREATE INDEX IF NOT EXISTS runs_parked_correlation_idx
  ON orch.runs ((input_ref->>'correlation_id'))
  WHERE status = 'PARKED';

UPDATE authoring.event_catalog
   SET handling = 'resume'
 WHERE event_type = 'relay.consent.decided'
   AND handling = 'terminal';

DO $$
DECLARE
  parked int;
  spellings text;
BEGIN
  SELECT count(*) INTO parked FROM orch.runs WHERE status = 'PARKED';
  SELECT string_agg(DISTINCT status, ', ' ORDER BY status) INTO spellings FROM orch.runs;
  RAISE NOTICE 'orch.runs: % run(s) PARKED; statuses in use: %', parked, spellings;
END $$;

COMMIT;
