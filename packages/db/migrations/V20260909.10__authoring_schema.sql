--
-- Step 5a: the `authoring` layer.
--
-- Designing and releasing a workflow, separated from running one. The tables
-- exist today in `public` with the right ideas and almost no constraints:
-- `graph_definitions` is doing three jobs at once — the identity of a workflow,
-- its editable draft, and a version counter — which is how one binding ended up
-- pointing at version 119.
--
-- Here that becomes three tables with one job each:
--
--   authoring.graphs          identity. One row per workflow, ever.
--   authoring.graph_drafts    the editable working copy. One per graph.
--   authoring.graph_versions  immutable. What actually ran.
--
-- PURELY ADDITIVE, AND EMPTY. Rows arrive in V20260909.11. The application
-- keeps reading and writing public.graph_definitions throughout.
--
-- SAFE TO RE-RUN.
--

CREATE SCHEMA IF NOT EXISTS authoring;


-- ══════════════════════════════════════════ two platform tables it needs ══

-- Queues are named in bindings as free text today, so a typo produces a
-- binding whose jobs nothing ever collects — silently. Seven queues are in
-- use; they become rows, and the binding's queue becomes a foreign key.
CREATE TABLE IF NOT EXISTS platform.queues (
  key         text PRIMARY KEY,
  application text REFERENCES platform.applications (key),
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Granularity within an application, for entitlements. Empty for now: it is
-- what `requires_feature` on a binding points at, and nothing sells features
-- separately yet.
CREATE TABLE IF NOT EXISTS platform.features (
  key             text PRIMARY KEY,
  application_key text NOT NULL REFERENCES platform.applications (key),
  name            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);


-- ════════════════════════════════════════════════════════════════ graphs ══
--
-- org_id NULL means a platform-provided workflow every customer can run;
-- non-null means one customer authored their own. That ships standard
-- workflows and still allows customisation, without having to decide the whole
-- question now.
CREATE TABLE IF NOT EXISTS authoring.graphs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        REFERENCES platform.organizations (id),
  graph_key   text        NOT NULL,
  application text        REFERENCES platform.applications (key),
  title       text        NOT NULL,
  status      text        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','active','retired')),
  created_by  uuid        REFERENCES platform.users (id),
  -- The upstream graph_definitions.created_by is text and holds two different
  -- kinds of thing: 3 rows have a real user id, 543 have a deployment label
  -- such as 'stage-v31-relay' or 'test'. Both are provenance and neither
  -- should be thrown away, so the id goes above, typed and constrained, and
  -- the label is kept here as what it actually is.
  created_by_label text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);

-- One workflow per key per tenant. No key is shared across organisations
-- today, so this constrains rather than hopes.
CREATE UNIQUE INDEX IF NOT EXISTS graphs_key_per_org_idx
  ON authoring.graphs (coalesce(org_id::text, '~global~'), graph_key);


-- ═══════════════════════════════════════════════════════════════ drafts ══
--
-- One editable copy per workflow, replaced in place. A draft is not a version
-- and never gets a version number — that conflation is what produced 114
-- "draft" rows competing with 32 active ones in a single table.
CREATE TABLE IF NOT EXISTS authoring.graph_drafts (
  graph_id   uuid PRIMARY KEY REFERENCES authoring.graphs (id) ON DELETE CASCADE,
  definition jsonb       NOT NULL,
  checksum   text        NOT NULL,
  updated_by uuid        REFERENCES platform.users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);


-- ═════════════════════════════════════════════════════════════ versions ══
--
-- Immutable. A run pins one of these and finishes on it however many times the
-- workflow is republished mid-flight.
CREATE TABLE IF NOT EXISTS authoring.graph_versions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id    uuid        NOT NULL,
  org_id      uuid,
  version     integer     NOT NULL,
  definition  jsonb       NOT NULL,
  checksum    text        NOT NULL,
  status      text        NOT NULL DEFAULT 'compiled'
                          CHECK (status IN ('compiled','live','retired')),
  compiled_by uuid        REFERENCES platform.users (id),
  compiled_by_label text,   -- see the note on authoring.graphs.created_by_label
  compiled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (graph_id, version),
  UNIQUE (id, org_id),
  FOREIGN KEY (graph_id, org_id) REFERENCES authoring.graphs (id, org_id)
);

-- One live version per workflow, enforced rather than assumed.
CREATE UNIQUE INDEX IF NOT EXISTS graph_versions_one_live_idx
  ON authoring.graph_versions (graph_id) WHERE status = 'live';


