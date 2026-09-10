-- ORBIT activity note trigger + agent_id on orbit bindings (agent …505)

INSERT INTO event_schemas (event_type, schema_version, description, payload_schema, envelope_fields, status)
VALUES (
  'orbit.activity.note_requested',
  '1.0',
  'Recruiter note requested on candidate timeline',
  '{"title":"orbit.activity.note_requested payload","type":"object"}'::jsonb,
  '{}'::jsonb,
  'ACTIVE'
)
ON CONFLICT (event_type, schema_version) DO NOTHING;

INSERT INTO graph_event_bindings (
  event_type, org_id, graph_key, module_queue, agent_id, version, status, source
)
SELECT
  'orbit.activity.note_requested',
  NULL,
  'orbit.activity.workflow',
  'module.orbit.bench',
  '01900000-0000-7000-8000-000000000505'::uuid,
  1,
  'active',
  'seed'
WHERE NOT EXISTS (
  SELECT 1 FROM graph_event_bindings b
   WHERE b.event_type = 'orbit.activity.note_requested'
     AND b.org_id IS NULL
     AND b.status = 'active'
);

UPDATE graph_event_bindings
   SET agent_id = '01900000-0000-7000-8000-000000000505'::uuid
 WHERE event_type LIKE 'orbit.%'
   AND org_id IS NULL
   AND status = 'active'
   AND agent_id IS NULL;
