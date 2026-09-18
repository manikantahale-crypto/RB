-- ORBIT's tables, in a schema of their own.
--
-- WHAT WAS WRONG
--
-- ORBIT — where a consultant is in their lifecycle, where they are placed,
-- and what the placement earns — has five tables on the old project, all in
-- public, none on the new project (ref/ORBIT_Onboarding.md). Nothing outside
-- ORBIT reads them (the activity feed, which everyone wrote, went to core in
-- V20260909.66), so they are module-private: schema `orbit`.
--
-- WHAT THE DATA LOOKS LIKE, SO NOBODY IS SURPRISED
--
-- Measured 2026-09-18 (ORBIT log §2.2): of 52 lifecycle rows, 6 name a person
-- who still exists; of 18 placements, 0 do; placements have requirement_id,
-- vendor_id, client_party_id NULL on every row; interviews and submissions
-- are empty. The person and requirement foreign keys are therefore created
-- NOT VALID, the copy brings only rows that link (decision D5 in
-- ref/Migration_Plan.md §1), and V20260909.70 validates.
--
-- WHAT CHANGES FROM THE OLD SHAPE
--
--   organization_id  → org_id            every core table's name for it
--   candidate_id     → person_id         core.people's name for it
--   client_party_id, vendor_party_id     dropped: they pointed at public.parties,
--                                        which is not migrated (Data_Migration_Plan
--                                        §2.4) and both were NULL on every row.
--                                        vendor_id → core.vendors is the vendor.
--
-- Everything else — columns, checks, defaults, indexes — is the old project's
-- verbatim (ref/docbuild/old_db_constraints.json).
--
-- SAFE TO RE-RUN.

BEGIN;

CREATE SCHEMA IF NOT EXISTS orbit;

CREATE OR REPLACE FUNCTION orbit.org_from_placement()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT p.org_id INTO NEW.org_id FROM orbit.placements p WHERE p.id = NEW.placement_id;
  IF NEW.org_id IS NULL THEN
    RAISE EXCEPTION 'cannot derive an organisation from placement %', NEW.placement_id;
  END IF;
  RETURN NEW;
END $$;

-- ═══════════════════════════════════════════════════════════ the tables ══

CREATE TABLE IF NOT EXISTS orbit.lifecycle_states (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES platform.organizations(id),
  person_id       uuid        NOT NULL,   -- was candidate_id
  state           text        NOT NULL
                  CHECK (state IN ('AVAILABLE', 'BENCH', 'NOTICE', 'PLACED', 'HOLD', 'PRIORITIZE', 'OLD',
                                   'IGNORE', 'MATCH_REQUESTED', 'MATCHED', 'SUBMITTED', 'INTERVIEW',
                                   'OFFER', 'JOINING', 'ACTIVE_ASSIGNMENT', 'ASSIGNMENT_ENDED', 'INACTIVE')),
  previous_state  text,
  transitioned_at timestamptz NOT NULL DEFAULT now(),
  transitioned_by uuid,
  note            text,
  context         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);
