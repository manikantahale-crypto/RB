-- A binding pointing at a workflow that was retired underneath it.
--
-- WHAT WAS WRONG
--
-- `syntra.jd.received` had an ACTIVE binding to `syntra.jd.workflow`, whose
-- graph row is retired and whose only version is retired too. The router would
-- have resolved that route and enqueued onto module.syntra.jd naming a
-- workflow with no live version. Not a crash — a job that goes nowhere.
--
-- Exactly one such row existed. The other eleven active bindings all name an
-- active workflow with one live version.
--
-- WHY IT CAME BACK AFTER BEING FIXED
--
-- V20260909.54 already looked for this and RAISED A WARNING rather than an
-- exception, so the run went green and nobody acted. Then
-- R__seed_graph_event_bindings re-created the row — repeatable migrations run
-- after every versioned one, so the seed had the last word.
--
-- The seed's guard was:
--
--     JOIN authoring.graphs g ON g.graph_key = v.graph_key
--     WHERE NOT EXISTS (an active binding for this event)
--
-- which asks whether the workflow EXISTS, not whether it can run. It was
-- written to catch "nobody ever authored this" and it does; it cannot catch
-- "somebody authored it and then retired it". That file is fixed in the same
-- change, and this migration would otherwise be undone by the next run.
--
-- WHY RETIRE THE BINDING RATHER THAN REVIVE THE WORKFLOW
--
-- The chain moved on. `syntra.jd.workflow` is one step, `syntra.jd.process`,
-- which emits `syntra.jd.parsed`. SYNTRA's own API now publishes
-- `syntra.jd.parsed` directly — 57 of them, the most recent on 2026-09-09 —
-- and `syntra.jd.parsed → syntra.continuous.match` is live and working. The
-- workflow's job is being done upstream.
--
-- Meanwhile nothing has published `syntra.jd.received` since 2026-08-25. Its
-- volume was 244 from the orchestrator and 19 from node-api, all in August.
--
-- So reviving would restore a head that has been bypassed, for an event with
-- no producer. Retiring the binding states what is already true.
--
-- WHAT THIS DOES NOT DO. It does not touch the event or its catalogue row.
-- `syntra.jd.received` stays `handling = 'graph'`, which means the router looks
-- for a binding and acks when it finds none. That is the honest reading: the
-- event is real, 276 of them are on record, and nothing answers it today.
-- Making it `terminal` would say the platform intends to drop it, which is a
-- product decision nobody has taken.

BEGIN;

--
-- Retire it. Narrow on purpose: this names the one row, and the guards mean a
-- project where somebody has already fixed it by hand is left alone rather
-- than having a good binding retired underneath them.
--
UPDATE authoring.event_bindings b
   SET status = 'retired', updated_at = now()
  FROM authoring.graphs g
 WHERE g.id = b.graph_id
   AND b.status = 'active'
   AND b.event_type = 'syntra.jd.received'
   AND g.graph_key = 'syntra.jd.workflow'
   -- Only if it genuinely cannot run. If somebody has since made a version of
   -- this workflow live, the binding is correct and must survive.
   AND NOT EXISTS (
     SELECT 1 FROM authoring.graph_versions v
      WHERE v.graph_id = g.id AND v.status = 'live');

--
-- The invariant, now enforced instead of warned about.
--
-- Promoted from V20260909.54's RAISE WARNING. A warning on a green run is a
-- note nobody reads; this one was true for weeks. If a future change binds an
-- event to a workflow that cannot run, the migration should stop.
--
DO $$
DECLARE
  bad int;
  example text;
BEGIN
  SELECT count(*), min(g.graph_key || ' ← ' || b.event_type)
    INTO bad, example
    FROM authoring.event_bindings b
    JOIN authoring.graphs g ON g.id = b.graph_id
   WHERE b.status = 'active'
     AND NOT EXISTS (
       SELECT 1 FROM authoring.graph_versions v
        WHERE v.graph_id = g.id AND v.status = 'live');

  IF bad > 0 THEN
    RAISE EXCEPTION
      '% active binding(s) name a workflow with no live version, e.g. %. '
      'Such a binding routes an event onto a queue and nothing runs.',
      bad, example;
  END IF;

  RAISE NOTICE 'every active binding names a workflow that can actually run.';
END $$;

COMMIT;
