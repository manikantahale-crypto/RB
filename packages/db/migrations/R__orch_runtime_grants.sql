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
    WHERE tablename = 'event_schemas' AND policyname = 'event_schemas_migrator_read'
  ) THEN
    BEGIN
      CREATE POLICY event_schemas_migrator_read ON event_schemas
        FOR SELECT TO syntra_migrator USING (true);
    EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
      RAISE NOTICE 'skip event_schemas read policy';
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'event_schemas' AND policyname = 'event_schemas_migrator_insert'
  ) THEN
    BEGIN
      CREATE POLICY event_schemas_migrator_insert ON event_schemas
        FOR INSERT TO syntra_migrator WITH CHECK (true);
    EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
      RAISE NOTICE 'skip event_schemas insert policy';
    END;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE 'GRANT SELECT ON TABLE agent_definitions TO syntra_migrator';
  EXECUTE 'GRANT SELECT, INSERT ON TABLE event_schemas TO syntra_migrator';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE agent_runs TO syntra_migrator';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE agent_steps TO syntra_migrator';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'grant-orch-runtime: % — run packages/db/scripts/grant-orch-runtime.sql as postgres', SQLERRM;
END
$$;

INSERT INTO event_schemas (
  event_type, schema_version, description, payload_schema,
  envelope_fields, produced_when, primary_consumer, status
)
SELECT
  'syntra.match.requested',
  '1.0',
  'A job×resume match was requested (Syntra or platform ingress).',
  '{"$schema":"https://json-schema.org/draft/2020-12/schema","title":"syntra.match.requested payload","type":"object","additionalProperties":true}'::jsonb,
  e.envelope_fields,
  'Match requested',
  'Orchestrator match workflow',
  'ACTIVE'
FROM event_schemas e
WHERE e.schema_version = '1.0'
LIMIT 1
ON CONFLICT (event_type, schema_version) DO NOTHING;
