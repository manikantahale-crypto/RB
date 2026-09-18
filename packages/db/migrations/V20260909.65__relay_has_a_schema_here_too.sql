-- RELAY's four tables, on this project.
--
-- WHAT WAS WRONG
--
-- RELAY (the Smart Inbox) keeps email threads, messages, classifications and
-- follow-ups in schema `relay` on the old project: ~16,300 rows, written
-- today, and the busiest orchestrated path there is (4,037 runs of
-- relay.intake.workflow in 14 days — ref/RELAY_Onboarding.md §2.1). The new
-- project has no `relay` schema at all.
--
-- The old tables were declared by drizzle (apps/relay/src/db/schema.ts) and
-- then patched at every boot by apps/relay/src/db/ensure-schema.ts:10-22,
-- which ALTER TABLE … ADD COLUMN IF NOT EXISTS the draft and attachment
-- columns. Those columns are part of the definition here; nothing runs DDL at
-- boot against this project. They had no row-level security and no
-- organisation column.
--
-- WHAT THIS DOES
--
-- Creates the four tables with the old columns (types and varchar lengths
-- from schema.ts, verbatim), indexes and keys, plus org_id and RLS.
-- Foreign keys: candidate_id → core.people, vendor_id → core.vendors, both
-- NOT VALID until the copy (V20260909.70 validates). Keys between the four
-- tables are ordinary.
--
-- ORGANISATION — AND WHY org_id IS NULLABLE HERE
--
-- A thread's organisation is that of the candidate it concerns. 62 of 3,894
-- threads have no candidate (ref/Data_Migration_Plan.md §2.3): an email
-- nobody has matched to a person yet. There is nothing to derive from, and
-- inventing an organisation for it would be a lie. So org_id may be NULL on a
-- thread, and the tenant policy treats a NULL as visible to every
-- organisation — which is exactly what the old project did for every thread,
-- having no RLS. Messages, classifications and follow-ups take the thread's
-- organisation.
--
-- `ml_shadow_logs` is declared in schema.ts and exists on neither project. It
-- is not created here; if RELAY's port keeps it, it gets its own migration.
--
-- SAFE TO RE-RUN.

BEGIN;

CREATE SCHEMA IF NOT EXISTS relay;

CREATE OR REPLACE FUNCTION relay.org_from_candidate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS NOT NULL OR NEW.candidate_id IS NULL THEN RETURN NEW; END IF;
  SELECT p.org_id INTO NEW.org_id FROM core.people p WHERE p.id = NEW.candidate_id;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION relay.org_from_thread()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT t.org_id INTO NEW.org_id FROM relay.email_threads t WHERE t.thread_id = NEW.thread_id;
  RETURN NEW;
END $$;

-- ═══════════════════════════════════════════════════════════ the tables ══

