-- The activity feed is shared business data. It lives in core.
--
-- WHAT WAS WRONG
--
-- The old project has public.orbit_activities: 2,085 rows, the timeline shown
-- on every candidate's drawer. Its name says ORBIT. Its rows say otherwise
-- (ref/ORBIT_Onboarding.md §2.2, counted 2026-09-18):
--
--   AI_MATCH_COMPLETED             1,010   SYNTRA   services/pipeline.service.js:105
--   job_discovery.*                  762   ASTRA    services/astra/discovery/jobDiscovery.service.js
--   CONSENT_* / PROFILE_DRAFT_*      261   PRISM    services/pipeline.service.js:39-169
--   PROFILE_UPDATED                   13   SYNTRA   repositories/candidate.repository.js:483
--   LIFECYCLE_CHANGED / PLACEMENT_
--     CONFIRMED / NOTE                39   ORBIT    services/orbit/orbitExecute.service.js:39,144
--
-- Four modules write it; ORBIT wrote 2%. A table every module appends to is
-- shared business data, and the module-boundary check would refuse four
-- modules writing into orbit.*. So: core.activities.
--
-- It also never had an organisation column. Every other table in the drawer
-- is tenant-scoped; the feed was not.
--
-- WHAT THIS DOES
--
-- Creates core.activities with the old columns (candidate_id → person_id, to
-- match core.people), the old index, plus org_id derived from the person, and
-- RLS. person_id → core.people is NOT VALID until the copy: 43 of 2,085 old
-- rows name a person that no longer exists (ref/Data_Migration_Plan.md §3.5
-- step 10); the copy skips those, and V20260909.70 validates.
--
-- SAFE TO RE-RUN.

BEGIN;

CREATE TABLE IF NOT EXISTS core.activities (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES platform.organizations(id),
  person_id     uuid        NOT NULL,   -- was candidate_id
  activity_type text        NOT NULL,
  actor_type    text        NOT NULL DEFAULT 'USER',
  actor_id      uuid,                   -- platform.users(id) when actor_type = 'USER'; NULL for SYSTEM
  summary       text        NOT NULL,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);

CREATE INDEX IF NOT EXISTS activities_person_occurred_idx ON core.activities (person_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activities_type_idx            ON core.activities (activity_type);

COMMENT ON TABLE core.activities IS
  'What happened to a person, in order — matches found, consent sent, lifecycle '
  'moved, notes. Appended by every module; read by the candidate drawer. Was '
  'public.orbit_activities (V20260909.66).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_person_id_fkey' AND conrelid = 'core.activities'::regclass) THEN
    ALTER TABLE core.activities
      ADD CONSTRAINT activities_person_id_fkey FOREIGN KEY (person_id) REFERENCES core.people(id) NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE TRIGGER activities_org_default
  BEFORE INSERT ON core.activities
  FOR EACH ROW EXECUTE FUNCTION app.core_org_from_person();

ALTER TABLE core.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.activities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activities_tenant ON core.activities;
CREATE POLICY activities_tenant ON core.activities
  USING      (org_id IS NULL OR org_id::text = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id IS NULL OR org_id::text = NULLIF(current_setting('app.org_id', true), ''));

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${migrator_role}') THEN
    EXECUTE 'DROP POLICY IF EXISTS activities_migrator_all ON core.activities';
    EXECUTE format('CREATE POLICY activities_migrator_all ON core.activities TO %I USING (true) WITH CHECK (true)', '${migrator_role}');
  END IF;
  FOREACH r IN ARRAY ARRAY['${app_role}', '${migrator_role}'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON core.activities TO %I', r);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('core.activities') IS NULL THEN RAISE EXCEPTION 'core.activities was not created'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'core.activities'::regclass) THEN
    RAISE EXCEPTION 'core.activities has no policy';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_person_id_fkey') THEN
    RAISE EXCEPTION 'core.activities.person_id has no foreign key';
  END IF;
  RAISE NOTICE 'core.activities: created; person_id -> core.people (NOT VALID until the copy).';
END $$;

COMMIT;