-- ════════════════════════════════════════════════════════ event catalog ══
--
-- Three columns the current event_schemas table does not have:
--
--   application  who owns this event, today inferable only from the name prefix
--   visibility   what the entitlement filter reads
--   handling     THE IMPORTANT ONE
--
-- `handling` is what removes the biggest restriction in the system. The engine
-- decides what to do with an event by consulting a hardcoded map of 26 entries
-- compiled into it, so registering a new event needs a code change and a
-- release — and an event missing from that map was acknowledged and dropped
-- however correct the workflow behind it was. That fault silently killed
-- RELAY's two active bindings.
--
-- Once planForEvent() reads this column instead, a new event is a row.
CREATE TABLE IF NOT EXISTS authoring.event_catalog (
  event_type       text        NOT NULL,
  schema_version   text        NOT NULL,
  application      text        REFERENCES platform.applications (key),
  description      text        NOT NULL,
  payload_schema   jsonb       NOT NULL,
  envelope_fields  jsonb       NOT NULL DEFAULT '{}',
  produced_when    text,
  primary_consumer text,
  visibility       text        NOT NULL DEFAULT 'public'
                               CHECK (visibility IN ('public','application')),
  handling         text        NOT NULL DEFAULT 'terminal'
                               CHECK (handling IN ('graph','terminal','resume','fail')),
  status           text        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('draft','active','deprecated')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_type, schema_version)
);


-- ═══════════════════════════════════════════════════════ node registry ══
--
-- Unchanged in substance — global, generated from the node contracts in git by
-- a build step that already fails CI on drift, which is the right design. It
-- moves here because it describes what an author may place in a workflow.
CREATE TABLE IF NOT EXISTS authoring.node_registry (
  registry_key  text PRIMARY KEY,
  key           text NOT NULL,
  -- Semver, not an integer. A node version is '1.0.0'; a GRAPH version is an
  -- integer counter. Two different kinds of version that are easy to conflate.
  version       text NOT NULL,
  application   text REFERENCES platform.applications (key),
  shareable     boolean NOT NULL DEFAULT false,
  title         text NOT NULL,
  description   text,
  tags          jsonb,
  input_schema  jsonb,
  output_schema jsonb,
  config_schema jsonb,
  admin_exposed jsonb,
  side_effect   text,
  idempotency   text,
  execution     text,
  llm           jsonb,
  dependencies  jsonb,
  persistence   jsonb,
  fixture_names jsonb,
  has_stub      boolean,
  -- The events a node declares it may publish. What makes the chain view
  -- accurate rather than approximate, and a dead-end detectable.
  emits         jsonb,
  source        text NOT NULL DEFAULT 'contract',
  checksum      text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);


-- ═══════════════════════════════════════════════════════ event bindings ══
--
-- Where three problems get solved at once.
--
-- 1 FAN-OUT BECOMES REPRESENTABLE. Uniqueness moves from (org, event_type) to
--   (org, event_type, consuming_application). A second application binding the
--   same event means both run — that is fan-out. A second workflow in the SAME
--   application is still refused, because there the right answer is another
--   node on the existing workflow, not a second binding.
--
--   Checked: 0 current bindings conflict with the new rule.
--
--   NOTE: the router is not rewired yet. It still reads
--   public.graph_event_bindings with LIMIT 1. Until it moves, this table can
--   express fan-out that nothing acts on.
--
-- 2 A DRAFT BINDING CAN BE STORED. The live table's CHECK allows only active
--   and retired, so a trigger has to travel inside the graph definition until
--   it goes live. Here 'draft' is a status and the trigger is a visible row.
--
-- 3 THE POINTERS ARE REAL. graph_id and pinned_version_id are foreign keys,
--   not a string key and an integer that nothing checks.
CREATE TABLE IF NOT EXISTS authoring.event_bindings (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid        REFERENCES platform.organizations (id),
  event_type            text        NOT NULL,
  schema_version        text        NOT NULL DEFAULT '1',
  graph_id              uuid        NOT NULL,
  -- NULL means follow whichever version is live. A pin is for a canary or a
  -- deliberate hold, not the normal case.
  pinned_version_id     uuid        REFERENCES authoring.graph_versions (id),
  queue_key             text        NOT NULL REFERENCES platform.queues (key),
  consuming_application text        REFERENCES platform.applications (key),
  priority              integer     NOT NULL DEFAULT 100,
  condition             jsonb,
  requires_feature      text        REFERENCES platform.features (key),
  status                text        NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft','active','retired')),
  source                text        NOT NULL DEFAULT 'authoring',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (graph_id, org_id) REFERENCES authoring.graphs (id, org_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS event_bindings_one_active_idx
  ON authoring.event_bindings (
       coalesce(org_id::text, '~global~'),
       event_type,
       coalesce(consuming_application, '~none~'))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS event_bindings_event_idx
  ON authoring.event_bindings (event_type) WHERE status = 'active';


DO $$
BEGIN
  IF to_regprocedure('app.set_updated_at()') IS NOT NULL THEN
    CREATE OR REPLACE TRIGGER authoring_graphs_updated_at
      BEFORE UPDATE ON authoring.graphs
      FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
    CREATE OR REPLACE TRIGGER authoring_bindings_updated_at
      BEFORE UPDATE ON authoring.event_bindings
      FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
  END IF;
  RAISE NOTICE 'authoring: 6 tables, platform: queues and features. All empty.';
END $$;