CREATE INDEX IF NOT EXISTS orbit_lifecycle_states_person_idx ON orbit.lifecycle_states (person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orbit.placements (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES platform.organizations(id),
  person_id           uuid        NOT NULL,   -- was candidate_id
  requirement_id      uuid,
  vendor_id           uuid,
  client_name         text        NOT NULL,
  start_date          date        NOT NULL,
  end_date            date,
  confirmed_bill_rate numeric     NOT NULL CHECK (confirmed_bill_rate > 0),
  confirmed_pay_rate  numeric     NOT NULL CHECK (confirmed_pay_rate > 0),
  employment_model    text        NOT NULL DEFAULT 'C2C' CHECK (employment_model IN ('W2', 'C2C', '1099', 'FTE')),
  work_mode           text        CHECK (work_mode IN ('ONSITE', 'HYBRID', 'REMOTE')),
  location            text,
  status              text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED', 'CANCELLED')),
  notes               text,
  package_ctc         numeric,
  monthly_profit      numeric,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);
CREATE INDEX IF NOT EXISTS orbit_placements_person_idx ON orbit.placements (person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orbit_placements_vendor_idx ON orbit.placements (vendor_id);

CREATE TABLE IF NOT EXISTS orbit.revenue_arrangements (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid        NOT NULL REFERENCES platform.organizations(id),
  placement_id              uuid        NOT NULL REFERENCES orbit.placements(id),
  arrangement_type          text        NOT NULL CHECK (arrangement_type IN ('MARKUP', 'MARGIN', 'FLAT_FEE', 'SPREAD', 'CUSTOM')),
  value                     numeric     NOT NULL,
  calculated_hourly_amount  numeric,
  calculated_monthly_amount numeric,
  calculation_note          text,
  notes                     text,
  custom_formula            text,
  is_current                boolean     NOT NULL DEFAULT true,
  created_by                uuid,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orbit_revenue_arrangements_placement_idx ON orbit.revenue_arrangements (placement_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orbit.submissions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES platform.organizations(id),
  person_id         uuid        NOT NULL,
  requirement_id    uuid,
  requirement_title text,
  client_name       text,
  vendor_id         uuid,       -- was vendor_party_id (→ parties, not migrated); now → core.vendors
  submitted_by      uuid,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  status            text        NOT NULL DEFAULT 'SUBMITTED'
                    CHECK (status IN ('SUBMITTED', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'REJECTED', 'ON_HOLD', 'OFFER_EXTENDED', 'WITHDRAWN')),
  rate_submitted    numeric,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);
CREATE INDEX IF NOT EXISTS orbit_submissions_person_idx ON orbit.submissions (person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orbit.interviews (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL REFERENCES platform.organizations(id),
  person_id        uuid        NOT NULL,
  submission_id    uuid        REFERENCES orbit.submissions(id),
  interview_type   text        NOT NULL DEFAULT 'TECHNICAL'
                   CHECK (interview_type IN ('PHONE_SCREEN', 'TECHNICAL', 'HR', 'FINAL', 'PANEL', 'CLIENT', 'OTHER')),
  scheduled_at     timestamptz,
  duration_minutes integer,
  status           text        NOT NULL DEFAULT 'SCHEDULED'
                   CHECK (status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW')),
  interviewer_name text,
  feedback         text,
  outcome          text        CHECK (outcome IN ('PASSED', 'FAILED', 'ON_HOLD', 'PENDING')),
  notes            text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orbit_interviews_person_idx ON orbit.interviews (person_id, created_at DESC);

COMMENT ON TABLE orbit.lifecycle_states IS
  'Where a consultant is (bench, notice, placed …), one row per transition. '
  'ORBIT-private; the person lives in core.people (V20260909.67).';

-- ═══════════════════════════════ keys into core and platform, NOT VALID ══

DO $$
DECLARE k record;
BEGIN
  FOR k IN SELECT * FROM (VALUES
    ('orbit.lifecycle_states',     'lifecycle_states_person_id_fkey',       'person_id',       'core.people(id)'),
    ('orbit.lifecycle_states',     'lifecycle_states_transitioned_by_fkey', 'transitioned_by', 'platform.users(id)'),
    ('orbit.placements',           'placements_person_id_fkey',             'person_id',       'core.people(id)'),
    ('orbit.placements',           'placements_requirement_id_fkey',        'requirement_id',  'core.requirements(id)'),
    ('orbit.placements',           'placements_vendor_id_fkey',             'vendor_id',       'core.vendors(id)'),
    ('orbit.placements',           'placements_created_by_fkey',            'created_by',      'platform.users(id)'),
    ('orbit.revenue_arrangements', 'revenue_arrangements_created_by_fkey',  'created_by',      'platform.users(id)'),
    ('orbit.submissions',          'submissions_person_id_fkey',            'person_id',       'core.people(id)'),
    ('orbit.submissions',          'submissions_requirement_id_fkey',       'requirement_id',  'core.requirements(id)'),
    ('orbit.submissions',          'submissions_vendor_id_fkey',            'vendor_id',       'core.vendors(id)'),
    ('orbit.submissions',          'submissions_submitted_by_fkey',         'submitted_by',    'platform.users(id)'),
    ('orbit.interviews',           'interviews_person_id_fkey',             'person_id',       'core.people(id)'),
    ('orbit.interviews',           'interviews_created_by_fkey',            'created_by',      'platform.users(id)')
  ) AS t(tbl, name, col, target) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = k.name AND conrelid = k.tbl::regclass) THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s NOT VALID',
                     k.tbl, k.name, k.col, k.target);
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════ triggers, RLS, grants ══

CREATE OR REPLACE TRIGGER lifecycle_states_org_default
  BEFORE INSERT ON orbit.lifecycle_states     FOR EACH ROW EXECUTE FUNCTION app.core_org_from_person();
CREATE OR REPLACE TRIGGER placements_org_default
  BEFORE INSERT ON orbit.placements           FOR EACH ROW EXECUTE FUNCTION app.core_org_from_person();
CREATE OR REPLACE TRIGGER revenue_arrangements_org_default
  BEFORE INSERT ON orbit.revenue_arrangements FOR EACH ROW EXECUTE FUNCTION orbit.org_from_placement();
CREATE OR REPLACE TRIGGER submissions_org_default
  BEFORE INSERT ON orbit.submissions          FOR EACH ROW EXECUTE FUNCTION app.core_org_from_person();
CREATE OR REPLACE TRIGGER interviews_org_default
  BEFORE INSERT ON orbit.interviews           FOR EACH ROW EXECUTE FUNCTION app.core_org_from_person();

CREATE OR REPLACE TRIGGER orbit_placements_updated_at
  BEFORE UPDATE ON orbit.placements  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE OR REPLACE TRIGGER orbit_submissions_updated_at
  BEFORE UPDATE ON orbit.submissions FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE OR REPLACE TRIGGER orbit_interviews_updated_at
  BEFORE UPDATE ON orbit.interviews  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lifecycle_states', 'placements', 'revenue_arrangements', 'submissions', 'interviews'] LOOP
    EXECUTE format('ALTER TABLE orbit.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE orbit.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON orbit.%I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON orbit.%I '
      'USING (org_id IS NULL OR org_id::text = NULLIF(current_setting(''app.org_id'', true), '''')) '
      'WITH CHECK (org_id IS NULL OR org_id::text = NULLIF(current_setting(''app.org_id'', true), ''''))',
      t || '_tenant', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${migrator_role}') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON orbit.%I', t || '_migrator_all', t);
      EXECUTE format('CREATE POLICY %I ON orbit.%I TO %I USING (true) WITH CHECK (true)',
                     t || '_migrator_all', t, '${migrator_role}');
    END IF;
    FOREACH r IN ARRAY ARRAY['${app_role}', '${migrator_role}'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('GRANT USAGE ON SCHEMA orbit TO %I', r);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON orbit.%I TO %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════ the invariant ══

DO $$
DECLARE missing text; unprotected text; n_fk int;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
    FROM unnest(ARRAY['lifecycle_states', 'placements', 'revenue_arrangements', 'submissions', 'interviews']) t
   WHERE to_regclass('orbit.' || t) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'orbit tables not created: %', missing; END IF;

  SELECT string_agg(c.relname, ', ') INTO unprotected
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'orbit' AND c.relkind = 'r'
     AND (NOT c.relrowsecurity OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid));
  IF unprotected IS NOT NULL THEN RAISE EXCEPTION 'orbit tables without RLS or a policy: %', unprotected; END IF;

  SELECT count(*) INTO n_fk FROM pg_constraint WHERE contype = 'f' AND connamespace = 'orbit'::regnamespace;
  -- 13 NOT VALID + placement_id + submission_id + 5 org_id
  IF n_fk < 20 THEN RAISE EXCEPTION 'orbit has % foreign keys; expected 20', n_fk; END IF;

  RAISE NOTICE 'orbit: five tables, RLS on all, % foreign keys (13 NOT VALID until the copy).', n_fk;
END $$;

COMMIT;
