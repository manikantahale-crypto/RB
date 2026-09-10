-- V15 — graph_versions history + RLS for graph store
-- Stage 2 Compile materialises `graph_definitions` and records history in `graph_versions`.

CREATE TABLE IF NOT EXISTS graph_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        text,
  graph_id      text NOT NULL,
  graph_key     text NOT NULL,
  version       int  NOT NULL,
  definition    jsonb NOT NULL,
  checksum      text NOT NULL,
  status        text NOT NULL DEFAULT 'compiled'
                CHECK (status IN ('draft', 'compiled', 'published', 'active', 'retired')),
  compiled_by  text NOT NULL,
  compiled_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS graph_versions_lookup
  ON graph_versions (graph_key, version, org_id);

-- RLS predicate: scope by current org; NULL org_id means global.
-- Note: we intentionally keep this as text to match `graph_definitions.org_id`.
DO $$
BEGIN
  -- graph_definitions
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'graph_definitions'
  ) THEN
    ALTER TABLE graph_definitions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE graph_definitions FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS graph_definitions_read ON graph_definitions;
    CREATE POLICY graph_definitions_read ON graph_definitions
      FOR SELECT TO syntra_app, syntra_relay
      USING (org_id IS NULL OR org_id::text = NULLIF(current_setting('app.org_id', true), ''));

    DROP POLICY IF EXISTS graph_definitions_insert ON graph_definitions;
    CREATE POLICY graph_definitions_insert ON graph_definitions
      FOR INSERT TO syntra_app, syntra_relay
      WITH CHECK (org_id IS NULL OR org_id::text = NULLIF(current_setting('app.org_id', true), ''));

    DROP POLICY IF EXISTS graph_definitions_update ON graph_definitions;
    CREATE POLICY graph_definitions_update ON graph_definitions
      FOR UPDATE TO syntra_app, syntra_relay
      USING (org_id IS NULL OR org_id::text = NULLIF(current_setting('app.org_id', true), ''))
      WITH CHECK (org_id IS NULL OR org_id::text = NULLIF(current_setting('app.org_id', true), ''));

    DROP POLICY IF EXISTS graph_definitions_delete ON graph_definitions;
    CREATE POLICY graph_definitions_delete ON graph_definitions
      FOR DELETE TO syntra_app, syntra_relay
      USING (org_id IS NULL OR org_id::text = NULLIF(current_setting('app.org_id', true), ''));

    DROP POLICY IF EXISTS graph_definitions_migrator ON graph_definitions;
    CREATE POLICY graph_definitions_migrator ON graph_definitions
      FOR ALL TO syntra_migrator USING (true) WITH CHECK (true);
  END IF;

  -- graph_versions
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'graph_versions'
  ) THEN
    ALTER TABLE graph_versions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE graph_versions FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS graph_versions_read ON graph_versions;
    CREATE POLICY graph_versions_read ON graph_versions
      FOR SELECT TO syntra_app, syntra_relay
      USING (org_id IS NULL OR org_id::text = NULLIF(current_setting('app.org_id', true), ''));

    DROP POLICY IF EXISTS graph_versions_insert ON graph_versions;
    CREATE POLICY graph_versions_insert ON graph_versions
      FOR INSERT TO syntra_app, syntra_relay
      WITH CHECK (org_id IS NULL OR org_id::text = NULLIF(current_setting('app.org_id', true), ''));

    DROP POLICY IF EXISTS graph_versions_update ON graph_versions;
    CREATE POLICY graph_versions_update ON graph_versions
      FOR UPDATE TO syntra_app, syntra_relay
      USING (org_id IS NULL OR org_id::text = NULLIF(current_setting('app.org_id', true), ''))
      WITH CHECK (org_id IS NULL OR org_id::text = NULLIF(current_setting('app.org_id', true), ''));

    DROP POLICY IF EXISTS graph_versions_delete ON graph_versions;
    CREATE POLICY graph_versions_delete ON graph_versions
      FOR DELETE TO syntra_app, syntra_relay
      USING (org_id IS NULL OR org_id::text = NULLIF(current_setting('app.org_id', true), ''));

    DROP POLICY IF EXISTS graph_versions_migrator ON graph_versions;
    CREATE POLICY graph_versions_migrator ON graph_versions
      FOR ALL TO syntra_migrator USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Best-effort grants for runtime/relay roles.
GRANT SELECT, INSERT, UPDATE, DELETE ON graph_versions TO syntra_app, syntra_relay;
GRANT SELECT, INSERT, UPDATE, DELETE ON graph_definitions TO syntra_app, syntra_relay;

