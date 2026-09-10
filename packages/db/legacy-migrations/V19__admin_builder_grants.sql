-- V19: Admin Builder — table GRANTs only (no policy DDL).
-- Policy changes require table owner; V14 already has migrator FOR ALL on entitlements.
-- One-time ops script: packages/db/scripts/grant-admin-builder.sql

GRANT INSERT ON TABLE agent_definitions TO syntra_migrator, syntra_relay;
GRANT INSERT ON TABLE admin_agent_entitlements TO syntra_migrator, syntra_relay;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'graph_event_bindings') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE graph_event_bindings TO syntra_migrator, syntra_relay';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'syntra_app') THEN
    EXECUTE 'GRANT INSERT ON TABLE agent_definitions TO syntra_app';
    EXECUTE 'GRANT INSERT ON TABLE admin_agent_entitlements TO syntra_app';
  END IF;
END
$$;
