--
-- `uploaded_at` belongs to the requirement, not to its file.
--
-- V20260909.09 treated uploaded_at as file metadata and put it only on
-- core.source_files. A source_files row exists only where there IS a file, and
-- 2,690 of 2,946 requirements have no file — they arrived as email or text.
-- So 91% of requirements lost the answer to "when did this arrive".
--
-- It went unnoticed because nothing read it from core. It surfaced when
-- job.repository's listJobs — which is ORDER BY uploaded_at DESC LIMIT 50 —
-- started returning a different page: every row without a file sorted to the
-- end, so the first page was made of the 256 that happened to have one.
--
-- That is worth noticing on its own: a column silently becoming NULL does not
-- announce itself, it just quietly changes which rows people see.
--
-- Resumes are unaffected — all 302 have a file — but the column is added there
-- too, so "when did this arrive" is answered the same way for both and does
-- not depend on whether a file row exists.
--
-- SAFE TO RE-RUN.
--

ALTER TABLE core.requirements ADD COLUMN IF NOT EXISTS uploaded_at timestamptz;
ALTER TABLE core.resumes      ADD COLUMN IF NOT EXISTS uploaded_at timestamptz;

UPDATE core.requirements c
   SET uploaded_at = j.uploaded_at
  FROM syntra.jobs j
 WHERE c.id = j.id AND c.uploaded_at IS DISTINCT FROM j.uploaded_at;

UPDATE core.resumes c
   SET uploaded_at = r.uploaded_at
  FROM syntra.resumes r
 WHERE c.id = r.id AND c.uploaded_at IS DISTINCT FROM r.uploaded_at;


-- Carry it on every write. Only the entity INSERT changes in each trigger, so
-- these are patched with ALTER-style replacements rather than restated whole.
CREATE OR REPLACE FUNCTION app.mirror_job()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO core.requirements (
    id, org_id, title, company_name, vendor_id, summary, primary_role,
    required_skills, mandatory_skills, preferred_skills, skill_weights,
    score_threshold, min_experience, max_experience, visa_requirement,
    employment_type, location, remote_policy, status, origin, uploaded_at,
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
    NEW.uploaded_at,
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
    status = EXCLUDED.status, uploaded_at = EXCLUDED.uploaded_at,
    updated_at = EXCLUDED.updated_at;

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
    uploaded_at, created_at, updated_at)
  VALUES (
    NEW.id, NEW.org_id, NEW.candidate_id, coalesce(NEW.version_number,1),
    coalesce(NEW.is_current,true), NEW.resume_summary, NEW.profile_summary,
    NEW.skills, NEW.education, NEW.experience, NEW.primary_role,
    NEW.years_experience, NEW.total_experience, NEW.status, NEW.current_company,
    NEW."current_role", NEW.min_rate, NEW.uploaded_at, NEW.created_at, NEW.updated_at)
  ON CONFLICT (id) DO UPDATE SET
    summary = EXCLUDED.summary, profile_summary = EXCLUDED.profile_summary,
    skills = EXCLUDED.skills, education = EXCLUDED.education,
    experience = EXCLUDED.experience, primary_role = EXCLUDED.primary_role,
    years_experience = EXCLUDED.years_experience,
    total_experience = EXCLUDED.total_experience, status = EXCLUDED.status,
    current_company = EXCLUDED.current_company,
    current_role_title = EXCLUDED.current_role_title,
    min_rate = EXCLUDED.min_rate, is_current = EXCLUDED.is_current,
    uploaded_at = EXCLUDED.uploaded_at, updated_at = EXCLUDED.updated_at;

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


DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
    FROM syntra.jobs j JOIN core.requirements c ON c.id = j.id
   WHERE j.uploaded_at IS DISTINCT FROM c.uploaded_at;
  IF bad > 0 THEN
    RAISE EXCEPTION '% requirements disagree on uploaded_at', bad;
  END IF;

  RAISE NOTICE 'uploaded_at now lives on the entity: % requirements, % resumes.',
    (SELECT count(uploaded_at) FROM core.requirements),
    (SELECT count(uploaded_at) FROM core.resumes);
END $$;
