--
-- ASTRA, RELAY and INTERVIEW leave the new project.
--
-- The new project carries three things: the authoring platform, the
-- orchestrator, and SYNTRA. The copy brought every application's data across
-- because the copy was not selective, so this project has been holding three
-- other teams' workflows, events and history since it was filled.
--
-- NONE OF IT IS LIVE HERE, AND THE DATES PROVE IT. The newest run of anything
-- in this database is 2026-09-11 20:05, which is when the copy ran. Nothing has
-- executed since. What looked like RELAY doing 3,353 completed runs "two days
-- ago" was the old project's history wearing a new project's timestamps —
-- read as live traffic once in review, which is exactly the mistake this
-- comment exists to stop somebody repeating.
--
-- The old project still holds every row of it. Those teams' code still points
-- there, their foreign keys reach tables that stayed there, and nothing below
-- touches that database. This is a copy being narrowed to its purpose, not
-- data being destroyed.
--
-- WHAT GOES
--
--   workflows and versions   astra.* relay.* interview.*
--   their bindings           including one that matters, below
--   their catalogue events   and the outbox rows that reference them
--   their runs               and the steps and node executions that cascade
--
-- WHAT STAYS, AND WHY IT LOOKS LIKE IT SHOULD NOT
--
--   duplicate.review   SYNTRA workflows whose keys do not start with syntra.
--   resume.intake      Judging by the prefix would delete both. They run
--                      SYNTRA nodes and answer SYNTRA events.
--   orbit.*            Not named for removal. Four live workflows, 87 runs,
--                      nothing since 26 August. Same category as these three
--                      and a separate decision.
--
-- ONE REAL CONSEQUENCE, STATED RATHER THAN DISCOVERED LATER
--
-- `syntra.jd.received` is bound to `astra.requirement.workflow`. It has been
-- published 276 times, and ASTRA's intake is what answers it. After this, that
-- event has no consumer: a requirement arriving from any channel will be
-- acknowledged and dropped.
--
-- That is not a fault introduced here — it is a dependency that was always
-- there and is now visible. SYNTRA needs its own answer to jd.received, or the
-- event needs retiring. `npm run check:platform` will report it as an event
-- nothing answers until one of those happens.
--
-- SAFE TO RE-RUN.
--

DO $$
DECLARE
  gone_runs int := 0;
  gone_events int := 0;
  gone_flows int := 0;
  gone_catalog int := 0;
  doomed uuid[];
BEGIN
  -- ── history first: runs reference graph_versions ──────────────────────
  DELETE FROM orch.run_failures
   WHERE graph_key ~ '^(astra|relay|interview)\.';

  WITH removed AS (
    DELETE FROM orch.runs
     WHERE graph_key ~ '^(astra|relay|interview)\.'
    RETURNING 1)
  SELECT count(*) INTO gone_runs FROM removed;
  -- orch.steps and orch.node_executions cascade from orch.runs.

  -- ── the outbox references the catalogue, so it goes before it ─────────
  WITH removed AS (
    DELETE FROM orch.event_outbox
     WHERE event_type ~ '^(astra|relay|interview)\.'
        OR event_type = 'ASTRA_JOB_MATCH_DISCOVERED'
    RETURNING 1)
  SELECT count(*) INTO gone_events FROM removed;

  -- ── the workflows ─────────────────────────────────────────────────────
  SELECT coalesce(array_agg(id), '{}')
    INTO doomed
    FROM authoring.graphs
   WHERE graph_key ~ '^(astra|relay|interview)\.';

  gone_flows := coalesce(array_length(doomed, 1), 0);

  IF gone_flows > 0 THEN
    DELETE FROM authoring.plan_steps     WHERE graph_id = ANY(doomed);
    DELETE FROM authoring.event_bindings WHERE graph_id = ANY(doomed);
    DELETE FROM authoring.graph_versions WHERE graph_id = ANY(doomed);
    DELETE FROM authoring.graphs         WHERE id       = ANY(doomed);
    -- graph_drafts cascades.
  END IF;

  -- ── the catalogue, last, now that nothing references it ───────────────
  WITH removed AS (
    DELETE FROM authoring.event_catalog
     WHERE (application IN ('astra', 'relay', 'interview')
            OR event_type = 'ASTRA_JOB_MATCH_DISCOVERED')
       AND NOT EXISTS (SELECT 1 FROM orch.event_outbox o
                        WHERE o.event_type = event_catalog.event_type)
       AND NOT EXISTS (SELECT 1 FROM authoring.event_bindings b
                        WHERE b.event_type = event_catalog.event_type)
    RETURNING 1)
  SELECT count(*) INTO gone_catalog FROM removed;

  RAISE NOTICE
    'removed % workflow(s), % run(s), % outbox event(s), % catalogue entr(ies)',
    gone_flows, gone_runs, gone_events, gone_catalog;
END $$;


--
-- What is left has to be coherent: SYNTRA intact, nothing dangling.
--
DO $$
DECLARE
  leftover int;
  orphan_runs int;
  kept text;
  unanswered int;
BEGIN
  SELECT count(*) INTO leftover
    FROM authoring.graphs
   WHERE graph_key ~ '^(astra|relay|interview)\.';
  IF leftover > 0 THEN
    RAISE EXCEPTION '% workflow(s) of those applications remain.', leftover;
  END IF;

  -- A run whose graph_version is gone would be a broken foreign key.
  SELECT count(*) INTO orphan_runs
    FROM orch.runs r
   WHERE r.graph_key ~ '^(astra|relay|interview)\.';
  IF orphan_runs > 0 THEN
    RAISE EXCEPTION '% run(s) of those applications remain.', orphan_runs;
  END IF;

  -- The two SYNTRA workflows whose keys do not say so.
  SELECT string_agg(graph_key, ', ') INTO kept
    FROM authoring.graphs
   WHERE graph_key IN ('duplicate.review', 'resume.intake');
  IF kept IS NULL THEN
    RAISE EXCEPTION
      'duplicate.review and resume.intake are gone. They are SYNTRA workflows '
      'and were judged by their prefix.';
  END IF;
  RAISE NOTICE 'kept, as intended: %', kept;

  -- Named, not hidden: events SYNTRA still publishes that nothing answers.
  SELECT count(*) INTO unanswered
    FROM authoring.event_catalog ec
   WHERE ec.application = 'syntra'
     AND EXISTS (SELECT 1 FROM orch.event_outbox o WHERE o.event_type = ec.event_type)
     AND NOT EXISTS (SELECT 1 FROM authoring.event_bindings b
                      WHERE b.event_type = ec.event_type AND b.status = 'active');

  RAISE NOTICE
    '% SYNTRA event(s) have been published and now have no workflow answering them.',
    unanswered;
END $$;
