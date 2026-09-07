-- Repeatable seed: three single-step workflows the router needs to exist.
--
-- CREATE IF ABSENT. NEVER OVERWRITE.
--
-- This began with a DELETE of the three keys below, on every migration run.
-- That was safe while nothing else wrote them and unsafe the moment something
-- did: against the live database it would have removed a workflow version a
-- later migration had put in place, and a draft somebody was working on.
--
-- `created_by` used to be gen_random_uuid(), which made these rows look as
-- though a person had authored them. Two of them were reported as
-- user-authored on that basis. It now says what actually made them.


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
  'R__seed_graph_definitions' as created_by,
  now() as activated_at
FROM definitions d
ON CONFLICT DO NOTHING;
