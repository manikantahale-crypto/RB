-- V17: agent_versions.meta — gap acknowledgment for deterministic go-live gate.
ALTER TABLE agent_versions
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;
