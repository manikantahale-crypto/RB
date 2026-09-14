--
-- A workflow version can be waiting for somebody to say yes.
--
-- `authoring.graph_versions.status` allowed compiled, live and retired. Three
-- states for four situations: a build nobody has looked at and a build somebody
-- has asked to put live were both `compiled`, so the request left no trace in
-- the one place that decides what runs.
--
-- The agent side has had this for a while -- agent_policies.status carries
-- `pending_go_live`, and admin-api has request-go-live, approve-go-live and
-- cancel-go-live-request built on it. The workflow side could not, because the
-- check constraint had nowhere to put the state. That is the whole of why
-- those two verbs were parked, and this is the line that unparks them.
--
-- WHY ON THE VERSION AND NOT ON THE WORKFLOW
--
-- Approval is of a specific build. "Put syntra.jd.workflow live" is not a
-- decision anybody can make, because it does not say which one -- and the
-- version is what a run pins and what a rollback returns to. Putting the state
-- on authoring.graphs would let the thing approved and the thing that runs
-- drift apart between the request and the answer.
--
-- ONE LIVE VERSION IS STILL ONE LIVE VERSION
--
-- `graph_versions_one_live_idx` is partial on status = 'live', so any number of
-- versions may await approval at once and exactly one can be on the air. That
-- is the right shape: proposing is cheap and reversible, promoting is neither.
--
-- SAFE TO RE-RUN.
--

ALTER TABLE authoring.graph_versions
  DROP CONSTRAINT IF EXISTS graph_versions_status_check;

ALTER TABLE authoring.graph_versions
  ADD CONSTRAINT graph_versions_status_check
  CHECK (status IN ('compiled', 'pending_go_live', 'live', 'retired'));


DO $$
BEGIN
  RAISE NOTICE 'graph_versions: % compiled, % awaiting approval, % live, % retired.',
    (SELECT count(*) FROM authoring.graph_versions WHERE status = 'compiled'),
    (SELECT count(*) FROM authoring.graph_versions WHERE status = 'pending_go_live'),
    (SELECT count(*) FROM authoring.graph_versions WHERE status = 'live'),
    (SELECT count(*) FROM authoring.graph_versions WHERE status = 'retired');
END $$;
