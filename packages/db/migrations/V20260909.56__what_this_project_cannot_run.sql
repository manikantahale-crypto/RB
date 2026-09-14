--
-- Five live workflows reference steps this repository has no code for.
--
-- The new project carries the three focus applications: authoring, the
-- orchestrator, and SYNTRA. The copy brought every workflow across, including
-- other teams', and `authoring.node_registry` is materialised from the
-- contracts in THIS repository — so a workflow whose steps live elsewhere is
-- bound, live, consuming events, and failing at the first step it cannot find.
--
--   interview.session.workflow            9 runs   6 failed
--   interview.session.ended.workflow      2 runs
--   interview.session.completed.workflow  2 runs
--   relay.consent.workflow                0 runs
--   relay.intake.workflow             4,911 runs   3,353 completed  ← NOT TOUCHED
--
-- RELAY.INTAKE IS THE REASON THIS IS NOT A ONE-LINE DELETE.
--
-- It reports one missing step, `orch.switch`, and it has completed 3,353 runs
-- and was running two days ago. Whatever serves that node, it works. Judging
-- it by the registry alone would have deleted live production traffic on the
-- strength of a registry gap. The registry says what is DECLARED, not what
-- runs, and the two are not the same thing.
--
-- RETIRE WHAT HAS HISTORY. DELETE WHAT HAS NONE.
--
-- The three interview workflows have run thirteen times between them. Deleting
-- them would leave thirteen rows in `orch.runs` naming a workflow that does not
-- exist — history nobody can explain. Retiring stops them consuming events,
-- keeps the record, and is undone by a request and an approval.
--
-- Everything deleted below has never run, has no live version, and is bound to
-- nothing: `syntra.zz-repro.workflow`, `syntra.axzzz.workflow`,
-- `test.resume.workflow` and eighteen more like them. They are somebody's
-- scratch work from before the migration.
--
-- EVENTS ARE MOSTLY NOT DELETABLE, AND THAT IS CORRECT. `orch.event_outbox`
-- has a foreign key to the catalogue, so an event anything has ever published
-- cannot be removed — 12 of the 16 interview and relay events are protected
-- that way. The four that were never published go.
--
-- SAFE TO RE-RUN.
--

DO $$
DECLARE
  unrunnable text[];
  retired_count int := 0;
  deleted_count int := 0;
  doomed uuid[];
BEGIN
  -- ── which live workflows name a step that is in no registry ────────────
  SELECT coalesce(array_agg(DISTINCT g.graph_key), '{}')
    INTO unrunnable
    FROM authoring.graphs g
    JOIN authoring.graph_versions v ON v.graph_id = g.id AND v.status = 'live'
   WHERE EXISTS (
           SELECT 1
             FROM jsonb_array_elements(v.definition->'nodes') s
            WHERE s->>'impl' NOT IN (SELECT key FROM authoring.node_registry))
     -- The evidence that beats the registry: it has completed runs, so
     -- something is serving those steps whatever the registry says.
     AND NOT EXISTS (
           SELECT 1 FROM orch.runs r
            WHERE r.graph_key = g.graph_key AND r.status = 'COMPLETED');

  IF array_length(unrunnable, 1) > 0 THEN
    RAISE NOTICE 'cannot run here: %', array_to_string(unrunnable, ', ');
  END IF;

  -- ── retire the ones that have history ──────────────────────────────────
  WITH stopped AS (
    UPDATE authoring.event_bindings b
       SET status = 'retired', updated_at = now()
      FROM authoring.graphs g
     WHERE g.id = b.graph_id
       AND g.graph_key = ANY(unrunnable)
       AND b.status = 'active'
       AND EXISTS (SELECT 1 FROM orch.runs r WHERE r.graph_key = g.graph_key)
    RETURNING b.graph_id)
  SELECT count(*) INTO retired_count FROM stopped;

  UPDATE authoring.graph_versions v
     SET status = 'retired'
    FROM authoring.graphs g
   WHERE g.id = v.graph_id
     AND g.graph_key = ANY(unrunnable)
     AND v.status = 'live'
     AND EXISTS (SELECT 1 FROM orch.runs r WHERE r.graph_key = g.graph_key);

  UPDATE authoring.graphs g
     SET status = 'retired', updated_at = now()
   WHERE g.graph_key = ANY(unrunnable)
     AND g.status = 'active'
     AND EXISTS (SELECT 1 FROM orch.runs r WHERE r.graph_key = g.graph_key);

  -- ── delete everything with no history at all ───────────────────────────
  --
  -- Two ways to qualify, and NEVER HAVING RUN is required for both:
  --
  --   nothing live and nothing bound   — scratch work from before the copy
  --   or named above as unrunnable     — live, but its steps do not exist here
  --
  -- The second clause was written inside the NOT EXISTS on the first attempt,
  -- where it silently changed the meaning to "has no live version that is not
  -- unrunnable" — which is not a sentence anybody means.
  SELECT coalesce(array_agg(g.id), '{}')
    INTO doomed
    FROM authoring.graphs g
   WHERE NOT EXISTS (SELECT 1 FROM orch.runs r WHERE r.graph_key = g.graph_key)
     AND (
       g.graph_key = ANY(unrunnable)
       OR NOT EXISTS (SELECT 1 FROM authoring.graph_versions v
                       WHERE v.graph_id = g.id AND v.status = 'live')
     );

  deleted_count := coalesce(array_length(doomed, 1), 0);

  IF deleted_count > 0 THEN
    DELETE FROM authoring.plan_steps     WHERE graph_id = ANY(doomed);
    DELETE FROM authoring.event_bindings WHERE graph_id = ANY(doomed);
    DELETE FROM authoring.graph_versions WHERE graph_id = ANY(doomed);
    DELETE FROM authoring.graphs         WHERE id       = ANY(doomed);
  END IF;

  RAISE NOTICE 'retired % binding(s) with history, deleted % workflow(s) with none',
    retired_count, deleted_count;
