-- Seed day-1 trigger bindings so Syntra keeps working without hardcoded ingress.
-- Admin Activate replaces the active row for a given event_type.
--
-- Written to authoring.event_bindings. The legacy public.graph_event_bindings
-- is kept in step by the mirror in V20260909.36, so anything still reading the
-- old table sees these too.
--
-- Two columns went away and neither was carrying anything:
--
--   agent_id  a binding names a workflow now, not the agent that authored it.
--   version   these all said 1, which meant "the first version" and not "hold
--             this version". A binding with no pinned version follows whichever
--             one is live, which is what these have always wanted.

-- A queue is a foreign key, so it has to exist before a binding can name it.
INSERT INTO platform.queues (key, description)
SELECT DISTINCT v.module_queue, 'Declared by a day-1 binding'
FROM (VALUES
  ('module.syntra.jd'), ('module.syntra.match'), ('module.design.resume'),
  ('module.design.duplicate'), ('module.orbit.bench')
) AS v(module_queue)
ON CONFLICT (key) DO NOTHING;

-- The graph is a foreign key too. A binding naming a workflow nobody has
-- authored is simply not written — the join drops it — which is the fault
-- being visible rather than a row pointing at nothing.
--
-- EXISTING IS NOT THE SAME AS RUNNABLE, AND THAT COST A BINDING.
--
-- The join above asks whether the workflow exists. It was written to catch
-- "nobody ever authored this", and it does. It cannot catch "somebody
-- authored it and then retired it" — and `syntra.jd.workflow` is exactly
-- that: graph retired, its only version retired.
--
-- So this file re-created an ACTIVE binding from `syntra.jd.received` to a
-- workflow that could not run. It survived because repeatable migrations run
-- after every versioned one, so the seed had the last word over the migration
-- that had just cleaned it up.
--
-- The extra condition is therefore a live version, not mere existence. A
-- workflow with no live version is one the router would enqueue for and
-- nothing would answer.
INSERT INTO authoring.event_bindings (
  event_type, org_id, graph_id, queue_key, consuming_application, status, source
)
SELECT v.event_type, NULL, g.id, v.module_queue,
       (SELECT q.application FROM platform.queues q WHERE q.key = v.module_queue),
       'active', 'seed'
FROM (VALUES
  ('syntra.jd.received', 'syntra.jd.workflow', 'module.syntra.jd'),
  ('syntra.jd.parsed', 'syntra.continuous.match', 'module.syntra.match'),
  ('syntra.resume.received', 'resume.intake', 'module.design.resume'),
  ('syntra.profile.prepared', 'syntra.duplicate.detect', 'module.design.duplicate'),
  ('syntra.match.requested', 'syntra.match.workflow', 'module.syntra.match'),
  ('syntra.duplicate.review_required', 'duplicate.review', 'module.design.duplicate'),
  ('orbit.lifecycle.transition_requested', 'orbit.lifecycle.workflow', 'module.orbit.bench'),
  ('orbit.placement.confirm_requested', 'orbit.placement.workflow', 'module.orbit.bench'),
  ('orbit.revenue.arrange_requested', 'orbit.revenue.workflow', 'module.orbit.bench'),
  ('orbit.activity.note_requested', 'orbit.activity.workflow', 'module.orbit.bench')
) AS v(event_type, graph_key, module_queue)
JOIN authoring.graphs g
  ON g.graph_key = v.graph_key
 AND g.org_id IS NULL
WHERE EXISTS (
  SELECT 1 FROM authoring.graph_versions gv
   WHERE gv.graph_id = g.id
     AND gv.status = 'live'
)
AND NOT EXISTS (
  SELECT 1 FROM authoring.event_bindings b
   WHERE b.event_type = v.event_type
     AND b.org_id IS NULL
     AND b.status = 'active'
);

-- A bound event is a routed event. The catalogue's `handling` is what the
-- router consults, and leaving it at the default `terminal` would mean these
-- bindings existed and nothing reached them — the exact fault that killed
-- RELAY's two bindings.
UPDATE authoring.event_catalog c
   SET handling = 'graph', updated_at = now()
 WHERE c.handling <> 'graph'
   AND EXISTS (SELECT 1 FROM authoring.event_bindings b
                WHERE b.event_type = c.event_type AND b.status = 'active');
