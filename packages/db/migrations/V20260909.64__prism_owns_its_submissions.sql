-- PRISM's tables, in a schema of their own.
--
-- WHAT WAS WRONG
--
-- PRISM — vendor submissions, consent, right-to-represent, approvals and the
-- audit trail of all of it — has five tables on the old project, all in
-- public, all keyed into syntra.candidates / syntra.jobs / syntra.resumes /
-- syntra.users (pg_constraint, 2026-09-18; ref/PRISM_Onboarding.md §2.1).
-- The new project has none of them, and no PRISM code either.
--
-- Nothing outside PRISM reads these tables (the only foreign keys INTO them
-- are PRISM's own children), so they are module-private: schema `prism`.
-- Vendors are not here — they are shared, and went to core in V20260909.63.
--
-- WHAT THIS DOES
--
-- Creates prism.submissions, consents, rtr, approvals, audit with the old
-- columns, checks and indexes verbatim (ref/docbuild/old_db_constraints.json),
-- plus org_id, RLS and updated_at like every core table.
--
-- Foreign keys point where the data now lives: people, requirements, resumes
-- in core; users in platform. They are created NOT VALID because the rows
-- that will satisfy them are copied afterwards (ref/Data_Migration_Plan.md
-- §3.5 steps 1–8); V20260909.70 validates them. The children's keys to
-- prism.submissions are ordinary — the parent is created here, empty.
--
-- The old project also had prism.repository.js:6-45 rewriting the created_by
-- foreign keys at every boot (`ensurePrismSchema`). That is what those keys
-- are here for; the boot code does not run against this project.
--
-- ORGANISATION
--
-- A submission belongs to the organisation of the person it submits; consent,
-- RTR and approvals belong to their submission; an audit row to whoever
-- wrote it. Derived by trigger when the caller does not say.
--
-- SAFE TO RE-RUN.

BEGIN;

CREATE SCHEMA IF NOT EXISTS prism;

-- ═══════════════════════════════════════════════════════ org derivation ══

CREATE OR REPLACE FUNCTION prism.org_from_submission()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT s.org_id INTO NEW.org_id FROM prism.submissions s WHERE s.id = NEW.submission_id;
  IF NEW.org_id IS NULL THEN
    RAISE EXCEPTION 'cannot derive an organisation from submission %', NEW.submission_id;
  END IF;
  RETURN NEW;
END $$;

-- ═══════════════════════════════════════════════════════════ the tables ══

CREATE TABLE IF NOT EXISTS prism.submissions (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                       uuid        NOT NULL REFERENCES platform.organizations(id),
  person_id                    uuid        NOT NULL,   -- was candidate_id
  resume_id                    uuid        NOT NULL,
  requirement_id               uuid        NOT NULL,   -- was job_id
  match_id                     uuid,
  status                       text        NOT NULL DEFAULT 'DRAFT'
                               CHECK (status IN ('DRAFT', 'PENDING_CONSENT', 'CONSENT_REJECTED',
                                                 'CANDIDATE_VALIDATED', 'MASKED', 'VENDOR_SUBMITTED',
                                                 'VENDOR_ACCEPTED', 'VENDOR_VALIDATED',
                                                 'AVAILABILITY_CONFIRMED', 'RATE_CONFIRMED',
                                                 'PENDING_RTR', 'RTR_CONFIRMED', 'INTERVIEW_SCHEDULED',
                                                 'READY', 'SUBMITTED', 'REJECTED', 'WITHDRAWN')),
  created_by                   uuid        NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  candidate_validation_results jsonb       DEFAULT '{}'::jsonb,
  vendor_validation_results    jsonb       DEFAULT '{}'::jsonb,
  masked_profile               jsonb       DEFAULT '{}'::jsonb,
  interview_details            jsonb       DEFAULT '{}'::jsonb,
  rate                         numeric,
  rate_type                    text,
  availability                 text,
  recruiter_label              text,
  last_consent_sent_at         timestamptz,
  consent_resend_count         integer     NOT NULL DEFAULT 0 CHECK (consent_resend_count >= 0),
  confirmation_data            jsonb       DEFAULT '{}'::jsonb,
  UNIQUE (id, org_id)
);

CREATE INDEX IF NOT EXISTS prism_submissions_person_idx      ON prism.submissions (person_id);
CREATE INDEX IF NOT EXISTS prism_submissions_requirement_idx ON prism.submissions (requirement_id);
CREATE INDEX IF NOT EXISTS prism_submissions_created_by_idx  ON prism.submissions (created_by);
CREATE INDEX IF NOT EXISTS prism_submissions_status_idx      ON prism.submissions (status);
CREATE INDEX IF NOT EXISTS prism_submissions_status_by_idx   ON prism.submissions (status, created_by);
-- One live submission per person and requirement. Same partial index as the
-- old project (idx_prism_single_active_submission) — it was a plain index
-- there, not unique, so it is kept as it was: duplicates exist or may.
CREATE INDEX IF NOT EXISTS prism_submissions_active_idx
  ON prism.submissions (person_id, requirement_id)
  WHERE status NOT IN ('REJECTED', 'WITHDRAWN');

CREATE TABLE IF NOT EXISTS prism.consents (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES platform.organizations(id),
  submission_id uuid        NOT NULL REFERENCES prism.submissions(id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING', 'REQUESTED', 'APPROVED', 'REJECTED')),
  notes         text,
  created_by    uuid        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prism_consents_submission_idx ON prism.consents (submission_id);
CREATE INDEX IF NOT EXISTS prism_consents_created_by_idx ON prism.consents (created_by);

CREATE TABLE IF NOT EXISTS prism.rtr (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES platform.organizations(id),
  submission_id uuid        NOT NULL REFERENCES prism.submissions(id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING', 'SENT', 'SIGNED', 'DECLINED')),
  document_url  text,
  created_by    uuid        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prism_rtr_submission_idx ON prism.rtr (submission_id);
CREATE INDEX IF NOT EXISTS prism_rtr_created_by_idx ON prism.rtr (created_by);

CREATE TABLE IF NOT EXISTS prism.approvals (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES platform.organizations(id),
  submission_id uuid        NOT NULL REFERENCES prism.submissions(id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING', 'REQUESTED', 'APPROVED', 'REJECTED')),
  notes         text,
  created_by    uuid        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prism_approvals_submission_idx ON prism.approvals (submission_id);
CREATE INDEX IF NOT EXISTS prism_approvals_created_by_idx ON prism.approvals (created_by);

CREATE TABLE IF NOT EXISTS prism.audit (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES platform.organizations(id),
  entity_type     text        NOT NULL,
  entity_id       uuid        NOT NULL,   -- soft reference, as on the old project
  previous_status text,
  new_status      text        NOT NULL,
  created_by      uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prism_audit_created_at_idx  ON prism.audit (created_at DESC);
CREATE INDEX IF NOT EXISTS prism_audit_created_by_idx  ON prism.audit (created_by);
CREATE INDEX IF NOT EXISTS prism_audit_entity_id_idx   ON prism.audit (entity_id);
CREATE INDEX IF NOT EXISTS prism_audit_entity_type_idx ON prism.audit (entity_type);

COMMENT ON TABLE prism.submissions IS
  'A consultant put forward to a vendor for a requirement, and where that stands. '
  'PRISM-private; person, resume and requirement live in core (V20260909.64).';

-- ══════════════════════════════ keys into core and platform, NOT VALID ══
--
-- Validated by V20260909.70 once the copy has filled core.people,
-- core.requirements, core.resumes and platform.users.

DO $$
DECLARE k record;
BEGIN
  FOR k IN SELECT * FROM (VALUES
    ('prism.submissions', 'submissions_person_id_fkey',      'person_id',      'core.people(id)'),
    ('prism.submissions', 'submissions_resume_id_fkey',      'resume_id',      'core.resumes(id)'),
    ('prism.submissions', 'submissions_requirement_id_fkey', 'requirement_id', 'core.requirements(id)'),
    ('prism.submissions', 'submissions_match_id_fkey',       'match_id',       'core.matches(id)'),
    ('prism.submissions', 'submissions_created_by_fkey',     'created_by',     'platform.users(id)'),
    ('prism.consents',    'consents_created_by_fkey',        'created_by',     'platform.users(id)'),
    ('prism.rtr',         'rtr_created_by_fkey',             'created_by',     'platform.users(id)'),
    ('prism.approvals',   'approvals_created_by_fkey',       'created_by',     'platform.users(id)'),
    ('prism.audit',       'audit_created_by_fkey',           'created_by',     'platform.users(id)')
  ) AS t(tbl, name, col, target) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = k.name AND conrelid = k.tbl::regclass) THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s NOT VALID',
                     k.tbl, k.name, k.col, k.target);
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════ triggers, RLS, grants ══

CREATE OR REPLACE TRIGGER submissions_org_default
  BEFORE INSERT ON prism.submissions
  FOR EACH ROW EXECUTE FUNCTION app.core_org_from_person();

CREATE OR REPLACE TRIGGER consents_org_default
  BEFORE INSERT ON prism.consents  FOR EACH ROW EXECUTE FUNCTION prism.org_from_submission();
CREATE OR REPLACE TRIGGER rtr_org_default
  BEFORE INSERT ON prism.rtr       FOR EACH ROW EXECUTE FUNCTION prism.org_from_submission();
CREATE OR REPLACE TRIGGER approvals_org_default
  BEFORE INSERT ON prism.approvals FOR EACH ROW EXECUTE FUNCTION prism.org_from_submission();
CREATE OR REPLACE TRIGGER audit_org_default
  BEFORE INSERT ON prism.audit     FOR EACH ROW EXECUTE FUNCTION app.core_org_from_creator();

CREATE OR REPLACE TRIGGER prism_submissions_updated_at
  BEFORE UPDATE ON prism.submissions FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE OR REPLACE TRIGGER prism_consents_updated_at
  BEFORE UPDATE ON prism.consents    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE OR REPLACE TRIGGER prism_rtr_updated_at
  BEFORE UPDATE ON prism.rtr         FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE OR REPLACE TRIGGER prism_approvals_updated_at
  BEFORE UPDATE ON prism.approvals   FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['submissions', 'consents', 'rtr', 'approvals', 'audit'] LOOP
    EXECUTE format('ALTER TABLE prism.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE prism.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON prism.%I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON prism.%I '
      'USING (org_id IS NULL OR org_id::text = NULLIF(current_setting(''app.org_id'', true), '''')) '
      'WITH CHECK (org_id IS NULL OR org_id::text = NULLIF(current_setting(''app.org_id'', true), ''''))',
      t || '_tenant', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${migrator_role}') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON prism.%I', t || '_migrator_all', t);
      EXECUTE format('CREATE POLICY %I ON prism.%I TO %I USING (true) WITH CHECK (true)',
                     t || '_migrator_all', t, '${migrator_role}');
    END IF;
    FOREACH r IN ARRAY ARRAY['${app_role}', '${migrator_role}'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('GRANT USAGE ON SCHEMA prism TO %I', r);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON prism.%I TO %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════ the invariant ══

DO $$
DECLARE missing text; unprotected text; n_fk int;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
    FROM unnest(ARRAY['submissions', 'consents', 'rtr', 'approvals', 'audit']) t
   WHERE to_regclass('prism.' || t) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'prism tables not created: %', missing; END IF;

  SELECT string_agg(c.relname, ', ') INTO unprotected
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'prism' AND c.relkind = 'r'
     AND (NOT c.relrowsecurity OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid));
  IF unprotected IS NOT NULL THEN RAISE EXCEPTION 'prism tables without RLS or a policy: %', unprotected; END IF;

  SELECT count(*) INTO n_fk FROM pg_constraint
   WHERE contype = 'f' AND connamespace = 'prism'::regnamespace;
  -- 9 NOT VALID keys above + 3 submission_id keys + 5 org_id keys
  IF n_fk < 17 THEN RAISE EXCEPTION 'prism has % foreign keys; expected 17', n_fk; END IF;

  RAISE NOTICE 'prism: five tables, RLS on all, % foreign keys (9 NOT VALID until the copy).', n_fk;
END $$;

COMMIT;
