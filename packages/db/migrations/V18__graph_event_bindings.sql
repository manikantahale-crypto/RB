-- V18: graph_event_bindings — DB-owned event_type → graph_key routing (admin Builder).
-- Ingress resolves ONLY from this table (active row). No code-table fallback.
-- Partial unique: one active binding per (event_type, org scope).

CREATE TABLE IF NOT EXISTS graph_event_bindings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    text NOT NULL,
  org_id        uuid,
  graph_key     text NOT NULL,
  module_queue  text NOT NULL,
  agent_id      uuid,
  version       int,
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'retired')),
  source        text NOT NULL DEFAULT 'authoring'
                CHECK (source IN ('seed', 'authoring')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS graph_event_bindings_one_active
  ON graph_event_bindings (event_type, COALESCE(org_id::text, '~global~'))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS graph_event_bindings_lookup
  ON graph_event_bindings (event_type, status);

CREATE INDEX IF NOT EXISTS graph_event_bindings_agent
  ON graph_event_bindings (agent_id)
  WHERE agent_id IS NOT NULL;

COMMENT ON TABLE graph_event_bindings IS
  'Active event_type → graph_key + module_queue for ingress. Seeded for day-1 Syntra; admin Activate upserts authoring rows.';
