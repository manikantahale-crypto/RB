--
-- Thirteen workflows say they are live and nothing can reach them.
--
-- "Live" is recorded in two places that were never kept in step:
--
--   authoring.graph_versions.status = 'live'   the version is the one that runs
--   authoring.event_bindings.status = 'active' something can actually start it
--
-- Approving a go-live sets both, in one transaction. Taking a workflow offline
-- retired only the binding and said so in its own response: "The workflow and
-- all its versions are untouched." So the two halves drifted apart in one
-- direction only, and there was nothing to pull them back.
--
-- What that produced, in the new project:
--
--   syntra.authored          v124   262 runs, last on 1 September
--   syntra.jd.workflow       v1      15 runs, last on 13 August
--   + 11 demos and custom.* fixtures with no runs at all
--
-- The first two are real. Nobody decided they should stop being reachable;
-- their bindings were retired and the versions were left claiming otherwise.
-- Every screen that reads "live" has been reporting them as running ever
-- since, which is worse than reporting them as off: a workflow that looks
-- healthy and never fires is invisible until somebody asks why.
--
-- WHAT THIS DOES, AND WHAT IT DOES NOT
--
-- It retires the VERSION on any workflow that has no active binding. It does
-- not delete anything, does not touch bindings, and does not change what runs
-- — these workflows already do not run, which is the entire point. What
-- changes is that the record now says so.
--
-- Coming back is the ordinary route and is unchanged by this: request the
-- version, somebody else approves it, and approval re-creates the binding.
-- requestGoLive accepts a retired version for exactly this reason.
--
-- WHY THIS IS NOT A CONSTRAINT
--
-- The obvious next step is a CHECK or a trigger forbidding a live version with
-- no active binding. It cannot be written: the two rows live in different
-- tables, and a CHECK cannot see another table. A trigger could, but it would
-- fire during approve-go-live — which legitimately writes the version and the
-- binding as two statements inside one transaction, and would be refused on
-- whichever it did first.
--
-- So the invariant is held by the two code paths that move it (approve and
-- take-offline, both transactional) and reported by `npm run check:platform`.
-- The verification block below is the same query, run here.
--
-- SAFE TO RE-RUN.
--

DO $$
DECLARE
  drifted int;
  real_ones text;
BEGIN
  SELECT count(*),
         string_agg(DISTINCT g.graph_key, ', ')
                   FILTER (WHERE EXISTS (SELECT 1 FROM orch.runs r
                                          WHERE r.graph_key = g.graph_key))
    INTO drifted, real_ones
    FROM authoring.graphs g
    JOIN authoring.graph_versions v ON v.graph_id = g.id AND v.status = 'live'
   WHERE NOT EXISTS (
     SELECT 1 FROM authoring.event_bindings b
      WHERE b.graph_id = g.id AND b.status = 'active');

  IF drifted = 0 THEN
    RAISE NOTICE 'no workflow is live without a binding';
    RETURN;
  END IF;

  RAISE NOTICE '% live version(s) have no active binding', drifted;
  IF real_ones IS NOT NULL THEN
    -- Named, because these are the ones a person may want back. The other
    -- rows are fixtures that have never run.
    RAISE NOTICE 'of those, these have run before: %', real_ones;
  END IF;

  UPDATE authoring.graph_versions v
     SET status = 'retired'
    FROM authoring.graphs g
   WHERE g.id = v.graph_id
     AND v.status = 'live'
     AND NOT EXISTS (
       SELECT 1 FROM authoring.event_bindings b
        WHERE b.graph_id = g.id AND b.status = 'active');

  UPDATE authoring.graphs g
     SET status = 'retired', updated_at = now()
   WHERE g.status = 'active'
     AND NOT EXISTS (
       SELECT 1 FROM authoring.event_bindings b
        WHERE b.graph_id = g.id AND b.status = 'active')
     AND NOT EXISTS (
       SELECT 1 FROM authoring.graph_versions v
        WHERE v.graph_id = g.id AND v.status = 'live');

  RAISE NOTICE 'retired — they were already unreachable; now they say so';
END $$;


--
-- The invariant, checked rather than assumed.
--
DO $$
DECLARE
  bad int;
  example text;
BEGIN
  SELECT count(*), min(g.graph_key)
    INTO bad, example
    FROM authoring.graphs g
    JOIN authoring.graph_versions v ON v.graph_id = g.id AND v.status = 'live'
   WHERE NOT EXISTS (
     SELECT 1 FROM authoring.event_bindings b
      WHERE b.graph_id = g.id AND b.status = 'active');

  IF bad > 0 THEN
    RAISE EXCEPTION
      '% workflow(s) are still live with no active binding, e.g. %',
      bad, example;
  END IF;

  -- And the other direction: a binding pointing at nothing runnable is just
  -- as broken, and is the shape the router silently drops.
  SELECT count(*), min(g.graph_key)
    INTO bad, example
    FROM authoring.event_bindings b
    JOIN authoring.graphs g ON g.id = b.graph_id
   WHERE b.status = 'active'
     AND NOT EXISTS (
       SELECT 1 FROM authoring.graph_versions v
        WHERE v.graph_id = g.id AND v.status = 'live');

  IF bad > 0 THEN
    RAISE WARNING
      '% active binding(s) point at a workflow with no live version, e.g. % '
      '— events of that type are acked and dropped.', bad, example;
  END IF;

  RAISE NOTICE 'live now means reachable.';
END $$;
