-- The event catalogue the old project already had.
--
-- WHAT WAS WRONG
--
-- The new project's authoring.event_catalog knows two ASTRA events, both with
-- payload_schema = '{}' — the rows that node-api's seedEventSchemas() writes at
-- boot so that outbox inserts satisfy their foreign key. An empty schema turns
-- off the ingress gate's input check, idempotency keys and trigger ranking for
-- that event (ref/Orchestrator_Decisions.md), and DO NOTHING on conflict means
-- a deleted ghost comes back at the next boot. ORBIT, RELAY and PRISM have no
-- rows at all.
--
-- The old project's catalogue (54 rows) describes 21 of these 22
-- events properly: 6 astra.*, 9 orbit.*, 7 relay.*, 0 prism.*
-- (ref/Old_Repo_Findings.md §3.3). Those are the rows below, verbatim, read on
-- 2026-09-18 by ref/docbuild/make_catalogue_migration.mjs.
-- Still empty on the old project too: orbit.activity.note_requested.
--
-- WHAT THIS DOES
--
-- 1. Deletes ghost rows ('{}' schema) for these event types at versions the
--    old project does not carry, unless the outbox references them.
-- 2. Upserts the old project's rows on (event_type, schema_version).
-- 3. Asserts that no astra.%, orbit.%, relay.% row is left undescribed
--    (except the ones the old project never described either, listed above).
--
-- seedEventSchemas() in node-api/src/repositories/outbox.repository.js is
-- changed in the same commit to stop inserting: it now only reports catalogue
-- entries it expected and did not find. Without that, this migration would be
-- undone by the next boot.
--
-- SAFE TO RE-RUN.

BEGIN;

