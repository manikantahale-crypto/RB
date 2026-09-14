-- Two events that carry a consistent payload and declare none of it.
--
-- WHY AN UNDESCRIBED PAYLOAD IS NOT A DOCUMENTATION PROBLEM
--
-- Three separate mechanisms read `event_catalog.payload_schema` and every one
-- of them goes quiet when it is empty. None of them fails; they all report
-- "cannot check", which is honest and useless:
--
--   1. The go-live gate's `inputs_available` check. `gate-evidence` sets
--      `triggerDeclared = triggerFields.length > 0`, so a workflow on one of
--      these events is approved without anyone asking whether its steps can
--      get what they need.
--
--   2. Node idempotency. The key is read out of the trigger payload, so an
--      event with no declared fields produced no key, and
--      `syntra.match.process` — the last of eight — was never deduplicated.
--
--   3. Screen 2's trigger ranking, which scores a candidate by whether its
--      payload feeds the first step. An undescribed payload ranks as unknown.
--
-- So one empty schema quietly disables a check, a guard and a ranking.
--
-- WHAT THE FIELDS ARE, AND WHERE THEY COME FROM
--
-- Not invented, and not copied from a node's expectations — read from what
-- these events have actually carried:
--
--   syntra.match.requested        2,735 events. candidateId, jobId, resumeId
--                                 on every single one; skillMatchScore and
--                                 matchId on 2,732.
--   orbit.activity.note_requested 26 events. candidate_id, requested_by,
--                                 summary and payload on all 26.
--
-- Two fields are deliberately left out. `status` and `syntra` appear on three
-- of 2,735 `syntra.match.requested` events — a different producer's shape, not
-- the contract. `additionalProperties` stays true, so they are still accepted;
-- they are just not promised.
--
-- NOTHING CAN START REJECTING TRAFFIC BECAUSE OF THIS.
--
-- Ingress validates against `eventPayloadSchemas` in
-- `packages/orchestrator/src/contracts/payloads.ts`, a code-side map — not
-- this table. This column is read by the authoring platform only. And no
-- `required` array is added: the checks that read this look at `properties`,
-- so declaring fields required would change nothing except what a future
-- reader believes is guaranteed.
--
-- WHAT TO EXPECT AFTERWARDS. `inputs_available` starts running for workflows
-- on these two triggers. `syntra.match.workflow` should PASS — its step needs
-- `resumeId` and `jobId`, and the trigger has carried both 2,735 times.

BEGIN;

UPDATE authoring.event_catalog
   SET payload_schema = jsonb_build_object(
         '$schema', 'https://json-schema.org/draft/2020-12/schema',
         'title', 'syntra.match.requested payload',
         'type', 'object',
         'additionalProperties', true,
         'properties', jsonb_build_object(
           'jobId',           jsonb_build_object('type', 'string', 'description', 'The requirement being matched.'),
           'resumeId',        jsonb_build_object('type', 'string', 'description', 'The resume being matched against it.'),
           'candidateId',     jsonb_build_object('type', 'string', 'description', 'Who the resume belongs to.'),
           'matchId',         jsonb_build_object('type', 'string', 'description', 'The match row this request corresponds to.'),
           'skillMatchScore', jsonb_build_object('type', 'number', 'description', 'Score the producer already computed, when it shortlisted before asking.')
         )),
       updated_at = now()
 WHERE event_type = 'syntra.match.requested'
   -- Only if still undescribed. Somebody may have written a better one.
   AND coalesce(payload_schema->'properties', '{}'::jsonb) = '{}'::jsonb;

UPDATE authoring.event_catalog
   SET payload_schema = jsonb_build_object(
         '$schema', 'https://json-schema.org/draft/2020-12/schema',
         'title', 'orbit.activity.note_requested payload',
         'type', 'object',
         'additionalProperties', true,
         'properties', jsonb_build_object(
           'candidate_id', jsonb_build_object('type', 'string', 'description', 'Who the note is about.'),
           'requested_by', jsonb_build_object('type', 'string', 'description', 'The person recording it.'),
           'summary',      jsonb_build_object('type', 'string', 'description', 'The note itself, as free text.'),
           'payload',      jsonb_build_object('type', 'object', 'description', 'Anything structured the caller attached. Empty on every observed event.')
         )),
       updated_at = now()
 WHERE event_type = 'orbit.activity.note_requested'
   AND coalesce(payload_schema->'properties', '{}'::jsonb) = '{}'::jsonb;

--
-- What is left, said out loud rather than left for someone to rediscover.
--
DO $$
DECLARE
  silent int;
  names  text;
BEGIN
  SELECT count(*), string_agg(c.event_type, ', ' ORDER BY c.event_type)
    INTO silent, names
    FROM authoring.event_catalog c
   WHERE coalesce(c.payload_schema->'properties', '{}'::jsonb) = '{}'::jsonb
     AND EXISTS (SELECT 1 FROM orch.event_outbox o WHERE o.event_type = c.event_type);

  IF silent > 0 THEN
    RAISE WARNING
      '% event(s) still carry traffic with no described payload: %', silent, names;
  ELSE
    RAISE NOTICE
      'every event that has ever been published now describes what it carries.';
  END IF;
END $$;

COMMIT;
