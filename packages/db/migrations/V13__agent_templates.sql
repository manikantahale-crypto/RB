-- V13 — Agent templates (authoring design §5A / A6)
-- Per-product template data that drives the schema-driven generator.
-- Stage 1: templates are data; generator code stays agent-agnostic.

CREATE TABLE IF NOT EXISTS agent_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key     text NOT NULL,                         -- stable slug: syntra, intake, …
  agent_id      uuid REFERENCES agent_definitions (id),-- optional link to spine row
  display_name  text NOT NULL,
  version       int  NOT NULL DEFAULT 1,
  template      jsonb NOT NULL,                        -- AgentTemplate (Zod-validated)
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_templates_key_version_key UNIQUE (agent_key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_templates_one_active
  ON agent_templates (agent_key)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS agent_templates_agent_id_lookup
  ON agent_templates (agent_id)
  WHERE agent_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_templates TO syntra_app, syntra_relay;
