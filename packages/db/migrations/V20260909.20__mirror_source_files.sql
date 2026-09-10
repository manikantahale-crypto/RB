--
-- Hook the file mirror into the triggers, and catch up what it missed.
--
-- V20260909.19 defined app.mirror_source_file but nothing called it. Left
-- there it would have been the worst kind of half-finished work: a function
-- that looks like it keeps file metadata current while core.source_files
-- quietly stops at whatever V20260909.09 copied.
--
-- Everything uploaded since then has no file row, so a read of file_path or
-- original_file_name from core returns nothing for it. That matters as soon as
-- a repository reads those columns from core rather than from syntra.
--
-- SAFE TO RE-RUN.
--

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
    title = EXCLUDED.title,
    company_name = EXCLUDED.company_name,
    vendor_id = EXCLUDED.vendor_id,
    summary = EXCLUDED.summary,
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
    location = EXCLUDED.location,
    remote_policy = EXCLUDED.remote_policy,
    status = EXCLUDED.status,
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
    NEW.processing_error, NEW.created_at);

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
    summary = EXCLUDED.summary,
    profile_summary = EXCLUDED.profile_summary,
    skills = EXCLUDED.skills,
    education = EXCLUDED.education,
    experience = EXCLUDED.experience,
    primary_role = EXCLUDED.primary_role,
    years_experience = EXCLUDED.years_experience,
    total_experience = EXCLUDED.total_experience,
    status = EXCLUDED.status,
    current_company = EXCLUDED.current_company,
    current_role_title = EXCLUDED.current_role_title,
    min_rate = EXCLUDED.min_rate,
    is_current = EXCLUDED.is_current,
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
    NEW.processing_error, NEW.created_at);

  PERFORM app.mirror_source_file(
    NEW.org_id, 'resume', NEW.id, NEW.original_file_name, NEW.file_path,
    NEW.mime_type, NEW.raw_text, NEW.summary_hash, NEW.uploaded_at);

  RETURN NEW;
END $$;


-- Catch up everything written since V20260909.09 took its snapshot.
INSERT INTO core.source_files (
  org_id, subject_type, subject_id, original_file_name, file_path, mime_type,
  raw_text, content_hash, uploaded_at,
  source_email, message_id, source_type, source_name, source_url, relay_thread_id)
SELECT j.org_id, 'requirement', j.id, j.original_file_name, j.file_path,
       j.mime_type, j.raw_text, j.summary_hash, coalesce(j.uploaded_at, j.created_at),
       j.source_email, j.message_id, j.source_type, j.source_name, j.source_url,
       j.relay_thread_id
  FROM syntra.jobs j
 WHERE j.file_path IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM core.source_files f
                    WHERE f.subject_type = 'requirement' AND f.subject_id = j.id);

INSERT INTO core.source_files (
  org_id, subject_type, subject_id, original_file_name, file_path, mime_type,
  raw_text, content_hash, uploaded_at)
SELECT r.org_id, 'resume', r.id, r.original_file_name, r.file_path, r.mime_type,
       r.raw_text, r.summary_hash, coalesce(r.uploaded_at, r.created_at)
  FROM syntra.resumes r
 WHERE r.file_path IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM core.source_files f
                    WHERE f.subject_type = 'resume' AND f.subject_id = r.id);


DO $$
DECLARE missing int;
BEGIN
  SELECT count(*) INTO missing
    FROM syntra.resumes r
   WHERE r.file_path IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM core.source_files f
                      WHERE f.subject_type = 'resume' AND f.subject_id = r.id);
  IF missing > 0 THEN
    RAISE EXCEPTION '% resumes still have no file row in core', missing;
  END IF;

  RAISE NOTICE 'core.source_files: % rows, and it now follows every write.',
    (SELECT count(*) FROM core.source_files);
END $$;
