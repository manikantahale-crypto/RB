-- Repeatable: orch runtime grants (same as scripts/grant-orch-runtime.sql).
-- Flyway may skip if not run as a role that can CREATE POLICY — then run the
-- script manually as postgres in Supabase SQL editor.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_definitions' AND policyname = 'agent_definitions_migrator_read'
  ) THEN
    BEGIN
      CREATE POLICY agent_definitions_migrator_read ON agent_definitions
        FOR SELECT TO syntra_migrator USING (true);
    EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
      RAISE NOTICE 'skip agent_definitions policy — run grant-orch-runtime.sql as postgres';
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'authoring' AND tablename = 'event_catalog'
      AND policyname = 'event_catalog_migrator_read'
  ) THEN
    BEGIN
      CREATE POLICY event_catalog_migrator_read ON authoring.event_catalog
        FOR SELECT TO syntra_migrator USING (true);
    EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
      RAISE NOTICE 'skip event_catalog read policy';
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'authoring' AND tablename = 'event_catalog'
      AND policyname = 'event_catalog_migrator_insert'
  ) THEN
    BEGIN
      CREATE POLICY event_catalog_migrator_insert ON authoring.event_catalog
        FOR INSERT TO syntra_migrator WITH CHECK (true);
    EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
      RAISE NOTICE 'skip event_catalog insert policy';
    END;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE 'GRANT SELECT ON TABLE agent_definitions TO syntra_migrator';
  EXECUTE 'GRANT SELECT, INSERT ON TABLE authoring.event_catalog TO syntra_migrator';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE agent_runs TO syntra_migrator';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE agent_steps TO syntra_migrator';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'grant-orch-runtime: % — run packages/db/scripts/grant-orch-runtime.sql as postgres', SQLERRM;
END
$$;

-- Registered in the catalogue, which is what orch.event_outbox's foreign key
-- names since V20260909.38. `application` is derived from the prefix the one
-- way the platform does it, and `handling` is left at its default: a workflow
-- being bound to this event is what makes it routable, not this file.
INSERT INTO authoring.event_catalog (
  event_type, schema_version, application, description, payload_schema,
  envelope_fields, produced_when, primary_consumer, status
)
SELECT
  'syntra.match.requested',
  '1.0',
  (SELECT a.key FROM platform.applications a WHERE a.key = 'syntra'),
  'A job×resume match was requested (Syntra or platform ingress).',
  '{"$schema":"https://json-schema.org/draft/2020-12/schema","title":"syntra.match.requested payload","type":"object","additionalProperties":true}'::jsonb,
  coalesce((SELECT e.envelope_fields FROM authoring.event_catalog e
             WHERE e.schema_version = '1.0' LIMIT 1), '{}'::jsonb),
  'Match requested',
  'Orchestrator match workflow',
  'active'
ON CONFLICT (event_type, schema_version) DO NOTHING;
