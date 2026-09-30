-- Migration V20260909.76__relax_tenant_dependencies.sql
-- Phase 6: Relax NOT NULL org_id constraints and trigger functions to support zero-organization users.
-- Preserves existing historical org_id data and platform.organizations / platform.org_members tables.

-- 1. Make org_id columns nullable across core, prism, and syntra tables
ALTER TABLE core.people ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE core.requirements ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE core.resumes ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE core.matches ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE core.vendors ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE core.activities ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE core.embeddings ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE core.processing_jobs ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE core.source_files ALTER COLUMN org_id DROP NOT NULL;

ALTER TABLE prism.submissions ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE prism.consents ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE prism.rtr ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE prism.approvals ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE prism.audit ALTER COLUMN org_id DROP NOT NULL;

ALTER TABLE syntra.scoring_log ALTER COLUMN org_id DROP NOT NULL;

-- 2. Relax app.core_org_from_creator() trigger function
CREATE OR REPLACE FUNCTION app.core_org_from_creator()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE memberships int;
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO memberships
    FROM platform.org_members m WHERE m.user_id = NEW.created_by;

  IF memberships = 1 THEN
    SELECT m.org_id INTO NEW.org_id
      FROM platform.org_members m WHERE m.user_id = NEW.created_by;
  END IF;

  -- Allow NEW.org_id to remain NULL cleanly if user has zero org memberships
  RETURN NEW;
END $function$;

-- 3. Relax app.org_from_creator() trigger function
CREATE OR REPLACE FUNCTION app.org_from_creator()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE memberships int;
BEGIN
  IF NEW.org_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO memberships
    FROM platform.org_members m WHERE m.user_id = NEW.created_by;

  IF memberships = 1 THEN
    SELECT m.org_id INTO NEW.org_id
      FROM platform.org_members m WHERE m.user_id = NEW.created_by;
  END IF;

  -- Allow NEW.org_id to remain NULL cleanly if user has zero org memberships
  RETURN NEW;
END $function$;

-- 4. Relax app.core_org_from_person() trigger function
CREATE OR REPLACE FUNCTION app.core_org_from_person()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT p.org_id INTO NEW.org_id FROM core.people p WHERE p.id = NEW.person_id;
  RETURN NEW;
END $function$;

-- 5. Relax app.core_org_from_requirement() trigger function
CREATE OR REPLACE FUNCTION app.core_org_from_requirement()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT q.org_id INTO NEW.org_id FROM core.requirements q WHERE q.id = NEW.requirement_id;
  RETURN NEW;
END $function$;

-- 6. Relax prism.org_from_submission() trigger function
CREATE OR REPLACE FUNCTION prism.org_from_submission()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT s.org_id INTO NEW.org_id FROM prism.submissions s WHERE s.id = NEW.submission_id;
  RETURN NEW;
END $function$;

-- 7. Relax app.org_from_job() trigger function
CREATE OR REPLACE FUNCTION app.org_from_job()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT q.org_id INTO NEW.org_id FROM core.requirements q WHERE q.id = NEW.job_id;
  RETURN NEW;
END $function$;
