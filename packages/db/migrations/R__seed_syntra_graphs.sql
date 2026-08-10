-- AUTO-GENERATED from packages/orchestrator/src/graphs/defs/*.def.ts
-- Do not edit by hand. Regenerate with:
--   npm run generate:graph-seeds -w @tekisho/orchestrator
--
-- Repeatable Flyway seed: graph recipes (global scope).

DELETE FROM graph_definitions
WHERE org_id IS NULL
  AND graph_key IN ('syntra.jd.workflow', 'syntra.resume.workflow', 'syntra.match.workflow');

INSERT INTO graph_definitions (
  id, org_id, graph_key, version, definition, checksum, status, created_by, activated_at
) VALUES
(
  'graph_syntra_jd_v1',
  NULL,
  'syntra.jd.workflow',
  1,
  '{
  "graphKey": "syntra.jd.workflow",
  "nodes": [
    {
      "id": "process",
      "impl": "syntra.jd.process"
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
  '65c1131ba3fc2b922c74cf713b692f73d11d839d43dbd2fa6c17570b37004382',
  'active',
  'def.ts',
  now()
),
(
  'graph_syntra_resume_v1',
  NULL,
  'syntra.resume.workflow',
  1,
  '{
  "graphKey": "syntra.resume.workflow",
  "nodes": [
    {
      "id": "process",
      "impl": "syntra.resume.process"
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
  '5d58f9d24264a5cf69c3638e5c066e6ae9f5eaf5b3a4d61c7fc6dbd798037a66',
  'active',
  'def.ts',
  now()
),
(
  'graph_syntra_match_v1',
  NULL,
  'syntra.match.workflow',
  1,
  '{
  "graphKey": "syntra.match.workflow",
  "nodes": [
    {
      "id": "process",
      "impl": "syntra.match.process"
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
  'd6aa4890b5ca6f2ba17a67a04dffe00f3c81a2b7ec7414e6e294d3b12685b952',
  'active',
  'def.ts',
  now()
);
