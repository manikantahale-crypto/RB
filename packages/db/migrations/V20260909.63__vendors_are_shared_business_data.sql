-- Vendors are shared business data. They live in core.
--
-- WHAT WAS WRONG
--
-- The old project keeps vendors in public.vendors, created by PRISM's vendor
-- onboarding screen. Five other things key on that table by foreign key:
--
--   syntra.jobs.vendor_id                          (the requirement's vendor)
--   orbit_placements.vendor_id                     (who the consultant is placed through)
--   relay.email_threads / email_classifications /
--     followups .vendor_id                         (which vendor an email is from)
--   interview_agent.real_interview_requests.vendor_id
--
-- Measured 2026-09-18 with pg_constraint on the old project (ref/PRISM_Onboarding.md
-- §2.1). That is the definition of shared business data in ref/Module_Onboarding_Path:
-- `core` holds what more than one module reads. A table every module joins
-- cannot belong to one module's schema without every other module taking a
-- foreign key into it.
--
-- The new project has no vendors table at all, and core.requirements.vendor_id
-- exists with nothing to point at (ref/Data_Migration_Plan.md gap G6).
--
-- WHAT THIS DOES
--
-- Creates core.vendors with the old project's columns, checks and indexes
-- verbatim (ref/docbuild/old_db_constraints.json → public.vendors), plus what
-- every core table has: org_id, the tenant policy, the updated_at trigger.
--
-- Then gives core.requirements.vendor_id its foreign key — NOT VALID, because
-- 57 vendor rows have not been copied yet and the requirements that reference
-- them already exist. V20260909.70 validates it after the copy.
--
-- WHO MAY SEE A VENDOR
--
-- On the old project the policy was `vendors_shared … USING (true)`: every
-- organisation saw every vendor. That is kept for reads, on purpose — it is
-- the observed behaviour, and changing who can see a vendor is a product
-- decision, not a migration. Writes are scoped to the caller's organisation
-- like every other core table. If reads are to be scoped later, that is one
-- policy to replace, and this comment to delete.
--
-- ORGANISATION
--
-- Derived from created_by through platform.org_members, the way core.people
-- does it (app.core_org_from_creator, V20260909.28). 56 of the 57 old rows
-- resolve; the one that does not is reconciled in the copy (step 1 of
-- ref/Data_Migration_Plan.md §3.5) before vendors are copied.
--
-- SAFE TO RE-RUN.

BEGIN;

CREATE TABLE IF NOT EXISTS core.vendors (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid        NOT NULL REFERENCES platform.organizations(id),
  name                        text        NOT NULL,
  vendor_type                 text
                              CHECK (vendor_type IN ('DIRECT_CLIENT', 'PRIME_VENDOR', 'TIER_1', 'TIER_2', 'STAFFING_AGENCY')),
  status                      text        NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED', 'INACTIVE')),
  website                     text,
  email                       text,
  phone                       text,
  linkedin                    text,
  location                    text,
  timezone                    text,
  payment_terms               text,
  preferred_technologies      text,
  preferred_immigration_types text,
  created_by                  uuid        NOT NULL REFERENCES platform.users(id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);

CREATE INDEX IF NOT EXISTS vendors_created_by_idx ON core.vendors (created_by);
CREATE INDEX IF NOT EXISTS vendors_email_idx      ON core.vendors (email);
CREATE INDEX IF NOT EXISTS vendors_name_idx       ON core.vendors (name);
CREATE INDEX IF NOT EXISTS vendors_status_idx     ON core.vendors (status);

COMMENT ON TABLE core.vendors IS
  'Vendors and clients a consultant is placed through. Shared: SYNTRA, PRISM, '
  'ORBIT, RELAY and INTERVIEW all key on it. Owned by PRISM''s code (vendor '
  'onboarding), readable by every organisation — see V20260909.63.';

CREATE OR REPLACE TRIGGER vendors_org_default
  BEFORE INSERT ON core.vendors
  FOR EACH ROW EXECUTE FUNCTION app.core_org_from_creator();

CREATE OR REPLACE TRIGGER core_vendors_updated_at
  BEFORE UPDATE ON core.vendors
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ═══════════════════════════════════════════════════════ row security ══

ALTER TABLE core.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.vendors FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendors_read_shared ON core.vendors;
CREATE POLICY vendors_read_shared ON core.vendors
  FOR SELECT USING (true);

DROP POLICY IF EXISTS vendors_write_tenant ON core.vendors;
CREATE POLICY vendors_write_tenant ON core.vendors
  FOR ALL
  USING      (org_id IS NULL OR org_id::text = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id IS NULL OR org_id::text = NULLIF(current_setting('app.org_id', true), ''));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${migrator_role}') THEN
    EXECUTE 'DROP POLICY IF EXISTS vendors_migrator_all ON core.vendors';
    EXECUTE format('CREATE POLICY vendors_migrator_all ON core.vendors TO %I USING (true) WITH CHECK (true)',
                   '${migrator_role}');
  END IF;
END $$;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['${app_role}', '${migrator_role}'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON core.vendors TO %I', r);
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════ the foreign key that had no target ══

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'requirements_vendor_id_fkey'
       AND conrelid = 'core.requirements'::regclass
  ) THEN
    ALTER TABLE core.requirements
      ADD CONSTRAINT requirements_vendor_id_fkey
      FOREIGN KEY (vendor_id) REFERENCES core.vendors(id) NOT VALID;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════ the invariant ══

DO $$
DECLARE
  n_pol int;
BEGIN
  IF to_regclass('core.vendors') IS NULL THEN
    RAISE EXCEPTION 'core.vendors was not created';
  END IF;

  SELECT count(*) INTO n_pol FROM pg_policy WHERE polrelid = 'core.vendors'::regclass;
  IF n_pol < 2 THEN
    RAISE EXCEPTION 'core.vendors has % policies; expected the read and write policies at least', n_pol;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'requirements_vendor_id_fkey' AND conrelid = 'core.requirements'::regclass
  ) THEN
    RAISE EXCEPTION 'core.requirements.vendor_id still has no foreign key';
  END IF;

  RAISE NOTICE 'core.vendors: created, % policies, requirements.vendor_id -> core.vendors (NOT VALID until the copy).', n_pol;
END $$;

COMMIT;
