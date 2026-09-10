-- V22: ASTRA graph redesign v2 (normalize→route / thin route gate).
-- Stage 4 only — does NOT touch graph_event_bindings.
-- Live pipeline (syntra.jd.received → active SYNTRA binding) stays unchanged.
-- Idempotent: safe if live DB was already patched by Stage 4 apply script.

-- Retire stubby v1 definitions
UPDATE graph_definitions
   SET status = 'retired'
 WHERE graph_key IN (
   'astra.requirement.workflow',
   'astra.requirement.normalized.workflow'
 )
   AND version = 1
   AND status IS DISTINCT FROM 'retired';

-- astra.requirement.workflow @2 — normalize → route
INSERT INTO graph_definitions (
  id, org_id, graph_key, version, definition, checksum, status, created_by, activated_at
) VALUES (
  'graph_astra_requirement_v2',
  NULL,
  'astra.requirement.workflow',
  2,
  $defA${
  "graphKey": "astra.requirement.workflow",
  "agentName": "astra",
  "entryInput": "AstraRequirementReceivedPayload",
  "nodes": [
    {
      "id": "normalize",
      "impl": "astra.requirement.normalize",
      "config": {
        "actionClass": "INTERNAL_WRITE"
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
    ["__start__", "normalize"],
    ["normalize", "route"],
    ["route", "__end__"]
  ]
}$defA$::jsonb,
  '0a4749892d5586e6b171e82410962a341cdc894fdc634f26bd858d6770f84c59',
  'active',
  'stage4-astra-redesign',
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
      "id": "normalize",
      "impl": "astra.requirement.normalize",
      "config": {
        "actionClass": "INTERNAL_WRITE"
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
    ["__start__", "normalize"],
    ["normalize", "route"],
    ["route", "__end__"]
  ]
}$defA$::jsonb,
       checksum = '0a4749892d5586e6b171e82410962a341cdc894fdc634f26bd858d6770f84c59',
       status = 'active',
       activated_at = COALESCE(activated_at, now()),
       created_by = COALESCE(created_by, 'stage4-astra-redesign')
 WHERE graph_key = 'astra.requirement.workflow'
   AND version = 2
   AND org_id IS NULL;

-- astra.requirement.normalized.workflow @2 — thin route gate
INSERT INTO graph_definitions (
  id, org_id, graph_key, version, definition, checksum, status, created_by, activated_at
) VALUES (
  'graph_astra_requirement_normalized_v2',
  NULL,
  'astra.requirement.normalized.workflow',
  2,
  $defB${
  "graphKey": "astra.requirement.normalized.workflow",
  "agentName": "astra",
  "entryInput": "AstraRequirementNormalizedPayload",
  "nodes": [
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
    ["__start__", "route"],
    ["route", "__end__"]
  ]
}$defB$::jsonb,
  '9812a10c485010fe0a0ab7e8352cd56c2b2d3bd09b642d1616034f1827c5e5d1',
  'active',
  'stage4-astra-redesign',
  now()
)
ON CONFLICT DO NOTHING;

UPDATE graph_definitions
   SET definition = $defB${
  "graphKey": "astra.requirement.normalized.workflow",
  "agentName": "astra",
  "entryInput": "AstraRequirementNormalizedPayload",
  "nodes": [
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
    ["__start__", "route"],
    ["route", "__end__"]
  ]
}$defB$::jsonb,
       checksum = '9812a10c485010fe0a0ab7e8352cd56c2b2d3bd09b642d1616034f1827c5e5d1',
       status = 'active',
       activated_at = COALESCE(activated_at, now()),
       created_by = COALESCE(created_by, 'stage4-astra-redesign')
 WHERE graph_key = 'astra.requirement.normalized.workflow'
   AND version = 2
   AND org_id IS NULL;
