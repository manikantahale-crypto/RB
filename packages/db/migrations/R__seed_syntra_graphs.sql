-- Repeatable seed: Syntra JD / resume / match graph topologies (global, active).
-- Uses design-doc columns: id text, org_id text.

DELETE FROM graph_definitions
WHERE org_id IS NULL
  AND graph_key IN ('syntra.jd.workflow', 'syntra.resume.workflow', 'syntra.match.workflow')
  AND version = 1;

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
      { "id": "process", "impl": "syntra.jd.process" }
    ],
    "edges": [
      ["__start__", "process"],
      ["process", "__end__"]
    ]
  }'::jsonb,
  'seed-syntra-jd-v1',
  'active',
  'seed',
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
      { "id": "process", "impl": "syntra.resume.process" }
    ],
    "edges": [
      ["__start__", "process"],
      ["process", "__end__"]
    ]
  }'::jsonb,
  'seed-syntra-resume-v1',
  'active',
  'seed',
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
      { "id": "process", "impl": "syntra.match.process" }
    ],
    "edges": [
      ["__start__", "process"],
      ["process", "__end__"]
    ]
  }'::jsonb,
  'seed-syntra-match-v1',
  'active',
  'seed',
  now()
);
