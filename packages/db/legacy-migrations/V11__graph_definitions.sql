-- V11 — Graph definitions (orchestrator design §5)
-- Aligns with the design-doc schema already present in some environments
-- (id/org_id as text). CREATE IF NOT EXISTS is a no-op when the table exists.

CREATE TABLE IF NOT EXISTS graph_definitions (
  id            text PRIMARY KEY,
  org_id        text,                              -- NULL = global default
  graph_key     text NOT NULL,
  version       int  NOT NULL,
  definition    jsonb NOT NULL,
  checksum      text NOT NULL,
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'active', 'retired')),
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  activated_at  timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS graph_definitions_key_version_scope
  ON graph_definitions (graph_key, version, COALESCE(org_id, '~global~'));

CREATE UNIQUE INDEX IF NOT EXISTS graph_definitions_one_active
  ON graph_definitions (graph_key, COALESCE(org_id, '~global~'))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS graph_definitions_lookup
  ON graph_definitions (graph_key, status);