END $$;


--
-- Catalogue entries nothing has ever published and nothing answers.
--
DO $$
DECLARE
  gone int;
BEGIN
  WITH removed AS (
    DELETE FROM authoring.event_catalog ec
     WHERE ec.application IN ('interview', 'relay')
       AND NOT EXISTS (SELECT 1 FROM orch.event_outbox o
                        WHERE o.event_type = ec.event_type)
       AND NOT EXISTS (SELECT 1 FROM authoring.event_bindings b
                        WHERE b.event_type = ec.event_type AND b.status = 'active')
    RETURNING 1)
  SELECT count(*) INTO gone FROM removed;

  RAISE NOTICE '% never-published event(s) removed from the catalogue', gone;
END $$;


--
-- Nothing that runs may have been taken away.
--
DO $$
DECLARE
  orphaned int;
  relay_ok int;
BEGIN
  /*
   * ONLY WHAT THIS MIGRATION COULD HAVE REMOVED.
   *
   * The first version asked "are there any runs whose workflow is missing",
   * and there already were: `test-graph` has 29 runs and has had no workflow
   * row for as long as the table has existed. So the check failed on debris it
   * did not create, rolled the whole migration back, and reported deleted
   * history that was never deleted.
   *
   * A verification that fails on a pre-existing condition is not a
   * verification — it is an alarm nobody can clear, and the next person makes
   * it pass by deleting the check.
   *
   * Everything this migration deletes has zero runs by construction, so the
   * honest question is narrower: did anything with runs lose its workflow in
   * one of the applications this touched?
   */
  SELECT count(DISTINCT r.graph_key) INTO orphaned
    FROM orch.runs r
   WHERE (r.graph_key LIKE 'interview.%' OR r.graph_key LIKE 'relay.%')
     AND NOT EXISTS (SELECT 1 FROM authoring.graphs g
                      WHERE g.graph_key = r.graph_key);

  IF orphaned > 0 THEN
    RAISE EXCEPTION
      '% workflow(s) with recorded runs no longer exist. History was deleted.',
      orphaned;
  END IF;

  SELECT count(*) INTO relay_ok
    FROM authoring.graphs g
    JOIN authoring.graph_versions v ON v.graph_id = g.id AND v.status = 'live'
    JOIN authoring.event_bindings b ON b.graph_id = g.id AND b.status = 'active'
   WHERE g.graph_key = 'relay.intake.workflow';

  IF relay_ok <> 1 THEN
    RAISE EXCEPTION
      'relay.intake.workflow is no longer live and bound. It has 3,353 completed '
      'runs and must not have been touched.';
  END IF;

  RAISE NOTICE 'every workflow with runs still exists; relay.intake is untouched.';
END $$;
