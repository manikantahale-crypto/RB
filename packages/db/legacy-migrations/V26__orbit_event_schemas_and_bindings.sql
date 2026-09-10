-- V26: ORBIT workforce/bench event contracts + graph bindings (independent of ASTRA).
-- Idempotent. Columns match V18/V23 (org_id, status, source, version).

INSERT INTO event_schemas (
  event_type, schema_version, description, payload_schema,
  envelope_fields, produced_when, primary_consumer, status
)
SELECT
  v.event_type,
  '1.0',
  v.description,
  v.payload_schema::jsonb,
  COALESCE(
    (SELECT e.envelope_fields FROM event_schemas e WHERE e.schema_version = '1.0' LIMIT 1),
    '{"type":"object","additionalProperties":true}'::jsonb
  ),
  v.produced_when,
  v.primary_consumer,
  'ACTIVE'
FROM (VALUES
  (
    'orbit.lifecycle.transition_requested',
    'Request ORBIT lifecycle transition for a candidate.',
    '{"type":"object","required":["candidate_id","to_state"],"additionalProperties":true}',
    'ORBIT UI / recruiter action / API',
    'orbit.lifecycle.workflow'
  ),
  (
    'orbit.lifecycle.transitioned',
    'Candidate lifecycle state changed in ORBIT.',
    '{"type":"object","required":["candidate_id","to_state"],"additionalProperties":true}',
    'orbit.lifecycle.transition completed',
    'Audit / orbit.route.decision'
  ),
  (
    'orbit.placement.confirm_requested',
    'Request confirmation of a client placement.',
    '{"type":"object","required":["candidate_id","client_name","start_date","confirmed_bill_rate","confirmed_pay_rate"],"additionalProperties":true}',
    'ORBIT UI / placement API',
    'orbit.placement.workflow'
  ),
  (
    'orbit.placement.confirmed',
    'Client placement confirmed; candidate marked PLACED.',
    '{"type":"object","required":["candidate_id","placement_id"],"additionalProperties":true}',
    'orbit.placement.confirm completed',
    'Audit / revenue follow-up'
  ),
  (
    'orbit.revenue.arrange_requested',
    'Request revenue arrangement on a placement.',
    '{"type":"object","required":["placement_id","arrangement_type","value"],"additionalProperties":true}',
    'ORBIT UI / finance',
    'orbit.revenue.workflow'
  ),
  (
    'orbit.revenue.arranged',
    'Revenue arrangement attached to placement.',
    '{"type":"object","required":["placement_id"],"additionalProperties":true}',
    'orbit.revenue.arrange completed',
    'Audit'
  ),
  (
    'orbit.activity.noted',
    'Recruiter note written on candidate timeline.',
    '{"type":"object","required":["candidate_id","summary"],"additionalProperties":true}',
    'orbit.activity.note completed',
    'Audit'
  ),
  (
    'orbit.bench.hold',
    'Candidate moved to HOLD/IGNORE — needs attention.',
    '{"type":"object","additionalProperties":true}',
    'orbit.route.decision hold branch',
    'UI / ops'
  )
) AS v(event_type, description, payload_schema, produced_when, primary_consumer)
WHERE NOT EXISTS (
  SELECT 1 FROM event_schemas es
   WHERE es.event_type = v.event_type
     AND es.schema_version = '1.0'
);

INSERT INTO graph_event_bindings (
  event_type, org_id, graph_key, module_queue, agent_id, version, status, source
)
SELECT
  v.event_type,
  NULL,
  v.graph_key,
  'module.orbit.bench',
  NULL,
  1,
  'active',
  'seed'
FROM (VALUES
  ('orbit.lifecycle.transition_requested', 'orbit.lifecycle.workflow'),
  ('orbit.placement.confirm_requested', 'orbit.placement.workflow'),
  ('orbit.revenue.arrange_requested', 'orbit.revenue.workflow')
) AS v(event_type, graph_key)
WHERE NOT EXISTS (
  SELECT 1 FROM graph_event_bindings b
   WHERE b.event_type = v.event_type
     AND b.org_id IS NULL
     AND b.status = 'active'
);
