--
-- Keep the failure time as well as the finish time.
--
-- V20260909.18 made `finished_at` mirror `processed_at` exactly, so that
-- "ready to match" in core means the same thing it means in syntra. That was
-- right, and it had a cost I did not think through: the failure time had
-- nowhere to go, so `processing_failed_at` — 86 rows on resumes, 86 on jobs —
-- could not be read back from core at all.
--
-- The design gives processing_jobs `started_at`, `finished_at` and `error`, on
-- the assumption that an attempt ends once, either way. This data disagrees:
-- 20 resumes carry BOTH a processed_at and a processing_failed_at, because the
-- source overwrote one row across several attempts. Collapsing them into one
-- timestamp loses which was which.
--
-- So `failed_at` is added beside `finished_at`. A row can now say "this
-- succeeded at T1 and a later attempt failed at T2", which is what the source
-- actually recorded.
--
-- SAFE TO RE-RUN.
--

ALTER TABLE core.processing_jobs ADD COLUMN IF NOT EXISTS failed_at timestamptz;


CREATE OR REPLACE FUNCTION app.mirror_processing(
  p_org       uuid,
  p_subject   text,
  p_id        uuid,
  p_stage     text,
  p_status    text,
  p_started   timestamptz,
  p_finished  timestamptz,
  p_error     text,
  p_created   timestamptz,
  p_failed    timestamptz DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO core.processing_jobs (
    org_id, application, subject_type, subject_id, stage, status, attempt,
    started_at, finished_at, failed_at, error, created_at)
  VALUES (
    p_org, 'syntra', p_subject, p_id, p_stage,
    app.processing_status(p_status),
    1, p_started, p_finished, p_failed, p_error, p_created)
  ON CONFLICT (subject_type, subject_id, stage, attempt) DO UPDATE SET
    status      = EXCLUDED.status,
    started_at  = EXCLUDED.started_at,
    finished_at = EXCLUDED.finished_at,
    failed_at   = EXCLUDED.failed_at,
    error       = EXCLUDED.error;
END $$;


-- The two triggers pass it through. Only the mirror_processing call changes in
-- each, so they are patched rather than restated in full.
CREATE OR REPLACE FUNCTION app.mirror_job()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO core.requirements (
    id, org_id, title, company_name, vendor_id, summary, primary_role,
    required_skills, mandatory_skills, preferred_skills, skill_weights,
    score_threshold, min_experience, max_experience, visa_requirement,
    employment_type, location, remote_policy, status, origin,
    created_by, created_at, updated_at)
  VALUES (
    NEW.id, NEW.org_id, NEW.title, NEW.company_name, NEW.vendor_id,
    NEW.jd_summary, NEW.primary_role, NEW.required_skills, NEW.mandatory_skills,
    NEW.preferred_skills, NEW.skill_weights, NEW.score_threshold,
    NEW.min_experience, NEW.max_experience, NEW.visa_requirement,
    NEW.employment_type, NEW.location, NEW.remote_policy,
    coalesce(NEW.status,'open'),
    CASE
      WHEN NEW.source_type IS NOT NULL  THEN 'import'
      WHEN NEW.source_email IS NOT NULL THEN 'astra'
      ELSE 'manual'
    END,
    (SELECT u.id FROM platform.users u WHERE u.id = NEW.created_by),
    NEW.created_at, NEW.updated_at)
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, company_name = EXCLUDED.company_name,
    vendor_id = EXCLUDED.vendor_id, summary = EXCLUDED.summary,
    primary_role = EXCLUDED.primary_role,
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

  IF NEW.embedding IS NOT NULL THEN
    INSERT INTO core.embeddings (org_id, subject_type, subject_id, model, model_version, embedding, created_at)
    VALUES (NEW.org_id, 'requirement', NEW.id,
            coalesce(NEW.embedding_model,'unknown'),
            coalesce(NEW.embedding_version,'1'),
            NEW.embedding, coalesce(NEW.processed_at, now()))
    ON CONFLICT (subject_type, subject_id, model, model_version)
    DO UPDATE SET embedding = EXCLUDED.embedding;
  END IF;

  PERFORM app.mirror_processing(
    NEW.org_id, 'requirement', NEW.id, 'extract', NEW.processing_status,
    NEW.processing_started_at, NEW.processed_at,
    NEW.processing_error, NEW.created_at, NEW.processing_failed_at);

  PERFORM app.mirror_source_file(
    NEW.org_id, 'requirement', NEW.id, NEW.original_file_name, NEW.file_path,
    NEW.mime_type, NEW.raw_text, NEW.summary_hash, NEW.uploaded_at);

  RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION app.mirror_resume()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM core.people p WHERE p.id = NEW.candidate_id AND p.org_id = NEW.org_id
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO core.resumes (
    id, org_id, person_id, version_number, is_current, summary, profile_summary,
    skills, education, experience, primary_role, years_experience,
    total_experience, status, current_company, current_role_title, min_rate,
    created_at, updated_at)
  VALUES (
    NEW.id, NEW.org_id, NEW.candidate_id, coalesce(NEW.version_number,1),
    coalesce(NEW.is_current,true), NEW.resume_summary, NEW.profile_summary,
    NEW.skills, NEW.education, NEW.experience, NEW.primary_role,
    NEW.years_experience, NEW.total_experience, NEW.status, NEW.current_company,
    NEW."current_role", NEW.min_rate, NEW.created_at, NEW.updated_at)
  ON CONFLICT (id) DO UPDATE SET
    summary = EXCLUDED.summary, profile_summary = EXCLUDED.profile_summary,
    skills = EXCLUDED.skills, education = EXCLUDED.education,
    experience = EXCLUDED.experience, primary_role = EXCLUDED.primary_role,
    years_experience = EXCLUDED.years_experience,
    total_experience = EXCLUDED.total_experience, status = EXCLUDED.status,
    current_company = EXCLUDED.current_company,
    current_role_title = EXCLUDED.current_role_title,
    min_rate = EXCLUDED.min_rate, is_current = EXCLUDED.is_current,
    updated_at = EXCLUDED.updated_at;

  IF NEW.embedding IS NOT NULL THEN
    INSERT INTO core.embeddings (org_id, subject_type, subject_id, model, model_version, embedding, created_at)
    VALUES (NEW.org_id, 'resume', NEW.id,
            coalesce(NEW.embedding_model,'unknown'),
            coalesce(NEW.embedding_version,'1'),
            NEW.embedding, coalesce(NEW.processed_at, now()))
    ON CONFLICT (subject_type, subject_id, model, model_version)
    DO UPDATE SET embedding = EXCLUDED.embedding;
  END IF;

  PERFORM app.mirror_processing(
    NEW.org_id, 'resume', NEW.id, 'extract', NEW.processing_status,
    NEW.processing_started_at, NEW.processed_at,
    NEW.processing_error, NEW.created_at, NEW.processing_failed_at);

  PERFORM app.mirror_source_file(
    NEW.org_id, 'resume', NEW.id, NEW.original_file_name, NEW.file_path,
    NEW.mime_type, NEW.raw_text, NEW.summary_hash, NEW.uploaded_at);

  RETURN NEW;
END $$;


-- Backfill what the earlier mirrors could not record.
UPDATE core.processing_jobs p
   SET failed_at = j.processing_failed_at
  FROM syntra.jobs j
 WHERE p.subject_type = 'requirement' AND p.subject_id = j.id
   AND p.failed_at IS DISTINCT FROM j.processing_failed_at;

UPDATE core.processing_jobs p
   SET failed_at = r.processing_failed_at
  FROM syntra.resumes r
 WHERE p.subject_type = 'resume' AND p.subject_id = r.id
   AND p.failed_at IS DISTINCT FROM r.processing_failed_at;


DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
    FROM syntra.resumes r
    LEFT JOIN core.processing_jobs p
      ON p.subject_type = 'resume' AND p.subject_id = r.id AND p.stage = 'extract'
   WHERE r.processing_failed_at IS DISTINCT FROM p.failed_at;

  IF bad > 0 THEN
    RAISE EXCEPTION '% resumes disagree on the failure time', bad;
  END IF;

  RAISE NOTICE 'core.processing_jobs records the failure time as well as the finish.';
END $$;
