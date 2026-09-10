--
-- Keep `authoring` current while the code moves onto it.
--
-- V20260909.11 filled authoring from public as a one-off copy. Nothing has
-- written to graph_definitions since 2026-09-08, so it is still accurate — by
-- luck, not design. The moment somebody opens the editor it starts drifting,
-- and a stale authoring layer is worse than none: it looks authoritative.
--
-- Same approach as core: mirror on write, then move reads one file at a time,
-- then move writes and remove this.
--
-- THIS ONE IS HARDER THAN THE CORE MIRROR
--
-- core was one table to one table. Here ONE graph_definitions row becomes a row
-- in one of three tables, decided by its status:
--
--   the workflow's identity  -> authoring.graphs        (always, once per key)
--   status = 'draft'         -> authoring.graph_drafts  (one per graph)
--   anything else            -> authoring.graph_versions
--
-- That split is the point of the whole layer. graph_definitions was doing all
-- three jobs at once, which is how a binding ended up pointing at version 119.
--
-- SAFE TO RE-RUN.
--

-- ═══════════════════════════════════════════ graph_definitions -> three ══
CREATE OR REPLACE FUNCTION app.mirror_graph_definition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_graph_id uuid;
  v_org      uuid;
  v_user     uuid;
  v_label    text;
BEGIN
  -- org_id is text here and uuid in authoring — the same concept typed two
  -- ways, which is one of the things this layer exists to end. Every value is
  -- a valid uuid; a malformed one would be a bug worth failing on.
  v_org := nullif(NEW.org_id, '')::uuid;

  -- created_by holds two different kinds of thing: a few real user ids and
  -- several hundred deployment labels like 'stage-v31-relay'. Both are
  -- provenance; they are stored as what they actually are.
  SELECT u.id INTO v_user FROM platform.users u WHERE u.id::text = NEW.created_by;
  IF v_user IS NULL THEN v_label := NEW.created_by; END IF;

  INSERT INTO authoring.graphs (
    org_id, graph_key, application, title, status,
    created_by, created_by_label, created_at, updated_at)
  VALUES (
    v_org, NEW.graph_key,
    (SELECT a.key FROM platform.applications a WHERE NEW.graph_key LIKE a.key || '.%' LIMIT 1),
    NEW.graph_key, CASE WHEN NEW.status = 'active' THEN 'active' ELSE 'draft' END,
    v_user, v_label, NEW.created_at, coalesce(NEW.activated_at, NEW.created_at))
  ON CONFLICT (coalesce(org_id::text, '~global~'), graph_key) DO UPDATE SET
    -- A workflow with an active version is active, whatever its drafts say.
    status = CASE WHEN NEW.status = 'active' THEN 'active' ELSE authoring.graphs.status END,
    updated_at = greatest(authoring.graphs.updated_at, coalesce(NEW.activated_at, NEW.created_at))
  RETURNING id INTO v_graph_id;

  IF v_graph_id IS NULL THEN
    SELECT g.id INTO v_graph_id FROM authoring.graphs g
     WHERE g.graph_key = NEW.graph_key
       AND coalesce(g.org_id::text, '~') = coalesce(NEW.org_id, '~');
  END IF;

  IF NEW.status = 'draft' THEN
    -- One editable copy per workflow, replaced in place. A draft is not a
    -- version and never gets a version number.
    INSERT INTO authoring.graph_drafts (graph_id, definition, checksum, updated_by, updated_at)
    VALUES (v_graph_id, NEW.definition, coalesce(NEW.checksum, ''), v_user, NEW.created_at)
    ON CONFLICT (graph_id) DO UPDATE SET
      definition = EXCLUDED.definition,
      checksum   = EXCLUDED.checksum,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;
  ELSE
    INSERT INTO authoring.graph_versions (
      graph_id, org_id, version, definition, checksum, status,
      compiled_by, compiled_by_label, compiled_at)
    VALUES (
      v_graph_id, v_org, NEW.version, NEW.definition, coalesce(NEW.checksum, ''),
      CASE NEW.status WHEN 'active' THEN 'live' ELSE 'retired' END,
      v_user, v_label, coalesce(NEW.activated_at, NEW.created_at))
    ON CONFLICT (graph_id, version) DO UPDATE SET
      definition = EXCLUDED.definition,
      checksum   = EXCLUDED.checksum,
      status     = EXCLUDED.status;
  END IF;

  RETURN NEW;
END $$;


-- ═══════════════════════════════════ graph_event_bindings -> bindings ══
CREATE OR REPLACE FUNCTION app.mirror_event_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_graph_id uuid;
BEGIN
  SELECT g.id INTO v_graph_id
    FROM authoring.graphs g
   WHERE g.graph_key = NEW.graph_key
     AND coalesce(g.org_id, '00000000-0000-0000-0000-000000000000')
       = coalesce(NEW.org_id, '00000000-0000-0000-0000-000000000000');

  -- A binding naming a workflow that does not exist cannot be represented, and
  -- inventing a graph row to hold it would hide a real fault.
  IF v_graph_id IS NULL THEN
    RAISE WARNING 'authoring mirror skipped binding on % — no workflow named %',
      NEW.event_type, NEW.graph_key;
    RETURN NEW;
  END IF;

  -- The queue must exist: it is a foreign key, and a typo here is how a
  -- binding ends up on a queue nothing serves.
  INSERT INTO platform.queues (key, description)
  VALUES (NEW.module_queue, 'Discovered from a binding')
  ON CONFLICT (key) DO NOTHING;

  INSERT INTO authoring.event_bindings (
    id, org_id, event_type, schema_version, graph_id, queue_key,
    consuming_application, status, source, created_at, updated_at)
  VALUES (
    NEW.id, NEW.org_id, NEW.event_type, '1', v_graph_id, NEW.module_queue,
    (SELECT q.application FROM platform.queues q WHERE q.key = NEW.module_queue),
    NEW.status, coalesce(NEW.source, 'seed'), NEW.created_at, NEW.updated_at)
  ON CONFLICT (id) DO UPDATE SET
    graph_id   = EXCLUDED.graph_id,
    queue_key  = EXCLUDED.queue_key,
    status     = EXCLUDED.status,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END $$;


