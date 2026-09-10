--
-- The event catalogue becomes the source, and public.event_schemas the copy.
--
-- V20260909.25 mirrored event_schemas -> authoring.event_catalog so the reads
-- could move first. Every write now goes to the catalogue — the worker's ORBIT
-- bootstrap, the chain builder, the catalogue route, SYNTRA's outbox seed and
-- R__seed_event_schemas — so the mirror turns around, exactly as V20260909.27
-- did for the SYNTRA tables.
--
-- WHY THE OLD TABLE STAYS FED RATHER THAN DROPPED
--
-- public.event_outbox has a composite foreign key onto
-- public.event_schemas (event_type, schema_version). That FK is the rule that
-- an unregistered event cannot be published at all, and it is worth keeping —
-- but it points at the old table, so an event registered only in the catalogue
-- could not be published. The mirror closes that gap in the same transaction.
--
-- The FK moves to the catalogue when event_outbox itself moves to
-- orch.event_outbox. Not before: repointing an FK on the hottest table in the
-- database is its own change, and this one has to be safe on its own.
--
-- SAFE TO RE-RUN.
--

-- ══════════════════════════════════════════ 1 · the old check allows a draft ══
--
-- The catalogue has three statuses; the old table's check has two, because
-- there was nowhere to describe an event somebody was still writing. The
-- catalogue route creates exactly that, so a draft has to be representable in
-- the copy or the mirror fails on it.
--
-- Adding a value to a check does not change what existing readers see: they
-- filter on status = 'ACTIVE', and a draft is not that. Which is the point —
-- a half-written event should not look live.
ALTER TABLE public.event_schemas DROP CONSTRAINT IF EXISTS event_schemas_status_check;
ALTER TABLE public.event_schemas
  ADD CONSTRAINT event_schemas_status_check
  CHECK (status IN ('ACTIVE', 'DEPRECATED', 'DRAFT'));


-- ══════════════════════════════════════════════ 2 · stop the forward mirror ══
--
-- Two triggers pointing at each other is a loop. This one comes off before the
-- other goes on.
DROP TRIGGER IF EXISTS event_schemas_mirror_authoring ON public.event_schemas;


-- ═════════════════════════════════════════ 3 · catch the copy up, one time ══
--
-- The forward mirror only ever ran on writes to the old table, so anything
-- written straight into the catalogue since V20260909.25 is missing here.
-- Expected to be nothing; it costs one statement to be sure.
INSERT INTO public.event_schemas (
  event_type, schema_version, description, payload_schema, envelope_fields,
  produced_when, primary_consumer, status, created_at, updated_at)
SELECT c.event_type, c.schema_version, c.description, c.payload_schema,
       c.envelope_fields, c.produced_when, c.primary_consumer,
       upper(c.status), c.created_at, c.updated_at
  FROM authoring.event_catalog c
ON CONFLICT (event_type, schema_version) DO NOTHING;


-- ══════════════════════════════════════════════ 4 · mirror the other way ══
--
-- `application`, `visibility` and `handling` have no home in the old table and
-- are not carried. They are the three columns the catalogue was created for,
-- and nothing reading the old table has ever known about them.
CREATE OR REPLACE FUNCTION app.legacy_event_schema()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.event_schemas (
    event_type, schema_version, description, payload_schema, envelope_fields,
    produced_when, primary_consumer, status, created_at, updated_at)
  VALUES (
    NEW.event_type, NEW.schema_version, NEW.description, NEW.payload_schema,
    coalesce(NEW.envelope_fields, '{}'::jsonb),
    NEW.produced_when, NEW.primary_consumer,
    upper(NEW.status), NEW.created_at, NEW.updated_at)
  ON CONFLICT (event_type, schema_version) DO UPDATE SET
    description      = EXCLUDED.description,
    payload_schema   = EXCLUDED.payload_schema,
    envelope_fields  = EXCLUDED.envelope_fields,
    produced_when    = EXCLUDED.produced_when,
    primary_consumer = EXCLUDED.primary_consumer,
    status           = EXCLUDED.status,
    updated_at       = EXCLUDED.updated_at;

  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER event_catalog_legacy_mirror
  AFTER INSERT OR UPDATE ON authoring.event_catalog
  FOR EACH ROW EXECUTE FUNCTION app.legacy_event_schema();


DO $$
DECLARE
  catalogued int;
  copied     int;
  missing    int;
BEGIN
  SELECT count(*) INTO catalogued FROM authoring.event_catalog;
  SELECT count(*) INTO copied     FROM public.event_schemas;

  SELECT count(*) INTO missing
    FROM authoring.event_catalog c
   WHERE NOT EXISTS (
     SELECT 1 FROM public.event_schemas e
      WHERE e.event_type = c.event_type
        AND e.schema_version = c.schema_version);

  RAISE NOTICE 'catalogue: % events. legacy copy: %.', catalogued, copied;

  IF missing > 0 THEN
    RAISE EXCEPTION '% catalogued events have no legacy row — the outbox FK would reject them.', missing;
  END IF;
END $$;
