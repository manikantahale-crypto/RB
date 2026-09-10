-- AUTO-GENERATED from packages/orchestrator/src/graphs/catalog.ts
-- Do not edit by hand. Regenerate with:
--   npm run generate:graph-seeds -w @tekisho/orchestrator
--
-- Repeatable Flyway seed: graph recipes (global scope).
--
-- CREATE IF ABSENT. NEVER OVERWRITE.
--
-- This used to DELETE every key it seeds and reinsert them, on every migration
-- run. That was defensible when git was the only author of a workflow. It is
-- not any more: the admin app has written hundreds of versions, and migrations
-- have advanced several workflows past what this file believes.
--
-- Against the live database that DELETE would have removed twelve rows, four
-- of which nothing here could put back — including the version of
-- duplicate.review that actually works, and two workflows a person authored
-- through the app.
--
-- So it seeds what is missing and leaves everything else alone. ON CONFLICT DO
-- NOTHING covers all three ways a row can already be there: the same id, the
-- same key and version, or another version of that key already active.

-- The recipe is two rows now, because a workflow's identity and its versions
-- are two tables. The seed values are staged once and used for both.
WITH seed (id, org_id, graph_key, version, definition, checksum, status, created_by, activated_at) AS (
  VALUES
(
  'graph_syntra_jd_v1',
  NULL::uuid,
  'syntra.jd.workflow',
  1,
  '{
  "graphKey": "syntra.jd.workflow",
  "agentName": "matching-agent",
  "nodes": [
    {
      "id": "process",
      "impl": "syntra.jd.process",
      "config": {
        "actionClass": "INTERNAL_WRITE"
      }
    }
  ],
  "edges": [
    [
      "__start__",
      "process"
    ],
    [
      "process",
      "__end__"
    ]
  ]
}'::jsonb,
  'e29a8447a4a0705ad988be0fcfeeff9d0069f6552d8f8b7c8fa28078be3748e3',
  'active',
  'def.ts',
  now()
),
(
  'graph_syntra_match_v1',
  NULL::uuid,
  'syntra.match.workflow',
  1,
  '{
  "graphKey": "syntra.match.workflow",
  "agentName": "matching-agent",
  "nodes": [
    {
      "id": "process",
      "impl": "syntra.match.process",
      "config": {
        "actionClass": "INTERNAL_WRITE"
      }
    }
  ],
  "edges": [
    [
      "__start__",
      "process"
    ],
    [
      "process",
      "__end__"
    ]
  ]
}'::jsonb,
  '5a1bc33cace6706acc9173859a4915f2cbe9f067b62e40a82da1189346d414b2',
  'active',
  'def.ts',
  now()
),
(
  'graph_resume_intake_v1',
  NULL::uuid,
  'resume.intake',
  1,
  '{
  "graphKey": "resume.intake",
  "agentName": "intake-agent",
  "stateSchema": "ResumeIntakeState",
  "entryInput": "ResumeReceivedPayload",
  "nodes": [
    {
      "id": "process",
      "impl": "syntra.resume.process",
      "config": {
        "actionClass": "INTERNAL_WRITE"
      }
    }
  ],
  "edges": [
    [
      "__start__",
      "process"
    ],
    [
      "process",
      "__end__"
    ]
  ]
}'::jsonb,
  'ff8039a464d3631f24255dedfe25ca7498e419b3992556aa26cce9911ee99aef',
  'active',
  'def.ts',
  now()
),
(
  'graph_duplicate_review_v1',
  NULL::uuid,
  'duplicate.review',
  1,
  '{
  "graphKey": "duplicate.review",
  "agentName": "intake-agent",
  "nodes": [
    {
      "id": "gate",
      "impl": "human.gate",
      "config": {
        "reason": "duplicate_review",
        "actionClass": "CONTROL"
      }
    }
  ],
  "edges": [
    [
      "__start__",
      "gate"
    ],
    [
      "gate",
      "__end__"
    ]
  ]
}'::jsonb,
  'f550b79836b741de603c1830cc2b49c6e526ed9554bcd66ad87b3510f8396835',
  'active',
  'def.ts',
  now()
),
(
  'graph_syntra_continuous_match_v1',
  NULL::uuid,
  'syntra.continuous.match',
  1,
  '{
  "graphKey": "syntra.continuous.match",
  "agentName": "matching-agent",
  "nodes": [
    {
      "id": "continuous",
      "impl": "syntra.continuous.match",
      "config": {
        "actionClass": "INTERNAL_WRITE"
      }
    }
  ],
  "edges": [
    [
      "__start__",
      "continuous"
    ],
    [
      "continuous",
      "__end__"
    ]
  ]
}'::jsonb,
  '8524ee7ad67a17e3fbde0871e09067d8237285689bb49be7232c7e57fa800086',
  'active',
  'def.ts',
  now()
),
(
  'graph_syntra_duplicate_detect_v1',
  NULL::uuid,
  'syntra.duplicate.detect',
  1,
  '{
  "graphKey": "syntra.duplicate.detect",
  "agentName": "intake-agent",
  "nodes": [
    {
      "id": "detect",
      "impl": "syntra.duplicate.detect",
      "config": {
        "actionClass": "INTERNAL_WRITE"
      }
    }
  ],
  "edges": [
    [
      "__start__",
      "detect"
    ],
    [
      "detect",
      "__end__"
    ]
  ]
}'::jsonb,
  'b299e4ee6f859504ea2b4a6e6e8ec206bd7a1e522b28116fe98da6c09539d52c',
  'active',
  'def.ts',
  now()
),
(
  'graph_orbit_lifecycle_v1',
  NULL::uuid,
  'orbit.lifecycle.workflow',
  1,
  '{
  "graphKey": "orbit.lifecycle.workflow",
  "agentName": "orbit",
  "nodes": [
    {
      "id": "transition",
      "impl": "orbit.lifecycle.transition",
      "config": {
        "actionClass": "INTERNAL_WRITE"
      }
    },
    {
      "id": "route",
      "impl": "orbit.route.decision",
      "config": {
        "actionClass": "CONTROL"
      }
    }
  ],
  "edges": [
    [
      "__start__",
      "transition"
    ],
    [
      "transition",
      "route"
    ],
    [
      "route",
      "__end__"
    ]
  ]
}'::jsonb,
  '863500cdff3f5cebddf1489e0ae083fe1923a77852035414448f689307a0f416',
  'active',
  'def.ts',
  now()
),
(
  'graph_orbit_placement_v1',
  NULL::uuid,
  'orbit.placement.workflow',
  1,
  '{
  "graphKey": "orbit.placement.workflow",
  "agentName": "orbit",
  "nodes": [
    {
      "id": "confirm",
      "impl": "orbit.placement.confirm",
      "config": {
        "actionClass": "INTERNAL_WRITE"
      }
    },
    {
      "id": "note",
      "impl": "orbit.activity.note",
      "config": {
        "actionClass": "INTERNAL_WRITE"
      }
    }
  ],
  "edges": [
    [
      "__start__",
      "confirm"
    ],
    [
      "confirm",
      "note"
    ],
    [
      "note",
      "__end__"
    ]
  ]
}'::jsonb,
  'ce43939dee8b7e7b0eaf4f4c1d35763367bc9cc5f98f562cab7c0b92c11ddc94',
  'active',
  'def.ts',
  now()
),
(
  'graph_orbit_revenue_v1',
  NULL::uuid,
  'orbit.revenue.workflow',
  1,
  '{
  "graphKey": "orbit.revenue.workflow",
  "agentName": "orbit",
  "nodes": [
    {
      "id": "arrange",
      "impl": "orbit.revenue.arrange",
      "config": {
        "actionClass": "INTERNAL_WRITE"
      }
    }
  ],
  "edges": [
    [
      "__start__",
      "arrange"
    ],
    [
      "arrange",
      "__end__"
    ]
  ]
}'::jsonb,
  '9a43a379dffddbb607d925f5cddfe5071648103bb066ebeaad7cd1033d832afe',
  'active',
  'def.ts',
  now()
),
(
  'graph_orbit_activity_v1',
  NULL::uuid,
  'orbit.activity.workflow',
  1,
  '{
  "graphKey": "orbit.activity.workflow",
  "agentName": "orbit",
  "nodes": [
    {
      "id": "note",
      "impl": "orbit.activity.note",
      "config": {
        "actionClass": "INTERNAL_WRITE"
      }
    }
  ],
  "edges": [
    [
      "__start__",
      "note"
    ],
    [
      "note",
      "__end__"
    ]
  ]
}'::jsonb,
  '4eb8d3c5fd85acdb8f3ef9920e2b8dff92584e042f1284ced5736ae515c214fb',
  'active',
  'def.ts',
  now()
)
), graph AS (
  INSERT INTO authoring.graphs
    (org_id, graph_key, application, title, status, created_by_label)
  SELECT s.org_id::uuid, s.graph_key,
         (SELECT a.key FROM platform.applications a
           WHERE a.key = split_part(s.graph_key, '.', 1)),
         s.graph_key,
         CASE WHEN s.status = 'active' THEN 'active' ELSE 'draft' END,
         s.created_by
    FROM seed s
  -- The index is on an expression, because a global workflow's org is NULL
  -- and NULL is not equal to itself.
  ON CONFLICT (coalesce(org_id::text, '~global~'), graph_key)
    DO UPDATE SET updated_at = now()
  RETURNING id, graph_key
)
INSERT INTO authoring.graph_versions
  (graph_id, org_id, version, definition, checksum, status,
   compiled_by_label, compiled_at)
SELECT g.id, s.org_id::uuid, s.version, s.definition, s.checksum,
       CASE WHEN s.status = 'active' THEN 'live' ELSE 'compiled' END,
       s.created_by, coalesce(s.activated_at, now())
  FROM seed s
  JOIN graph g ON g.graph_key = s.graph_key
-- No conflict target, deliberately: this must do nothing whether the clash is
-- the same (graph_id, version) or the partial index that allows one live
-- version per workflow. Either way something is already there and this file
-- does not get to overwrite it.
ON CONFLICT DO NOTHING;