-- Ghosts at a version the old project does not carry, and that nothing in the
-- outbox references, go. A ghost at the SAME version is simply overwritten by
-- the upsert below; one the outbox references cannot be deleted at all.
DELETE FROM authoring.event_catalog c
 WHERE c.payload_schema = '{}'::jsonb
   AND c.event_type IN ('astra.email.received', 'astra.jobboard.fetch_requested', 'astra.requirement.normalized', 'astra.requirement.received', 'astra.requirement.rejected', 'astra.requirement.scored', 'orbit.activity.note_requested', 'orbit.activity.noted', 'orbit.bench.hold', 'orbit.lifecycle.transition_requested', 'orbit.lifecycle.transitioned', 'orbit.placement.confirm_requested', 'orbit.placement.confirmed', 'orbit.revenue.arrange_requested', 'orbit.revenue.arranged', 'relay.auto_reply.completed', 'relay.consent.completed', 'relay.consent.decided', 'relay.consent.reminded', 'relay.consent.requested', 'relay.email.classified', 'relay.profile.completed')
   AND (c.event_type, c.schema_version) NOT IN (('astra.email.received', '1.0'), ('astra.jobboard.fetch_requested', '1.0'), ('astra.requirement.normalized', '1.0'), ('astra.requirement.received', '1.0'), ('astra.requirement.rejected', '1.0'), ('astra.requirement.scored', '1.0'), ('orbit.activity.note_requested', '1.0'), ('orbit.activity.noted', '1.0'), ('orbit.bench.hold', '1.0'), ('orbit.lifecycle.transition_requested', '1.0'), ('orbit.lifecycle.transitioned', '1.0'), ('orbit.placement.confirm_requested', '1.0'), ('orbit.placement.confirmed', '1.0'), ('orbit.revenue.arrange_requested', '1.0'), ('orbit.revenue.arranged', '1.0'), ('relay.auto_reply.completed', '1.0'), ('relay.consent.completed', '1.0'), ('relay.consent.decided', '1.0'), ('relay.consent.reminded', '1.0'), ('relay.consent.requested', '1.0'), ('relay.email.classified', '1.0'), ('relay.profile.completed', '1.0'))
   AND NOT EXISTS (SELECT 1 FROM orch.event_outbox o
                    WHERE o.event_type = c.event_type AND o.schema_version = c.schema_version);

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('astra.email.received', '1.0', 'astra', 'Inbound email JD should be ingested by ASTRA.',
        '{"type":"object","required":["body"],"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'Email webhook / mailbox adapter', 'astra.email.intake.workflow', 'public', 'graph', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('astra.jobboard.fetch_requested', '1.0', 'astra', 'Request ASTRA to fetch/ingest job-board listings.',
        '{"type":"object","additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'Admin / scheduler / market adapter', 'astra.jobboard.fetch.workflow', 'public', 'graph', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('astra.requirement.normalized', '1.0', 'astra', 'ASTRA requirement intelligence enrichment completed',
        '{"type":"object","title":"astra.requirement.normalized payload","$schema":"https://json-schema.org/draft/2020-12/schema","required":["requirement_id","parser_version","is_actionable","confidence_score"],"properties":{"is_actionable":{"type":"boolean"},"parser_version":{"type":"string"},"requirement_id":{"type":"string","format":"uuid"},"confidence_score":{"type":"number"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'astra.requirement.normalize completed', 'Same-graph astra.route.decision; audit', 'public', 'terminal', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('astra.requirement.received', '1.0', 'astra', 'ASTRA requirement intake received',
        '{"type":"object","title":"astra.requirement.received payload","$schema":"https://json-schema.org/draft/2020-12/schema","required":["requirement_id"],"properties":{"title":{"type":["string","null"]},"channel_type":{"type":["string","null"]},"requirement_id":{"type":"string","format":"uuid"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'ASTRA channel / ingest created a JD row', 'astra.requirement.workflow', 'public', 'graph', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('astra.requirement.rejected', '1.0', 'astra', 'ASTRA rejected a requirement (not actionable or below minConfidence). Terminal for matching.',
        '{"type":"object","title":"astra.requirement.rejected payload","$schema":"https://json-schema.org/draft/2020-12/schema","required":["requirement_id","reason"],"properties":{"jobId":{"type":"string","format":"uuid"},"reason":{"type":"string","description":"not_actionable | confidence_below_min (...)"},"status":{"type":"string"},"is_actionable":{"type":"boolean"},"requirement_id":{"type":"string","format":"uuid"},"source_event_id":{"type":["string","null"],"format":"uuid"},"confidence_score":{"type":"number"}},"additionalProperties":false}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'ASTRA route decision failed the actionable gate', 'UI notify; audit; no SYNTRA match trigger', 'public', 'terminal', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('astra.requirement.scored', '1.0', 'astra', 'ASTRA quality score without full LLM normalize. Feeds orch.branch.decision.',
        '{"type":"object","required":["is_actionable","confidence_score"],"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'astra.requirement.quality completed', 'Same-graph branch planner; audit', 'public', 'terminal', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('orbit.activity.note_requested', '1.0', 'orbit', 'Syntra platform event: orbit.activity.note_requested',
        '{}'::jsonb,
        '{}'::jsonb,
        NULL, NULL, 'public', 'graph', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('orbit.activity.noted', '1.0', 'orbit', 'Recruiter note written on candidate timeline.',
        '{"type":"object","title":"orbit.activity.noted payload","$schema":"https://json-schema.org/draft/2020-12/schema","required":["candidate_id","summary"],"properties":{"summary":{"type":"string"},"candidate_id":{"type":"string","format":"uuid"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'orbit.activity.note completed', 'Audit', 'public', 'terminal', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('orbit.bench.hold', '1.0', 'orbit', 'Candidate moved to HOLD/IGNORE — needs attention.',
        '{"type":"object","title":"orbit.bench.hold payload","$schema":"https://json-schema.org/draft/2020-12/schema","properties":{"reason":{"type":"string"},"to_state":{"type":"string"},"candidate_id":{"type":"string","format":"uuid"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'orbit.route.decision hold branch', 'UI / ops', 'public', 'terminal', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('orbit.lifecycle.transition_requested', '1.0', 'orbit', 'Request ORBIT lifecycle transition for a candidate.',
        '{"type":"object","title":"orbit.lifecycle.transition_requested payload","$schema":"https://json-schema.org/draft/2020-12/schema","required":["candidate_id","to_state"],"properties":{"note":{"type":["string","null"]},"to_state":{"type":"string"},"from_state":{"type":"string"},"candidate_id":{"type":"string","format":"uuid"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'ORBIT UI / recruiter action / API', 'orbit.lifecycle.workflow', 'public', 'graph', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('orbit.lifecycle.transitioned', '1.0', 'orbit', 'Candidate lifecycle state changed in ORBIT.',
        '{"type":"object","title":"orbit.lifecycle.transitioned payload","$schema":"https://json-schema.org/draft/2020-12/schema","required":["candidate_id","to_state"],"properties":{"note":{"type":["string","null"]},"to_state":{"type":"string"},"from_state":{"type":["string","null"]},"candidate_id":{"type":"string","format":"uuid"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'orbit.lifecycle.transition completed', 'Audit / orbit.route.decision', 'public', 'terminal', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('orbit.placement.confirm_requested', '1.0', 'orbit', 'Request confirmation of a client placement.',
        '{"type":"object","title":"orbit.placement.confirm_requested payload","$schema":"https://json-schema.org/draft/2020-12/schema","required":["candidate_id","client_name","start_date","confirmed_bill_rate","confirmed_pay_rate"],"properties":{"work_mode":{"type":"string"},"start_date":{"type":"string"},"client_name":{"type":"string"},"candidate_id":{"type":"string","format":"uuid"},"employment_model":{"type":"string"},"confirmed_pay_rate":{"type":"number"},"confirmed_bill_rate":{"type":"number"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'ORBIT UI / placement API', 'orbit.placement.workflow', 'public', 'graph', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('orbit.placement.confirmed', '1.0', 'orbit', 'Client placement confirmed; candidate marked PLACED.',
        '{"type":"object","title":"orbit.placement.confirmed payload","$schema":"https://json-schema.org/draft/2020-12/schema","required":["candidate_id","placement_id"],"properties":{"client_name":{"type":"string"},"candidate_id":{"type":"string","format":"uuid"},"placement_id":{"type":"string","format":"uuid"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'orbit.placement.confirm completed', 'Audit / revenue follow-up', 'public', 'terminal', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('orbit.revenue.arrange_requested', '1.0', 'orbit', 'Request revenue arrangement on a placement.',
        '{"type":"object","title":"orbit.revenue.arrange_requested payload","$schema":"https://json-schema.org/draft/2020-12/schema","required":["placement_id","arrangement_type","value"],"properties":{"value":{"type":"number"},"placement_id":{"type":"string","format":"uuid"},"arrangement_type":{"type":"string"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'ORBIT UI / finance', 'orbit.revenue.workflow', 'public', 'graph', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('orbit.revenue.arranged', '1.0', 'orbit', 'Revenue arrangement attached to placement.',
        '{"type":"object","title":"orbit.revenue.arranged payload","$schema":"https://json-schema.org/draft/2020-12/schema","required":["placement_id"],"properties":{"value":{"type":"number"},"placement_id":{"type":"string","format":"uuid"},"arrangement_type":{"type":"string"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'orbit.revenue.arrange completed', 'Audit', 'public', 'terminal', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('relay.auto_reply.completed', '1.0', 'relay', 'OUTCOME — autonomous recruiter reply sent.',
        '{"type":"object","properties":{"tool_result":{"type":"object"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'relay.auto_reply.send', 'terminal', 'public', 'terminal', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('relay.consent.completed', '1.0', 'relay', 'OUTCOME — consent emails dispatched (NOT same as .requested).',
        '{"type":"object","properties":{"sent_count":{"type":"integer"},"thread_ids":{"type":"array"},"tool_result":{"type":"object"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'relay.consent.send', 'terminal — wait for relay.consent.decided', 'public', 'terminal', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('relay.consent.decided', '1.0', 'relay', 'Candidate replied yes/no/timeout — resumes consent workflow.',
        '{"type":"object","required":["decision"],"properties":{"decision":{"type":"string"},"tool_result":{"type":"object"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'relay.smart-inbox consent parser', 'orchestration.resume-thread', 'public', 'terminal', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('relay.consent.reminded', '1.0', 'relay', 'OUTCOME — consent reminder sent (Path B).',
        '{"type":"object","properties":{"tool_result":{"type":"object"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'relay.consent.remind', 'terminal', 'public', 'terminal', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('relay.consent.requested', '1.0', 'relay', 'COMMAND — orchestrator asks Relay to send candidate consent emails.',
        '{"type":"object","required":["requirement_id"],"properties":{"jobId":{"type":"string"},"requirement_id":{"type":"string"},"top_candidates":{"type":"array"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'syntra.shortlist.notify after match', 'relay.consent.workflow', 'public', 'graph', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('relay.email.classified', '1.0', 'relay', 'Relay classified email — SINGLE Smart Inbox orchestration front door.',
        '{"type":"object","required":["thread_id","message_id","reply_intent"],"properties":{"thread_id":{"type":"string"},"message_id":{"type":"string"},"tool_result":{"type":"object"},"is_jd_intent":{"type":"boolean"},"reply_intent":{"type":"string"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'relay.smart-inbox after classify', 'relay.intake.workflow', 'public', 'graph', 'active')
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

INSERT INTO authoring.event_catalog
  (event_type, schema_version, application, description, payload_schema, envelope_fields,
   produced_when, primary_consumer, visibility, handling, status)
VALUES ('relay.profile.completed', '1.0', 'relay', 'OUTCOME — candidate profile emailed to vendor (Path A).',
        '{"type":"object","properties":{"tool_result":{"type":"object"}},"additionalProperties":true}'::jsonb,
        '{"type":"object","title":"Syntra event envelope","$schema":"https://json-schema.org/draft/2020-12/schema","required":["event_id","event_type","schema_version","occurred_at","correlation_id","organization_id","aggregate","payload_ref","producer"],"properties":{"event_id":{"type":"string","format":"uuid"},"producer":{"type":"string"},"aggregate":{"type":"object","required":["type","id"],"properties":{"id":{"type":"string","format":"uuid"},"type":{"type":"string"}},"additionalProperties":false},"event_type":{"type":"string"},"occurred_at":{"type":"string","format":"date-time"},"payload_ref":{"type":"object","description":"Entity references and small scalars only. Never document bytes or resume text."},"causation_id":{"type":["string","null"],"format":"uuid","description":"event_id of the immediately preceding event. Null for chain roots."},"correlation_id":{"type":"string","format":"uuid","description":"Stable across the whole causal chain from one recruiter action."},"schema_version":{"type":"string"},"organization_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
        'relay.profile.send', 'terminal', 'public', 'terminal', 'active')
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

DO $$
DECLARE ghosts text;
BEGIN
  SELECT string_agg(event_type || '@' || schema_version, ', ') INTO ghosts
    FROM authoring.event_catalog
   WHERE event_type ~ '^(astra|orbit|relay)\.'
     AND payload_schema = '{}'::jsonb
     AND event_type NOT IN ('orbit.activity.note_requested');
  IF ghosts IS NOT NULL THEN
    RAISE EXCEPTION 'undescribed catalogue rows remain: %', ghosts;
  END IF;
  RAISE NOTICE 'catalogue: % rows carried from the old project; no empty astra/orbit/relay schema left.', 22;
END $$;

COMMIT;
