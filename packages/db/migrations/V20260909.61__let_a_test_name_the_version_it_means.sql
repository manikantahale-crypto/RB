-- Let a fired event say which version it is meant to run.
--
-- WHAT WAS WRONG
--
-- Screen 5 is called "Test", and it fires a real event through the real front
-- door. The router then resolves the binding, which names the LIVE version —
-- so testing an edit ran the version already in production, not the one on
-- screen. The screen warned about it; the button still said Test.
--
-- A draft has no binding at all, so a brand-new workflow could not be tried
-- even in principle: the event was acked and dropped, or it ran somebody
-- else's workflow.
--
-- WHY A COLUMN AND NOT A FIELD IN THE PAYLOAD
--
-- `payload_ref` is the event's own contract — it is validated against the
-- event's declared schema and read by the first step. Putting routing
-- instructions in there would make every consumer's payload depend on how the
-- event happened to be fired, and would leak a test concern into a business
-- one. This is metadata ABOUT the delivery, so it sits beside `producer` and
-- `correlation_id`, which are the same kind of thing.
--
-- WHY THE WHOLE ROUTE AND NOT JUST A VERSION NUMBER
--
-- The common case is a workflow that has never been live. There is no binding
-- to take a queue or a graph key from, so a version alone would name a version
-- of nothing. Carrying all three is what makes "I just wrote this, let me try
-- it" work, which is the case this exists for.
--
-- WHAT IT DOES NOT DO. It does not skip ingress, the outbox, the relay or the
-- router — the whole delivery path still runs, which is the point: the thing
-- most likely to be wrong about a new workflow is whether anything reaches it.
-- It only replaces the router's ANSWER about where this one event goes.
--
-- The column is null for every event any real producer writes, and nothing
-- reads it unless it is set.

BEGIN;

ALTER TABLE orch.event_outbox
  ADD COLUMN IF NOT EXISTS test_pin jsonb;

COMMENT ON COLUMN orch.event_outbox.test_pin IS
  'Set only by an authoring test fire: {graphKey, graphVersion, moduleQueue}. '
  'The router sends this one event there instead of resolving a binding. Null '
  'on everything a real producer writes.';

--
-- A pin is all three parts or it is not a pin.
--
-- A half-filled one would route to a queue with no graph, or name a graph with
-- no queue to run it on — both of which fail later and further away, which is
-- where routing faults are hardest to read.
--
ALTER TABLE orch.event_outbox
  DROP CONSTRAINT IF EXISTS event_outbox_test_pin_ck;
--
-- `IS TRUE`, and it is not decoration.
--
-- A CHECK passes when it evaluates to NULL, and a missing key makes every
-- comparison here NULL: `test_pin->'graphKey'` is SQL NULL, `jsonb_typeof` of
-- that is NULL, and `NULL = 'string'` is NULL. Written without this, the
-- constraint accepted `{"graphVersion": 4}` — precisely the half-filled pin it
-- exists to refuse. Caught by the test that tried to insert one.
--
ALTER TABLE orch.event_outbox
  ADD CONSTRAINT event_outbox_test_pin_ck CHECK (
    test_pin IS NULL
    OR (
      jsonb_typeof(test_pin->'graphKey') = 'string'
      AND jsonb_typeof(test_pin->'graphVersion') = 'number'
      AND jsonb_typeof(test_pin->'moduleQueue') = 'string'
    ) IS TRUE
  );

DO $$
DECLARE
  pinned int;
BEGIN
  SELECT count(*) INTO pinned FROM orch.event_outbox WHERE test_pin IS NOT NULL;
  RAISE NOTICE 'test_pin is available; % existing event(s) carry one.', pinned;
END $$;

COMMIT;
