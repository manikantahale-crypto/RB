-- Seed day-1 trigger bindings so Syntra keeps working without hardcoded ingress.
-- Admin Activate replaces the active row for a given event_type.

INSERT INTO graph_event_bindings (
  event_type, org_id, graph_key, module_queue, agent_id, version, status, source
)
SELECT v.event_type, NULL, v.graph_key, v.module_queue, v.agent_id::uuid, 1, 'active', 'seed'
FROM (VALUES
  ('syntra.jd.received', 'syntra.jd.workflow', 'module.syntra.jd', '01900000-0000-7000-8000-000000000501'),
  ('syntra.jd.parsed', 'syntra.continuous.match', 'module.syntra.match', '01900000-0000-7000-8000-000000000501'),
  ('syntra.resume.received', 'resume.intake', 'module.design.resume', '01900000-0000-7000-8000-000000000502'),
  ('syntra.profile.prepared', 'syntra.duplicate.detect', 'module.design.duplicate', '01900000-0000-7000-8000-000000000502'),
  ('syntra.match.requested', 'syntra.match.workflow', 'module.syntra.match', '01900000-0000-7000-8000-000000000501'),
  ('syntra.duplicate.review_required', 'duplicate.review', 'module.design.duplicate', '01900000-0000-7000-8000-000000000502'),
  ('orbit.lifecycle.transition_requested', 'orbit.lifecycle.workflow', 'module.orbit.bench', NULL),
  ('orbit.placement.confirm_requested', 'orbit.placement.workflow', 'module.orbit.bench', NULL),
  ('orbit.revenue.arrange_requested', 'orbit.revenue.workflow', 'module.orbit.bench', NULL)
) AS v(event_type, graph_key, module_queue, agent_id)
WHERE NOT EXISTS (
  SELECT 1 FROM graph_event_bindings b
   WHERE b.event_type = v.event_type
     AND b.org_id IS NULL
     AND b.status = 'active'
);
