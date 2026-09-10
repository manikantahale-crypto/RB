-- V25: Register ASTRA channel / quality event contracts (outbox FK).
-- Idempotent. Complements R__seed_event_schemas for environments that
-- have not re-run the repeatable seed yet.

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
    'astra.requirement.scored',
    'ASTRA quality score without full LLM normalize. Feeds orch.branch.decision.',
    '{"type":"object","required":["is_actionable","confidence_score"],"additionalProperties":true}',
    'astra.requirement.quality completed',
    'Same-graph branch planner; audit'
  ),
  (
    'astra.email.received',
    'Inbound email JD should be ingested by ASTRA.',
    '{"type":"object","required":["body"],"additionalProperties":true}',
    'Email webhook / mailbox adapter',
    'astra.email.intake.workflow'
  ),
  (
    'astra.jobboard.fetch_requested',
    'Request ASTRA to fetch/ingest job-board listings.',
    '{"type":"object","additionalProperties":true}',
    'Admin / scheduler / market adapter',
    'astra.jobboard.fetch.workflow'
  )
) AS v(event_type, description, payload_schema, produced_when, primary_consumer)
WHERE NOT EXISTS (
  SELECT 1 FROM event_schemas es
   WHERE es.event_type = v.event_type
     AND es.schema_version = '1.0'
);
