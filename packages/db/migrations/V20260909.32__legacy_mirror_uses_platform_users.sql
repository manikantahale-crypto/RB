--
-- The legacy mirror stops losing created_by.
--
-- V20260909.27 wrote the legacy rows with
--
--   (SELECT u.id FROM syntra.users u WHERE u.id = NEW.created_by)
--
-- because syntra.candidates.created_by pointed at syntra.users, and three of
-- the 52 platform users have no row there. The lookup returned NULL for them,
-- so anything those three created arrived in the legacy tables unattributed.
-- A legacy row with no creator was better than no legacy row, which is why it
-- was written that way.
--
-- V20260909.31 repointed those keys at platform.users, so the lookup is no
-- longer needed: the value can go straight through, and all 52 users are
-- valid. Only the two created_by expressions change.
--
-- SAFE TO RE-RUN.
--

CREATE OR REPLACE FUNCTION app.legacy_candidate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO syntra.candidates (
    id, org_id, full_name, email, phone, current_title, availability,
    candidate_source, location, immigration_status, linkedin, github,
    created_by, created_at, updated_at, status)
  VALUES (
    NEW.id, NEW.org_id, NEW.full_name, NEW.email::text, NEW.phone,
    NEW.current_title, NEW.availability, NEW.candidate_source, NEW.location,
    NEW.immigration_status, NEW.linkedin, NEW.github,
    NEW.created_by,
    NEW.created_at, NEW.updated_at, NEW.status)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name, email = EXCLUDED.email,
    phone = EXCLUDED.phone, current_title = EXCLUDED.current_title,
    availability = EXCLUDED.availability, location = EXCLUDED.location,
    immigration_status = EXCLUDED.immigration_status,
    linkedin = EXCLUDED.linkedin, github = EXCLUDED.github,
    status = EXCLUDED.status, updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION app.legacy_job()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO syntra.jobs (
    id, org_id, title, company_name, vendor_id, jd_summary, primary_role,
    required_skills, mandatory_skills, preferred_skills, skill_weights,
    score_threshold, min_experience, max_experience, visa_requirement,
    employment_type, location, remote_policy, status, uploaded_at,
    source_email, message_id, source_type, source_name, source_url,
    relay_thread_id, created_by, created_at, updated_at)
  VALUES (
    NEW.id, NEW.org_id, NEW.title, NEW.company_name, NEW.vendor_id, NEW.summary,
    NEW.primary_role, NEW.required_skills,
    coalesce(NEW.mandatory_skills, '[]'::jsonb),
    coalesce(NEW.preferred_skills, '[]'::jsonb),
    NEW.skill_weights, NEW.score_threshold,
    NEW.min_experience, NEW.max_experience, NEW.visa_requirement,
    NEW.employment_type, NEW.location, NEW.remote_policy, NEW.status,
    coalesce(NEW.uploaded_at, NEW.created_at, now()), NEW.source_email,
    NEW.message_id, NEW.source_type, NEW.source_name, NEW.source_url,
    NEW.relay_thread_id,
    NEW.created_by,
    NEW.created_at, NEW.updated_at)
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, company_name = EXCLUDED.company_name,
    jd_summary = EXCLUDED.jd_summary, primary_role = EXCLUDED.primary_role,
    required_skills = EXCLUDED.required_skills,
    mandatory_skills = EXCLUDED.mandatory_skills,
    preferred_skills = EXCLUDED.preferred_skills,
    skill_weights = EXCLUDED.skill_weights,
    score_threshold = EXCLUDED.score_threshold,
    min_experience = EXCLUDED.min_experience,
    max_experience = EXCLUDED.max_experience,
    visa_requirement = EXCLUDED.visa_requirement,
    employment_type = EXCLUDED.employment_type,
    location = EXCLUDED.location, remote_policy = EXCLUDED.remote_policy,
    status = EXCLUDED.status, updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END $$;


DO $$
BEGIN
  RAISE NOTICE 'the legacy mirror carries created_by straight through.';
END $$;
