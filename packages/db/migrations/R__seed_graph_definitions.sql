DELETE FROM graph_definitions WHERE graph_key IN ('syntra.jd.workflow', 'syntra.resume.workflow', 'syntra.match.workflow') AND org_id IS NULL;

WITH definitions(graph_key, definition) AS (
  VALUES
  (
    'syntra.jd.workflow',
    '{
      "graphKey": "syntra.jd.workflow",
      "stateSchema": "SyntraState",
      "entryInput": "trigger_event",
      "nodes": [
        { "id": "process", "impl": "syntra.jd.process" }
      ],
      "edges": [
        ["__start__", "process"],
        ["process", "__end__"]
      ]
    }'::jsonb
  ),
  (
    'syntra.resume.workflow',
    '{
      "graphKey": "syntra.resume.workflow",
      "stateSchema": "SyntraState",
      "entryInput": "trigger_event",
      "nodes": [
        { "id": "process", "impl": "syntra.resume.process" }
      ],
      "edges": [
        ["__start__", "process"],
        ["process", "__end__"]
      ]
    }'::jsonb
  ),
  (
    'syntra.match.workflow',
    '{
      "graphKey": "syntra.match.workflow",
      "stateSchema": "SyntraState",
      "entryInput": "trigger_event",
      "nodes": [
        { "id": "process", "impl": "syntra.match.process" }
      ],
      "edges": [
        ["__start__", "process"],
        ["process", "__end__"]
      ]
    }'::jsonb
  )
)
INSERT INTO graph_definitions (id, graph_key, version, definition, checksum, status, created_by, activated_at)
SELECT
  gen_random_uuid() as id,
  d.graph_key,
  1 as version,
  d.definition,
  md5(d.definition::text) as checksum,
  'active' as status,
  gen_random_uuid() as created_by,
  now() as activated_at
FROM definitions d;
