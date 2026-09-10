-- V16: pending_go_live — business "Request to go live" (no production touch).
-- Technical review then Approve runs compile → publish → activate.

ALTER TABLE agent_policies DROP CONSTRAINT IF EXISTS agent_policies_status_check;
ALTER TABLE agent_policies
  ADD CONSTRAINT agent_policies_status_check
  CHECK (status IN (
    'draft',
    'generated',
    'pending_go_live',
    'compiled',
    'published',
    'active'
  ));

ALTER TABLE agent_versions DROP CONSTRAINT IF EXISTS agent_versions_status_check;
ALTER TABLE agent_versions
  ADD CONSTRAINT agent_versions_status_check
  CHECK (status IN (
    'draft',
    'generated',
    'pending_go_live',
    'compiled',
    'published',
    'active'
  ));
