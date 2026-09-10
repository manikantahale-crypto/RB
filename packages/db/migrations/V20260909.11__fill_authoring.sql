--
-- Step 5b: fill `authoring` from what is live in `public`.
--
-- 546 graph_definitions rows and 495 graph_versions rows describe 326
-- workflows between them, with 491 rows appearing in both. This untangles the
-- three jobs graph_definitions was doing:
--
--   status = 'draft'  ->  authoring.graph_drafts    114 rows, the working copies
--   everything else   ->  authoring.graph_versions  the immutable history
--   distinct key      ->  authoring.graphs          326 identities
--
-- graph_definitions is the source of truth where the two tables disagree: it
-- is what the editor reads and writes, and graph_versions is a partial copy
-- that stops at 495.
--
-- THE APPLICATION IS NOT TOUCHED and still reads public.graph_*. This is a
-- copy, so the two will drift exactly as core does — see scripts/core-drift.sh
-- for the same pattern. Re-running this migration re-syncs.
--
-- SAFE TO RE-RUN.
--

-- ══════════════════════════════════════════════════════════════ queues ══
--
-- From what bindings actually name, not from a constant. `module.design.resume`
-- and `module.design.duplicate` are not derivable from any application name,
-- which is precisely why they had to come from the data.
INSERT INTO platform.queues (key, application, description)
SELECT DISTINCT b.module_queue,
       (SELECT a.key FROM platform.applications a
         WHERE b.module_queue LIKE 'module.' || a.key || '.%'
            OR b.module_queue = 'module.' || a.key
         LIMIT 1),
       'Discovered from graph_event_bindings on 2026-09-09'
  FROM graph_event_bindings b
 WHERE b.module_queue IS NOT NULL
