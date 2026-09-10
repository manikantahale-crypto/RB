-- V24: ASTRA workflow@3 — quality → branch (pass|human|reject) → normalize|human → route.
-- Channel thin graphs + Option B bindings bumped to v3.
-- Idempotent.

-- Retire workflow@2 as primary active (keep row for history)
UPDATE graph_definitions
   SET status = 'retired'
 WHERE graph_key = 'astra.requirement.workflow'
   AND version = 2
   AND org_id IS NULL
   AND status = 'active';

-- Main gate @3
INSERT INTO graph_definitions (
  id, org_id, graph_key, version, definition, checksum, status, created_by, activated_at
) VALUES (
  'graph_astra_requirement_v3',
  NULL,
  'astra.requirement.workflow',
  3,
  $defA${
  "graphKey": "astra.requirement.workflow",
  "agentName": "astra",
  "entryInput": "AstraRequirementReceivedPayload",
  "nodes": [
    {
      "id": "quality",
      "impl": "astra.requirement.quality",
      "config": { "actionClass": "DATA_SHAPING" }
    },
    {
      "id": "branch",
      "impl": "orch.branch.decision",
      "config": {
        "actionClass": "CONTROL",
        "passMin": 0.6,
        "humanMin": 0.35,
        "onRejectEvent": "astra.requirement.rejected"
      }
    },
    {
      "id": "normalize",
      "impl": "astra.requirement.normalize",
      "config": { "actionClass": "INTERNAL_WRITE" }
    },
    {
      "id": "human",
      "impl": "human.gate",
      "config": {
        "actionClass": "CONTROL",
        "reason": "astra_quality_review"
      }
    },
    {
      "id": "route",
      "impl": "astra.route.decision",
      "config": {
        "actionClass": "CONTROL",
        "onActionable": "syntra.jd.normalized",
        "onRejected": "astra.requirement.rejected",
        "minConfidence": 0
      }
    }
  ],
  "edges": [
    ["__start__", "quality"],
    ["quality", "branch"],
    ["normalize", "route"],
    ["human", "route"],
    ["route", "__end__"]
  ],
  "conditionalEdges": [
    {
      "from": "branch",
      "router": "branch_key",
      "map": {
        "pass": "normalize",
        "human_review": "human",
        "reject": "__end__"
      }
    }
  ]
}$defA$::jsonb,
  '297c3e1d2dab7eaf302b1fa6aa8e2f39b44c1d95f44bca43795e007130d16541',
  'active',
  'stage-astra-v3-branch',
  now()
)
ON CONFLICT DO NOTHING;

UPDATE graph_definitions
   SET definition = $defA${
  "graphKey": "astra.requirement.workflow",
  "agentName": "astra",
  "entryInput": "AstraRequirementReceivedPayload",
  "nodes": [
    {
      "id": "quality",
      "impl": "astra.requirement.quality",
      "config": { "actionClass": "DATA_SHAPING" }
    },
    {
      "id": "branch",
      "impl": "orch.branch.decision",
      "config": {
        "actionClass": "CONTROL",
        "passMin": 0.6,
        "humanMin": 0.35,
        "onRejectEvent": "astra.requirement.rejected"
      }
    },
    {
      "id": "normalize",
      "impl": "astra.requirement.normalize",
      "config": { "actionClass": "INTERNAL_WRITE" }
    },
    {
      "id": "human",
      "impl": "human.gate",
      "config": {
        "actionClass": "CONTROL",
        "reason": "astra_quality_review"
      }
    },
    {
      "id": "route",
      "impl": "astra.route.decision",
      "config": {
        "actionClass": "CONTROL",
        "onActionable": "syntra.jd.normalized",
        "onRejected": "astra.requirement.rejected",
        "minConfidence": 0
      }
    }
  ],
  "edges": [
    ["__start__", "quality"],
    ["quality", "branch"],
    ["normalize", "route"],
    ["human", "route"],
    ["route", "__end__"]
  ],
  "conditionalEdges": [
    {
      "from": "branch",
      "router": "branch_key",
      "map": {
        "pass": "normalize",
        "human_review": "human",
        "reject": "__end__"
      }
    }
  ]
}$defA$::jsonb,
       checksum = '297c3e1d2dab7eaf302b1fa6aa8e2f39b44c1d95f44bca43795e007130d16541',
       status = 'active',
       activated_at = COALESCE(activated_at, now()),
       created_by = COALESCE(created_by, 'stage-astra-v3-branch')
 WHERE graph_key = 'astra.requirement.workflow'
   AND version = 3
   AND org_id IS NULL;

