CREATE TABLE IF NOT EXISTS graph_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid, -- referencing organizations(id) if needed
  graph_key text NOT NULL,
  version integer NOT NULL,
  definition jsonb NOT NULL,
  checksum text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  UNIQUE NULLS NOT DISTINCT (org_id, graph_key, version)
);
