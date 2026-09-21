-- The two things the onboarding path's stage 4 still had open on 2026-09-20,
-- now that every module with code has its contract nodes (stage 5):
--
--   4.2 ORBIT   `orbit.activity.note_requested` was catalogued with a `{}`
--               payload — the one undescribed row. Its shape is the input of
--               the node that consumes it (`orbit.activity.note`), so it is
--               written from there.
--   4.1 PRISM   no `prism.*` row existed. PRISM's seven nodes announce what
--               they recorded; each announcement is an OUTCOME (terminal — a
--               fact on the record, for the runs screen and the flow trace),
--               and one, `prism.submission.completed`, is the hand-off PRISM
--               has always been meant to make and has never fired (139
--               submissions, none RTR_CONFIRMED). Catalogued so that a
--               workflow can be bound to it the day one does.
--
-- PRISM also moves from `planned` to `beta` in platform.applications: it has
-- code, tables and nodes here. `module.prism` is its queue, so a binding
-- onto a prism.* event has somewhere to go.
--
-- Idempotent: every statement is an upsert.

-- ── 4.2 ORBIT: the one empty payload ────────────────────────────────────────
UPDATE authoring.event_catalog
   SET description    = 'COMMAND — a line for a person''s timeline: a note, a call, a status. Consumed by orbit.activity.note.',
       payload_schema = '{"type":"object","required":["candidate_id"],"properties":{"candidate_id":{"type":"string","format":"uuid","description":"the person"},"candidateId":{"type":"string","format":"uuid","description":"alias of candidate_id"},"summary":{"type":"string","description":"the line itself"},"note":{"type":"string","description":"alias of summary"},"payload":{"type":"object","description":"anything structured the line carries","additionalProperties":true}},"additionalProperties":true}'::jsonb,
       produced_when  = 'Any module with something to say about a person',
       primary_consumer = 'orbit.activity.note',
       updated_at     = now()
 WHERE event_type = 'orbit.activity.note_requested'
   AND schema_version = '1.0';

-- ── PRISM: the application is real now ──────────────────────────────────────
UPDATE platform.applications
   SET name = 'Submission & RTR control', status = 'beta'
 WHERE key = 'prism' AND status = 'planned';

INSERT INTO platform.queues (key, application, description)
VALUES ('module.prism', 'prism', 'PRISM steps: submissions, consent, masking, RTR')
ON CONFLICT (key) DO NOTHING;

