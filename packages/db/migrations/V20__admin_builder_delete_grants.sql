-- V20: Builder soft-delete — UPDATE agent_definitions (is_active = false).
-- V19 granted INSERT only; DELETE from UI uses UPDATE, not DELETE row.

GRANT UPDATE ON TABLE agent_definitions TO syntra_migrator, syntra_relay;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_definitions'
      AND policyname = 'agent_definitions_migrator_write'
  ) THEN
    CREATE POLICY agent_definitions_migrator_write ON agent_definitions
      FOR ALL TO syntra_migrator
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;
