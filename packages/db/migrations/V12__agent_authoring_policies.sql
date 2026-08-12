-- V12 — Agent authoring Stage 1 (admin design §7)
-- Policy records + generated artifact versions. Stage 1 ends at status=generated.
-- Compile / Publish / active are later stages.

CREATE TABLE IF NOT EXISTS agent_policies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES organizations (id),  -- NULL = global default
  agent_id      uuid NOT NULL REFERENCES agent_definitions (id),
  policy        jsonb NOT NULL,                       -- AgentPolicy (Zod-validated)
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'generated', 'compiled', 'published', 'active')),
  version       int  NOT NULL,
  checksum      text,                                 -- sha256 of generated artifact
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_policies_key_version_scope
  ON agent_policies (agent_id, version, COALESCE(org_id::text, '~global~'));

CREATE UNIQUE INDEX IF NOT EXISTS agent_policies_one_active
  ON agent_policies (agent_id, COALESCE(org_id::text, '~global~'))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS agent_policies_agent_lookup
  ON agent_policies (agent_id, status);

CREATE TABLE IF NOT EXISTS agent_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid NOT NULL REFERENCES agent_definitions (id),
  org_id        uuid REFERENCES organizations (id),
  policy_id     uuid NOT NULL REFERENCES agent_policies (id),
  version       int  NOT NULL,
  artifact_ref  text NOT NULL,
  artifact_source text NOT NULL,                      -- Stage 1: store generated agent.ts in DB
  checksum      text NOT NULL,
  status        text NOT NULL
                CHECK (status IN ('draft', 'generated', 'compiled', 'published', 'active')),
  generated_by  text NOT NULL,
  generated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_versions_key_version_scope
  ON agent_versions (agent_id, version, COALESCE(org_id::text, '~global~'));

CREATE INDEX IF NOT EXISTS agent_versions_policy_lookup
  ON agent_versions (policy_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_policies TO syntra_app, syntra_relay;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_versions TO syntra_app, syntra_relay;
