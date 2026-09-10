--
-- The outbox moves to `orch`, and `public.event_outbox` becomes a view of it.
--
-- This is the hottest table in the database and the one every application
-- writes to, so it moves differently from the others. No mirror, no copy, no
-- window where a row could land in one place and be read from another:
-- SET SCHEMA is a catalogue rename. The same 22,488 rows, the same indexes,
-- the same identity sequence, under a new name.
--
-- WHY A VIEW RATHER THAN A MIRROR
--
-- Every other move left the old table in place, fed by a trigger, because two
-- tables had to hold the same rows for a while. Here one table can wear two
-- names. An auto-updatable view over a single table is not a copy of it — it
-- IS it — so RELAY, INTERVIEW, PRISM and anything else still saying
-- `public.event_outbox` read and write the very rows the orchestrator reads,
-- with no trigger between them and nothing to drift.
--
-- Verified rather than assumed: through the view, an INSERT that omits the
-- defaulted columns still gets `schema_version = '1.0'`, `producer = 'api'`,
-- `occurred_at = now()` and a generated `id`, and UPDATE, DELETE and RETURNING
-- all behave as they did against the table.
--
-- security_invoker is what keeps that honest. A view is normally evaluated as
-- its owner, which would let a caller through the view see rows the base
-- table's row-level security would have refused. The outbox has RLS enabled
-- and forced with no policies today, and only `postgres` — which bypasses RLS
-- — holds grants, so nothing changes now. It changes the day somebody writes
-- the first policy, and on that day the view must not be the hole in it.
--
-- SAFE TO RE-RUN.
--

-- ══════════════════════════════════════════════════════════ 1 · the move ══
--
-- Indexes, constraints and the identity sequence follow the table. There is a
-- brief ACCESS EXCLUSIVE lock, which is why this is worth doing while the
-- outbox is drained: all 22,488 rows are published and none is in flight.
DO $$
BEGIN
  IF to_regclass('public.event_outbox') IS NOT NULL
     AND to_regclass('orch.event_outbox') IS NULL THEN
    ALTER TABLE public.event_outbox SET SCHEMA orch;
    RAISE NOTICE 'public.event_outbox -> orch.event_outbox';
  END IF;
END $$;


-- ═══════════════════════════════════════════ 2 · the keys point forward ══
--
-- Both foreign keys still named tables in `public` that are now copies:
--
--   (event_type, schema_version) -> public.event_schemas
--   organization_id              -> public.organizations
--
-- The catalogue one matters most. V20260909.34 had to keep feeding the legacy
-- event_schemas precisely because this key pointed at it, so an event
-- registered only in the catalogue could not be published. Pointing it at the
-- catalogue is what closes that loop.
--
-- Checked before repointing: 0 of 22,488 rows name an organisation missing
-- from platform.organizations, and 0 name an event missing from the catalogue.
-- So these are added validated rather than NOT VALID — there is nothing to
-- forgive.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'orch.event_outbox'::regclass
       AND conname = 'event_outbox_event_type_schema_version_fkey'
       AND confrelid = 'public.event_schemas'::regclass
  ) THEN
    ALTER TABLE orch.event_outbox
      DROP CONSTRAINT event_outbox_event_type_schema_version_fkey;
    ALTER TABLE orch.event_outbox
      ADD CONSTRAINT event_outbox_event_type_schema_version_fkey
      FOREIGN KEY (event_type, schema_version)
      REFERENCES authoring.event_catalog (event_type, schema_version);
    RAISE NOTICE 'the outbox key now names authoring.event_catalog';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'orch.event_outbox'::regclass
       AND conname = 'event_outbox_organization_id_fkey'
       AND confrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE orch.event_outbox
      DROP CONSTRAINT event_outbox_organization_id_fkey;
    ALTER TABLE orch.event_outbox
      ADD CONSTRAINT event_outbox_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES platform.organizations (id);
    RAISE NOTICE 'the outbox key now names platform.organizations';
  END IF;
END $$;


-- ════════════════════════════════════════════════ 3 · the old name works ══
CREATE OR REPLACE VIEW public.event_outbox
  WITH (security_invoker = true) AS
  SELECT id, event_id, event_type, schema_version, organization_id,
         aggregate_type, aggregate_id, correlation_id, causation_id,
         producer, payload_ref, occurred_at, published_at
    FROM orch.event_outbox;

-- The table's grants, on its other name. Only postgres held any.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_outbox TO postgres;


DO $$
DECLARE
  through_view  bigint;
  through_table bigint;
BEGIN
  SELECT count(*) INTO through_view  FROM public.event_outbox;
  SELECT count(*) INTO through_table FROM orch.event_outbox;

  IF through_view <> through_table THEN
    RAISE EXCEPTION 'the view shows % rows and the table holds %.',
      through_view, through_table;
  END IF;

  RAISE NOTICE 'orch.event_outbox: % rows, reachable under both names.', through_table;
END $$;
