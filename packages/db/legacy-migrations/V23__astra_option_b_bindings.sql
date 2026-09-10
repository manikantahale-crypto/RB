-- V23: Option B live bindings — ASTRA gate in front of SYNTRA matching.
-- syntra.jd.received → astra.requirement.workflow@2
-- syntra.jd.normalized → syntra.authored (active SYNTRA matching graph)
-- Idempotent: retires prior active rows for those event types, then inserts.
-- source must be 'seed' | 'authoring' (V18 check constraint).

-- 1) Retire any active binding for syntra.jd.received (was SYNTRA direct)
UPDATE graph_event_bindings
   SET status = 'retired',
       updated_at = now()
 WHERE event_type = 'syntra.jd.received'
   AND org_id IS NULL
   AND status = 'active';

-- 2) Front door: JD upload → ASTRA normalize→route
INSERT INTO graph_event_bindings (
  event_type, org_id, graph_key, module_queue, agent_id, version, status, source
)
SELECT
  'syntra.jd.received',
  NULL,
  'astra.requirement.workflow',
  'module.syntra.jd',
  '01900000-0000-7000-8000-000000000504'::uuid,
  2,
  'active',
  'authoring'
WHERE NOT EXISTS (
  SELECT 1 FROM graph_event_bindings b
   WHERE b.event_type = 'syntra.jd.received'
     AND b.org_id IS NULL
     AND b.status = 'active'
);

-- 3) Retire any prior active bridge binding (safe re-run)
UPDATE graph_event_bindings
   SET status = 'retired',
       updated_at = now()
 WHERE event_type = 'syntra.jd.normalized'
   AND org_id IS NULL
   AND status = 'active';

-- 4) Bridge: ASTRA emits syntra.jd.normalized → SYNTRA authored matching
INSERT INTO graph_event_bindings (
  event_type, org_id, graph_key, module_queue, agent_id, version, status, source
)
SELECT
  'syntra.jd.normalized',
  NULL,
  g.graph_key,
  'module.syntra.jd',
  '01900000-0000-7000-8000-000000000501'::uuid,
  g.version,
  'active',
  'authoring'
FROM graph_definitions g
WHERE g.graph_key = 'syntra.authored'
  AND g.org_id IS NULL
  AND g.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM graph_event_bindings b
     WHERE b.event_type = 'syntra.jd.normalized'
       AND b.org_id IS NULL
       AND b.status = 'active'
  )
ORDER BY g.version DESC
LIMIT 1;