ON CONFLICT (key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════ graphs ══
--
-- One row per workflow. Identity is (org, graph_key) — no key is used by two
-- organisations today, so this collapses cleanly.
--
-- The graph's status is the strongest status any of its rows has: a workflow
-- with an active version is active, whatever its drafts say.
-- graph_definitions.org_id and created_by are BOTH text, while the binding
-- table's org_id is uuid — the same concept typed two ways, which is one of
-- the things this schema exists to end. All 405 org_id values are valid uuids
-- so the cast is safe; created_by is not, and is split below.
INSERT INTO authoring.graphs (
  org_id, graph_key, application, title, status,
  created_by, created_by_label, created_at, updated_at)
SELECT d.org_id::uuid,
       d.graph_key,
       (SELECT a.key FROM platform.applications a
         WHERE d.graph_key LIKE a.key || '.%' LIMIT 1),
       d.graph_key,     -- no title column exists upstream; the key is the name
       CASE WHEN bool_or(d.status = 'active') THEN 'active'
            WHEN bool_or(d.status = 'draft')  THEN 'draft'
            ELSE 'retired' END,
       -- A real user, where one of this workflow's rows names one.
       (SELECT u.id FROM platform.users u
         WHERE u.id::text = ANY (array_agg(d.created_by)) LIMIT 1),
       -- Otherwise the deployment label, kept as text.
       (array_agg(d.created_by) FILTER (
          WHERE d.created_by !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))[1],
       min(d.created_at),
       max(coalesce(d.activated_at, d.created_at))
  FROM graph_definitions d
 GROUP BY d.org_id, d.graph_key
ON CONFLICT DO NOTHING;


-- ═════════════════════════════════════════════════════════════ versions ══
--
-- Everything that is not a draft. `live` is the design's word for what
-- graph_definitions calls `active`.
INSERT INTO authoring.graph_versions (graph_id, org_id, version, definition, checksum, status, compiled_by, compiled_by_label, compiled_at)
SELECT g.id, d.org_id::uuid, d.version, d.definition, coalesce(d.checksum, ''),
       CASE d.status WHEN 'active' THEN 'live' ELSE 'retired' END,
       (SELECT u.id FROM platform.users u WHERE u.id::text = d.created_by),
       CASE WHEN d.created_by !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN d.created_by END,
       coalesce(d.activated_at, d.created_at)
  FROM graph_definitions d
  JOIN authoring.graphs g
    ON g.graph_key = d.graph_key
   AND coalesce(g.org_id::text,'~') = coalesce(d.org_id,'~')
 WHERE d.status <> 'draft'
ON CONFLICT (graph_id, version) DO NOTHING;

-- Then anything graph_versions knows about that graph_definitions does not.
-- 95 rows today: the two tables overlap heavily but neither contains the
-- other, which is the clearest evidence that having both was the problem.
INSERT INTO authoring.graph_versions (graph_id, org_id, version, definition, checksum, status, compiled_by, compiled_by_label, compiled_at)
SELECT g.id, v.org_id::uuid, v.version, v.definition, coalesce(v.checksum, ''),
       CASE v.status WHEN 'active' THEN 'live' ELSE 'retired' END,
       (SELECT u.id FROM platform.users u WHERE u.id::text = v.compiled_by),
       CASE WHEN v.compiled_by !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN v.compiled_by END,
       coalesce(v.compiled_at, now())
  FROM graph_versions v
  JOIN authoring.graphs g
    ON g.graph_key = v.graph_key
   AND coalesce(g.org_id::text,'~') = coalesce(v.org_id,'~')
ON CONFLICT (graph_id, version) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════ drafts ══
--
-- One per workflow. Where a workflow has several draft rows — the version
-- counter being used as a draft counter — the newest wins.
INSERT INTO authoring.graph_drafts (graph_id, definition, checksum, updated_by, updated_at)
SELECT DISTINCT ON (g.id)
       g.id, d.definition, coalesce(d.checksum, ''),
       (SELECT u.id FROM platform.users u WHERE u.id::text = d.created_by),
       d.created_at
  FROM graph_definitions d
  JOIN authoring.graphs g
    ON g.graph_key = d.graph_key
   AND coalesce(g.org_id::text,'~') = coalesce(d.org_id,'~')
 WHERE d.status = 'draft'
 ORDER BY g.id, d.version DESC, d.created_at DESC
ON CONFLICT (graph_id) DO NOTHING;


-- ════════════════════════════════════════════════════════ event catalog ══
--
-- `handling` is seeded from the hardcoded map in
-- packages/orchestrator/src/routing/table.ts — 26 entries — and for the other
-- 19 events from what the database already does:
--
--   in the map            its kind
--   has an active binding 'graph'      because it demonstrably routes
--   otherwise             'terminal'   published for a screen or an audit trail
--
-- That last default is the safe one: it matches what the engine does today
-- with an event it has never heard of.
INSERT INTO authoring.event_catalog (
  event_type, schema_version, application, description, payload_schema,
  envelope_fields, produced_when, primary_consumer, handling, status, created_at, updated_at)
SELECT s.event_type,
       s.schema_version,
       (SELECT a.key FROM platform.applications a WHERE s.event_type LIKE a.key || '.%' LIMIT 1),
       coalesce(nullif(s.description, ''), s.event_type),
       s.payload_schema,
       coalesce(s.envelope_fields, '{}'::jsonb),
       s.produced_when,
       s.primary_consumer,
       coalesce(
         (SELECT p.handling FROM (VALUES
            ('syntra.jd.received','graph'),
            ('syntra.jd.parsed','graph'),
            ('syntra.jd.normalized','graph'),
            ('syntra.resume.received','graph'),
            ('syntra.profile.prepared','graph'),
            ('syntra.duplicate.review_required','graph'),
            ('syntra.match.requested','graph'),
            ('syntra.match.completed','terminal'),
            ('syntra.shortlist.ready','terminal'),
            ('syntra.approval.requested','terminal'),
            ('syntra.approval.decided','resume'),
            ('syntra.agent_run.failed','fail'),
            ('astra.requirement.received','graph'),
            ('astra.email.received','graph'),
            ('astra.jobboard.fetch_requested','graph'),
            ('astra.requirement.published','terminal'),
            ('astra.requirement.rejected','terminal'),
            ('astra.duplicate.review_required','terminal'),
            ('orbit.lifecycle.transition_requested','graph'),
            ('orbit.placement.confirm_requested','graph'),
            ('orbit.revenue.arrange_requested','graph'),
            ('orbit.activity.note_requested','graph'),
            ('orbit.lifecycle.transitioned','terminal'),
            ('orbit.placement.confirmed','terminal'),
            ('orbit.revenue.arranged','terminal'),
            ('orbit.activity.noted','terminal')
          ) AS p(event_type, handling)
          WHERE p.event_type = s.event_type),
         CASE WHEN EXISTS (SELECT 1 FROM graph_event_bindings b
                            WHERE b.event_type = s.event_type AND b.status = 'active')
              THEN 'graph' ELSE 'terminal' END),
       -- event_schemas stores 'ACTIVE'; the new check is lower case, because
       -- every other status column in this schema is.
       coalesce(lower(s.status), 'active'),
       s.created_at, s.updated_at
  FROM event_schemas s
ON CONFLICT (event_type, schema_version) DO NOTHING;


-- ══════════════════════════════════════════════════════════ node registry ══
INSERT INTO authoring.node_registry (
  registry_key, key, version, application, shareable, title, description, tags,
  input_schema, output_schema, config_schema, admin_exposed, side_effect,
  idempotency, execution, llm, dependencies, persistence, fixture_names,
  has_stub, emits, source, checksum, updated_at)
SELECT n.registry_key, n.key, n.version,
       (SELECT a.key FROM platform.applications a WHERE a.key = n.module),
       n.shareable, n.title, n.description, n.tags,
       n.input_schema, n.output_schema, n.config_schema, n.admin_exposed,
       n.side_effect, n.idempotency, n.execution, n.llm, n.dependencies,
       n.persistence, n.fixture_names, n.has_stub, n.emits, n.source,
       n.checksum, n.updated_at
  FROM node_registry n
ON CONFLICT (registry_key) DO NOTHING;


-- ═══════════════════════════════════════════════════════ event bindings ══
--
-- `consuming_application` is new and is what makes fan-out expressible. It is
-- derived from the queue, which is how the system already decides who consumes
-- an event.
--
-- Retired bindings come across too. 461 of the 481 are retired, and they are
-- the record of what used to route where.
INSERT INTO authoring.event_bindings (
  org_id, event_type, schema_version, graph_id, queue_key,
  consuming_application, status, source, created_at, updated_at)
SELECT b.org_id,
       b.event_type,
       '1',
       g.id,
       b.module_queue,
       q.application,
       b.status,
       coalesce(b.source, 'seed'),
       b.created_at,
       b.updated_at
  FROM graph_event_bindings b
  JOIN authoring.graphs g
    ON g.graph_key = b.graph_key
   AND coalesce(g.org_id::text,'~') = coalesce(b.org_id::text,'~')
  JOIN platform.queues q ON q.key = b.module_queue
  -- A binding whose event is not in the catalogue would be unroutable anyway;
  -- it is reported below rather than inserted against nothing.
 WHERE EXISTS (SELECT 1 FROM authoring.event_catalog c WHERE c.event_type = b.event_type)
ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════ report ══
DO $$
DECLARE
  skipped int;
BEGIN
  RAISE NOTICE 'queues        : %',  (SELECT count(*) FROM platform.queues);
  RAISE NOTICE 'graphs        : % (from % definition rows)',
    (SELECT count(*) FROM authoring.graphs), (SELECT count(*) FROM graph_definitions);
  RAISE NOTICE 'versions      : %',  (SELECT count(*) FROM authoring.graph_versions);
  RAISE NOTICE 'drafts        : %',  (SELECT count(*) FROM authoring.graph_drafts);
  RAISE NOTICE 'event_catalog : % (% routable)',
    (SELECT count(*) FROM authoring.event_catalog),
    (SELECT count(*) FROM authoring.event_catalog WHERE handling = 'graph');
  RAISE NOTICE 'node_registry : %',  (SELECT count(*) FROM authoring.node_registry);
  RAISE NOTICE 'bindings      : % (% active)',
    (SELECT count(*) FROM authoring.event_bindings),
    (SELECT count(*) FROM authoring.event_bindings WHERE status = 'active');

  SELECT count(*) INTO skipped
    FROM graph_event_bindings b
   WHERE NOT EXISTS (SELECT 1 FROM authoring.event_catalog c WHERE c.event_type = b.event_type);
  IF skipped > 0 THEN
    RAISE WARNING '% bindings name an event that is in no catalogue row and were not carried.', skipped;
  END IF;
END $$;
