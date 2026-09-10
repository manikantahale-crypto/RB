--
-- Fold agent_runs into orch.runs, so the dual write can stop.
--
-- Every workflow run has been written twice: once to orch.runs, once to
-- public.agent_runs. The second write is wrapped in try/catch and logs
-- "(fail-open)" on error, so when it fails nothing notices. It has already
-- lost rows — 9,965 runs in orch.runs against 9,929 in agent_runs — and
-- nobody would have known if it had lost all of them.
--
-- WHAT THE SECOND TABLE ACTUALLY HELD
--
-- It has six columns orch.runs does not. Measured against all 9,929 rows:
--
--   cost                 `{}` on every row. Nothing.
--   trigger_type         'EVENT' on every row — a constant in the code.
--   triggered_by         NULL on every row.
--   thread_id            organization_id || ':' || id on every row. Derived.
--   updated_at           bookkeeping.
--   agent_definition_id  5 distinct values. THE ONLY REAL COLUMN.
--
-- So the audit spine that was being maintained in parallel, at the cost of a
-- silent write on every run, was carrying one useful field.
--
-- HOW THE TWO TABLES CORRESPOND
--
-- Not by id: agent_runs generates its own and 0 ids are shared. The link is
-- buried in a json field — input_ref->>'orch_run_id' — which is why "the same
-- run in two tables" was never obvious. 9,924 of 9,929 join that way.
--
-- WHAT THIS DOES
--
-- Adds agent_definition_id to orch.runs and backfills it. The dual write is
-- removed from the code in the same change. agent_runs is left in place, with
-- its 9,929 rows, because it is dropped when the new Supabase project is
-- created rather than here.
--
-- 41 runs have no agent_runs row at all — the ones the fail-open write lost —
-- and they keep a NULL, which is the honest answer.
--
-- SAFE TO RE-RUN.
--

ALTER TABLE orch.runs ADD COLUMN IF NOT EXISTS agent_definition_id uuid;

UPDATE orch.runs r
   SET agent_definition_id = a.agent_definition_id
  FROM public.agent_runs a
 WHERE a.input_ref->>'orch_run_id' = r.id::text
   AND r.agent_definition_id IS DISTINCT FROM a.agent_definition_id;

CREATE INDEX IF NOT EXISTS runs_agent_definition_idx
  ON orch.runs (agent_definition_id) WHERE agent_definition_id IS NOT NULL;


DO $$
DECLARE
  carried int;
  orphans int;
BEGIN
  SELECT count(agent_definition_id) INTO carried FROM orch.runs;

  SELECT count(*) INTO orphans
    FROM public.agent_runs a
   WHERE NOT EXISTS (
     SELECT 1 FROM orch.runs r
      WHERE r.id::text = a.input_ref->>'orch_run_id');

  RAISE NOTICE 'orch.runs carries agent_definition_id on % runs.', carried;

  IF orphans > 0 THEN
    RAISE WARNING '% agent_runs rows point at no orch.runs row and were not folded in.', orphans;
    RAISE WARNING '   They are still in agent_runs; nothing is deleted here.';
  END IF;
END $$;