CREATE TABLE IF NOT EXISTS relay.email_threads (
  thread_id           varchar(255) PRIMARY KEY,
  org_id              uuid         REFERENCES platform.organizations(id),
  subject             text,
  latest_sender       text,
  latest_sender_email varchar(255),
  latest_date         timestamptz,
  reply_intent        varchar(100),
  requires_followup   boolean      NOT NULL DEFAULT false,
  status              varchar(50),
  priority            varchar(50),
  candidate_id        uuid,
  vendor_id           uuid,
  correlation_id      varchar(255),
  workflow_context    jsonb        DEFAULT '{}'::jsonb,
  draft_body          text,
  draft_subject       text,
  draft_source        varchar(50),
  draft_message_id    varchar(255),
  draft_attachments   jsonb        NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS relay_threads_latest_date_idx ON relay.email_threads (latest_date DESC);
CREATE INDEX IF NOT EXISTS relay_threads_correlation_idx ON relay.email_threads (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS relay_threads_candidate_idx   ON relay.email_threads (candidate_id);

CREATE TABLE IF NOT EXISTS relay.email_messages (
  id                  varchar(255) PRIMARY KEY,
  org_id              uuid         REFERENCES platform.organizations(id),
  thread_id           varchar(255) NOT NULL REFERENCES relay.email_threads(thread_id),
  from_email          varchar(255),
  from_name           text,
  to_email            varchar(255),
  subject             text,
  raw_body            text,
  cleaned_body        text,
  direction           varchar(50),
  date                timestamptz,
  provider_message_id varchar(255),
  is_bounce           boolean      NOT NULL DEFAULT false,
  html_body           text,
  attachments         jsonb        NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS relay_msg_thread_date_idx           ON relay.email_messages (thread_id, date DESC);
CREATE INDEX IF NOT EXISTS relay_msg_thread_direction_date_idx ON relay.email_messages (thread_id, direction, date DESC);

CREATE TABLE IF NOT EXISTS relay.email_classifications (
  message_id            varchar(255) PRIMARY KEY REFERENCES relay.email_messages(id),
  org_id                uuid         REFERENCES platform.organizations(id),
  thread_id             varchar(255) NOT NULL REFERENCES relay.email_threads(thread_id),
  main_bucket           varchar(100),
  reply_intent          varchar(100),
  sender_type           varchar(50),
  priority              varchar(50),
  requires_followup     boolean      NOT NULL DEFAULT false,
  candidate_id          uuid,
  vendor_id             uuid,
  classification_reason text,
  confidence_source     varchar(50)
);

CREATE TABLE IF NOT EXISTS relay.followups (
  id              varchar(255) PRIMARY KEY,
  org_id          uuid         REFERENCES platform.organizations(id),
  thread_id       varchar(255) NOT NULL REFERENCES relay.email_threads(thread_id),
  message_id      varchar(255) REFERENCES relay.email_messages(id),
  candidate_id    uuid,
  vendor_id       uuid,
  main_category   varchar(100),
  reply_type      varchar(100),
  priority        varchar(50),
  status          varchar(50),
  due_date        timestamptz,
  suggested_reply text,
  followup_reason text
);
CREATE INDEX IF NOT EXISTS relay_followups_status_due_idx ON relay.followups (status, due_date) WHERE status = 'Open';

COMMENT ON TABLE relay.email_threads IS
  'One inbox conversation. org_id is NULL until the thread is matched to a '
  'person; a NULL is visible to every organisation, as every thread was on the '
  'old project (V20260909.65).';

-- ═══════════════════════════════ keys into core, NOT VALID until the copy ══

DO $$
DECLARE k record;
BEGIN
  FOR k IN SELECT * FROM (VALUES
    ('relay.email_threads',         'email_threads_candidate_id_fkey',         'candidate_id', 'core.people(id)'),
    ('relay.email_threads',         'email_threads_vendor_id_fkey',            'vendor_id',    'core.vendors(id)'),
    ('relay.email_classifications', 'email_classifications_candidate_id_fkey', 'candidate_id', 'core.people(id)'),
    ('relay.email_classifications', 'email_classifications_vendor_id_fkey',    'vendor_id',    'core.vendors(id)'),
    ('relay.followups',             'followups_candidate_id_fkey',             'candidate_id', 'core.people(id)'),
    ('relay.followups',             'followups_vendor_id_fkey',                'vendor_id',    'core.vendors(id)')
  ) AS t(tbl, name, col, target) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = k.name AND conrelid = k.tbl::regclass) THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s NOT VALID',
                     k.tbl, k.name, k.col, k.target);
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════ triggers, RLS, grants ══

CREATE OR REPLACE TRIGGER email_threads_org_default
  BEFORE INSERT ON relay.email_threads FOR EACH ROW EXECUTE FUNCTION relay.org_from_candidate();
CREATE OR REPLACE TRIGGER email_messages_org_default
  BEFORE INSERT ON relay.email_messages FOR EACH ROW EXECUTE FUNCTION relay.org_from_thread();
CREATE OR REPLACE TRIGGER email_classifications_org_default
  BEFORE INSERT ON relay.email_classifications FOR EACH ROW EXECUTE FUNCTION relay.org_from_thread();
CREATE OR REPLACE TRIGGER followups_org_default
  BEFORE INSERT ON relay.followups FOR EACH ROW EXECUTE FUNCTION relay.org_from_thread();

DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_threads', 'email_messages', 'email_classifications', 'followups'] LOOP
    EXECUTE format('ALTER TABLE relay.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE relay.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON relay.%I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON relay.%I '
      'USING (org_id IS NULL OR org_id::text = NULLIF(current_setting(''app.org_id'', true), '''')) '
      'WITH CHECK (org_id IS NULL OR org_id::text = NULLIF(current_setting(''app.org_id'', true), ''''))',
      t || '_tenant', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${migrator_role}') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON relay.%I', t || '_migrator_all', t);
      EXECUTE format('CREATE POLICY %I ON relay.%I TO %I USING (true) WITH CHECK (true)',
                     t || '_migrator_all', t, '${migrator_role}');
    END IF;
    FOREACH r IN ARRAY ARRAY['${app_role}', '${relay_role}', '${migrator_role}'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('GRANT USAGE ON SCHEMA relay TO %I', r);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON relay.%I TO %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════ the invariant ══

DO $$
DECLARE missing text; unprotected text; n_fk int;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
    FROM unnest(ARRAY['email_threads', 'email_messages', 'email_classifications', 'followups']) t
   WHERE to_regclass('relay.' || t) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'relay tables not created: %', missing; END IF;

  SELECT string_agg(c.relname, ', ') INTO unprotected
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'relay' AND c.relkind = 'r'
     AND (NOT c.relrowsecurity OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid));
  IF unprotected IS NOT NULL THEN RAISE EXCEPTION 'relay tables without RLS or a policy: %', unprotected; END IF;

  SELECT count(*) INTO n_fk FROM pg_constraint WHERE contype = 'f' AND connamespace = 'relay'::regnamespace;
  -- 6 NOT VALID into core + 5 between the four tables + 4 org_id
  IF n_fk < 15 THEN RAISE EXCEPTION 'relay has % foreign keys; expected 15', n_fk; END IF;

  RAISE NOTICE 'relay: four tables, RLS on all, % foreign keys (6 NOT VALID until the copy).', n_fk;
END $$;

COMMIT;