-- Email channel → ingest then hand off via astra.requirement.received
INSERT INTO graph_definitions (
  id, org_id, graph_key, version, definition, checksum, status, created_by, activated_at
) VALUES (
  'graph_astra_email_intake_v1',
  NULL,
  'astra.email.intake.workflow',
  1,
  $defE${
  "graphKey": "astra.email.intake.workflow",
  "agentName": "astra",
  "nodes": [
    {
      "id": "intake",
      "impl": "astra.requirement.intake",
      "config": { "actionClass": "EXTERNAL_COMM" }
    }
  ],
  "edges": [
    ["__start__", "intake"],
    ["intake", "__end__"]
  ]
}$defE$::jsonb,
  'd587a50295def078cb947f1e3efe108c98f9a24f3f685416574ead658e31ce94',
  'active',
  'stage-astra-v3-branch',
  now()
)
ON CONFLICT DO NOTHING;

-- Job-board channel
INSERT INTO graph_definitions (
  id, org_id, graph_key, version, definition, checksum, status, created_by, activated_at
) VALUES (
  'graph_astra_jobboard_fetch_v1',
  NULL,
  'astra.jobboard.fetch.workflow',
  1,
  $defJ${
  "graphKey": "astra.jobboard.fetch.workflow",
  "agentName": "astra",
  "nodes": [
    {
      "id": "fetch",
      "impl": "astra.jobboard.fetch",
      "config": { "actionClass": "EXTERNAL_COMM" }
    }
  ],
  "edges": [
    ["__start__", "fetch"],
    ["fetch", "__end__"]
  ]
}$defJ$::jsonb,
  '234a11f785fbd5f3e13924984cd09eec832f5b3408c5247a01656e2879e4e3a3',
  'active',
  'stage-astra-v3-branch',
  now()
)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Bindings: bump front door to @3; add channel + received bindings
-- ---------------------------------------------------------------------------

UPDATE graph_event_bindings
   SET status = 'retired', updated_at = now()
 WHERE event_type IN (
     'syntra.jd.received',
     'astra.requirement.received',
     'astra.email.received',
     'astra.jobboard.fetch_requested'
   )
   AND org_id IS NULL
   AND status = 'active';

INSERT INTO graph_event_bindings (
  event_type, org_id, graph_key, module_queue, agent_id, version, status, source
)
SELECT
  'syntra.jd.received', NULL,
  'astra.requirement.workflow', 'module.syntra.jd',
  '01900000-0000-7000-8000-000000000504'::uuid, 3, 'active', 'authoring'
WHERE NOT EXISTS (
  SELECT 1 FROM graph_event_bindings b
   WHERE b.event_type = 'syntra.jd.received'
     AND b.org_id IS NULL
     AND b.status = 'active'
);

INSERT INTO graph_event_bindings (
  event_type, org_id, graph_key, module_queue, agent_id, version, status, source
)
SELECT
  'astra.requirement.received', NULL,
  'astra.requirement.workflow', 'module.syntra.jd',
  '01900000-0000-7000-8000-000000000504'::uuid, 3, 'active', 'authoring'
WHERE NOT EXISTS (
  SELECT 1 FROM graph_event_bindings b
   WHERE b.event_type = 'astra.requirement.received'
     AND b.org_id IS NULL
     AND b.status = 'active'
);

INSERT INTO graph_event_bindings (
  event_type, org_id, graph_key, module_queue, agent_id, version, status, source
)
SELECT
  'astra.email.received', NULL,
  'astra.email.intake.workflow', 'module.syntra.jd',
  '01900000-0000-7000-8000-000000000504'::uuid, 1, 'active', 'authoring'
WHERE NOT EXISTS (
  SELECT 1 FROM graph_event_bindings b
   WHERE b.event_type = 'astra.email.received'
     AND b.org_id IS NULL
     AND b.status = 'active'
);

INSERT INTO graph_event_bindings (
  event_type, org_id, graph_key, module_queue, agent_id, version, status, source
)
SELECT
  'astra.jobboard.fetch_requested', NULL,
  'astra.jobboard.fetch.workflow', 'module.syntra.jd',
  '01900000-0000-7000-8000-000000000504'::uuid, 1, 'active', 'authoring'
WHERE NOT EXISTS (
  SELECT 1 FROM graph_event_bindings b
   WHERE b.event_type = 'astra.jobboard.fetch_requested'
     AND b.org_id IS NULL
     AND b.status = 'active'
);

-- Keep / restore syntra.jd.normalized → syntra.authored if missing
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
