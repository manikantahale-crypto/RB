-- V21: Retire Copilot product agent (unbound; matching stays on SYNTRA).
-- Soft-delete definition; retire bindings; deactivate template. History retained.

UPDATE agent_definitions
   SET is_active = false,
       updated_at = NOW()
 WHERE id = '01900000-0000-7000-8000-000000000503'
   AND is_active = true;

UPDATE agent_templates
   SET is_active = false
 WHERE agent_id = '01900000-0000-7000-8000-000000000503'
   AND is_active = true;

UPDATE graph_event_bindings
   SET status = 'retired',
       updated_at = NOW()
 WHERE agent_id = '01900000-0000-7000-8000-000000000503'
   AND status = 'active';

UPDATE graph_definitions
   SET status = 'retired'
 WHERE graph_key = 'copilot.authored'
   AND status IS DISTINCT FROM 'retired';
