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
, graph AS (
  INSERT INTO authoring.graphs
    (org_id, graph_key, application, title, status, created_by_label)
  SELECT NULL, d.graph_key,
         (SELECT a.key FROM platform.applications a
           WHERE a.key = split_part(d.graph_key, '.', 1)),
         d.graph_key, 'active', 'R__seed_graph_definitions'
    FROM definitions d
  ON CONFLICT (coalesce(org_id::text, '~global~'), graph_key)
    DO UPDATE SET updated_at = now()
  RETURNING id, graph_key
)
INSERT INTO authoring.graph_versions
  (graph_id, org_id, version, definition, checksum, status,
   compiled_by_label, compiled_at)
SELECT g.id, NULL, 1, d.definition, md5(d.definition::text),
       'live', 'R__seed_graph_definitions', now()
FROM definitions d
JOIN graph g ON g.graph_key = d.graph_key
-- No conflict target: this does nothing whether the clash is the same
-- (graph_id, version) or the partial index that allows one live version per
-- workflow. Either way this file does not get to overwrite what is there.
ON CONFLICT DO NOTHING;