-- ══════════════════════════════════════ event_schemas -> event_catalog ══
CREATE OR REPLACE FUNCTION app.mirror_event_schema()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO authoring.event_catalog (
    event_type, schema_version, application, description, payload_schema,
    envelope_fields, produced_when, primary_consumer, status, created_at, updated_at)
  VALUES (
    NEW.event_type, NEW.schema_version,
    (SELECT a.key FROM platform.applications a WHERE NEW.event_type LIKE a.key || '.%' LIMIT 1),
    coalesce(nullif(NEW.description, ''), NEW.event_type),
    NEW.payload_schema, coalesce(NEW.envelope_fields, '{}'::jsonb),
    NEW.produced_when, NEW.primary_consumer,
    coalesce(lower(NEW.status), 'active'), NEW.created_at, NEW.updated_at)
  ON CONFLICT (event_type, schema_version) DO UPDATE SET
    description      = EXCLUDED.description,
    payload_schema   = EXCLUDED.payload_schema,
    envelope_fields  = EXCLUDED.envelope_fields,
    produced_when    = EXCLUDED.produced_when,
    primary_consumer = EXCLUDED.primary_consumer,
    status           = EXCLUDED.status,
    updated_at       = EXCLUDED.updated_at;
    -- `handling` is deliberately NOT overwritten. It is the one column the
    -- catalogue owns and the source does not have: what the platform does with
    -- this event. Copying a default over it on every write would undo whatever
    -- an operator set.

  RETURN NEW;
END $$;


-- ═══════════════════════════════════════ node_registry -> node_registry ══
CREATE OR REPLACE FUNCTION app.mirror_node_registry()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO authoring.node_registry (
    registry_key, key, version, application, shareable, title, description,
    tags, input_schema, output_schema, config_schema, admin_exposed,
    side_effect, idempotency, execution, llm, dependencies, persistence,
    fixture_names, has_stub, emits, source, checksum, updated_at)
  VALUES (
    NEW.registry_key, NEW.key, NEW.version,
    (SELECT a.key FROM platform.applications a WHERE a.key = NEW.module),
    NEW.shareable, NEW.title, NEW.description, NEW.tags, NEW.input_schema,
    NEW.output_schema, NEW.config_schema, NEW.admin_exposed, NEW.side_effect,
    NEW.idempotency, NEW.execution, NEW.llm, NEW.dependencies, NEW.persistence,
    NEW.fixture_names, NEW.has_stub, NEW.emits, NEW.source, NEW.checksum,
    NEW.updated_at)
  ON CONFLICT (registry_key) DO UPDATE SET
    version = EXCLUDED.version, shareable = EXCLUDED.shareable,
    title = EXCLUDED.title, description = EXCLUDED.description,
    tags = EXCLUDED.tags, input_schema = EXCLUDED.input_schema,
    output_schema = EXCLUDED.output_schema, config_schema = EXCLUDED.config_schema,
    admin_exposed = EXCLUDED.admin_exposed, side_effect = EXCLUDED.side_effect,
    idempotency = EXCLUDED.idempotency, execution = EXCLUDED.execution,
    llm = EXCLUDED.llm, dependencies = EXCLUDED.dependencies,
    persistence = EXCLUDED.persistence, fixture_names = EXCLUDED.fixture_names,
    has_stub = EXCLUDED.has_stub, emits = EXCLUDED.emits,
    source = EXCLUDED.source, checksum = EXCLUDED.checksum,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END $$;


CREATE OR REPLACE TRIGGER graph_definitions_mirror_authoring
  AFTER INSERT OR UPDATE ON public.graph_definitions
  FOR EACH ROW EXECUTE FUNCTION app.mirror_graph_definition();

CREATE OR REPLACE TRIGGER graph_event_bindings_mirror_authoring
  AFTER INSERT OR UPDATE ON public.graph_event_bindings
  FOR EACH ROW EXECUTE FUNCTION app.mirror_event_binding();

CREATE OR REPLACE TRIGGER event_schemas_mirror_authoring
  AFTER INSERT OR UPDATE ON public.event_schemas
  FOR EACH ROW EXECUTE FUNCTION app.mirror_event_schema();

CREATE OR REPLACE TRIGGER node_registry_mirror_authoring
  AFTER INSERT OR UPDATE ON public.node_registry
  FOR EACH ROW EXECUTE FUNCTION app.mirror_node_registry();


DO $$
BEGIN
  RAISE NOTICE 'authoring now follows public on write: % graphs, % versions, % drafts, % bindings.',
    (SELECT count(*) FROM authoring.graphs),
    (SELECT count(*) FROM authoring.graph_versions),
    (SELECT count(*) FROM authoring.graph_drafts),
    (SELECT count(*) FROM authoring.event_bindings);
END $$;