-- ── 4.1 PRISM: eight events, one shape of statement each ────────────────────
INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES
  ('prism.submission.opened', '1.0', 'prism',
   'OUTCOME — a submission was opened (DRAFT), or the pair''s active one was found.',
   '{"type":"object","required":["submission_id","candidate_id","jobId","status","created"],"properties":{"submission_id":{"type":"string","format":"uuid"},"candidate_id":{"type":"string","format":"uuid"},"jobId":{"type":"string","format":"uuid"},"requirement_id":{"type":"string","format":"uuid"},"status":{"type":"string"},"created":{"type":"boolean","description":"false when the pair already had an active submission"}},"additionalProperties":false}'::jsonb,
   '{}'::jsonb,
   'prism.submission.open', 'terminal', 'public', 'terminal', 'active'),

  ('prism.consent.recorded', '1.0', 'prism',
   'OUTCOME — a candidate''s consent answer was written on their submission (or could not be placed).',
   '{"type":"object","required":["response","status"],"properties":{"submission_id":{"type":["string","null"],"format":"uuid"},"candidate_id":{"type":["string","null"],"format":"uuid"},"jobId":{"type":["string","null"],"format":"uuid"},"response":{"type":"string","enum":["ACCEPTED","REJECTED"]},"status":{"type":"string","description":"success | already_processed | ambiguous_or_not_found"},"new_status":{"type":["string","null"]}},"additionalProperties":false}'::jsonb,
   '{}'::jsonb,
   'prism.consent.record', 'terminal', 'public', 'terminal', 'active'),

  ('prism.profile.masked', '1.0', 'prism',
   'OUTCOME — the masked profile was built on a validated submission; what relay.profile.send takes.',
   '{"type":"object","required":["submission_id","status","masked_profile"],"properties":{"submission_id":{"type":"string","format":"uuid"},"status":{"type":"string"},"masked_profile":{"type":"object","additionalProperties":true}},"additionalProperties":false}'::jsonb,
   '{}'::jsonb,
   'prism.profile.mask', 'terminal', 'public', 'terminal', 'active'),

  ('prism.vendor.recorded', '1.0', 'prism',
   'OUTCOME — the vendor''s accept or reject was written on the submission.',
   '{"type":"object","required":["response","status"],"properties":{"submission_id":{"type":["string","null"],"format":"uuid"},"candidate_id":{"type":["string","null"],"format":"uuid"},"jobId":{"type":["string","null"],"format":"uuid"},"response":{"type":"string","enum":["ACCEPTED","REJECTED"]},"status":{"type":"string"},"new_status":{"type":["string","null"]}},"additionalProperties":false}'::jsonb,
   '{}'::jsonb,
   'prism.vendor.record', 'terminal', 'public', 'terminal', 'active'),

  ('prism.submission.transitioned', '1.0', 'prism',
   'OUTCOME — a submission moved to a status its lifecycle allows. Recorded, never sent.',
   '{"type":"object","required":["submission_id","new_status","status"],"properties":{"submission_id":{"type":"string","format":"uuid"},"previous_status":{"type":["string","null"]},"new_status":{"type":"string"},"status":{"type":"string","description":"success | already_processed"}},"additionalProperties":false}'::jsonb,
   '{}'::jsonb,
   'prism.submission.transition', 'terminal', 'public', 'terminal', 'active'),

  ('prism.rtr.recorded', '1.0', 'prism',
   'OUTCOME — the Right-To-Represent came back signed or declined.',
   '{"type":"object","required":["rtr_status","status"],"properties":{"submission_id":{"type":["string","null"],"format":"uuid"},"jobId":{"type":["string","null"],"format":"uuid"},"rtr_status":{"type":"string","enum":["SIGNED","DECLINED"]},"status":{"type":"string"},"new_status":{"type":["string","null"]}},"additionalProperties":false}'::jsonb,
   '{}'::jsonb,
   'prism.rtr.record', 'terminal', 'public', 'terminal', 'active'),

  ('prism.confirmation.recorded', '1.0', 'prism',
   'OUTCOME — the consultant''s or the vendor''s rate/availability confirmation was written.',
   '{"type":"object","required":["party","confirmation_status","status"],"properties":{"submission_id":{"type":["string","null"],"format":"uuid"},"party":{"type":"string","enum":["CONSULTANT","VENDOR"]},"confirmation_status":{"type":"string","enum":["CONFIRMED","DECLINED"]},"status":{"type":"string"},"new_status":{"type":["string","null"]}},"additionalProperties":false}'::jsonb,
   '{}'::jsonb,
   'prism.confirmation.record', 'terminal', 'public', 'terminal', 'active'),

  ('prism.submission.completed', '1.0', 'prism',
   'HAND-OFF — a submission reached RTR_CONFIRMED. Emitted by prism.workflow.service.js; has never fired (no submission has reached it). Bind a workflow here when one should.',
   '{"type":"object","required":["submission_id","candidate_id","jobId"],"properties":{"submission_id":{"type":"string","format":"uuid"},"candidate_id":{"type":"string","format":"uuid"},"jobId":{"type":"string","format":"uuid"},"status":{"type":"string"}},"additionalProperties":true}'::jsonb,
   '{}'::jsonb,
   'prism.workflow.service (RTR_CONFIRMED)', NULL, 'public', 'graph', 'active')
ON CONFLICT (event_type, schema_version) DO UPDATE SET
  application      = EXCLUDED.application,
  description      = EXCLUDED.description,
  payload_schema   = EXCLUDED.payload_schema,
  envelope_fields  = EXCLUDED.envelope_fields,
  produced_when    = EXCLUDED.produced_when,
  primary_consumer = EXCLUDED.primary_consumer,
  visibility       = EXCLUDED.visibility,
  handling         = EXCLUDED.handling,
  status           = EXCLUDED.status,
  updated_at       = now();

-- ── Said out loud ───────────────────────────────────────────────────────────
DO $$
DECLARE
  prism_rows int;
  orbit_ok   boolean;
BEGIN
  SELECT count(*) INTO prism_rows FROM authoring.event_catalog WHERE event_type LIKE 'prism.%' AND status = 'active';
  SELECT payload_schema <> '{}'::jsonb INTO orbit_ok FROM authoring.event_catalog
   WHERE event_type = 'orbit.activity.note_requested' AND schema_version = '1.0';
  IF prism_rows < 8 THEN
    RAISE EXCEPTION 'expected 8 active prism.* rows, found %', prism_rows;
  END IF;
  IF orbit_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'orbit.activity.note_requested still has an empty payload (or no row)';
  END IF;
  RAISE NOTICE 'prism.* catalogued (% rows); orbit.activity.note_requested described; module.prism queue present.', prism_rows;
END $$;
