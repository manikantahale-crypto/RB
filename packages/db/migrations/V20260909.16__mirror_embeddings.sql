--
-- Extend the mirror to embeddings, so vector search can move to `core`.
--
-- V20260909.15 mirrors the four business entities. It does not mirror the
-- three tables that absorbed the wide columns — source_files, embeddings and
-- processing_jobs — because they are not needed to read a candidate or a
-- requirement.
--
-- Embeddings are the exception, and finding out the hard way would be
-- expensive: matching's first-tier funnel is a vector search. If `core` reads
-- an embeddings table that stops being filled, the funnel silently returns
-- fewer and fewer candidates as new resumes arrive — no error, just quietly
-- worse matching.
--
-- `syntra.jobs.embedding` and `syntra.resumes.embedding` are single columns;
-- `core.embeddings` is one row per subject per model, so a re-embed adds a row
-- rather than destroying the previous vector. The mirror writes the current
-- model's row and updates it in place, which is as close to the old behaviour
-- as the new shape allows.
--
-- source_files and processing_jobs are deliberately still not mirrored. They
-- are written once at ingestion and nothing reads them from `core` yet; they
-- are backfilled by re-running V20260909.09 when a reader needs them.
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
    current_company, current_role_title, min_rate, created_at, updated_at)
  VALUES (
    NEW.id, NEW.org_id, NEW.candidate_id, coalesce(NEW.version_number,1),
    coalesce(NEW.is_current,true), NEW.resume_summary, NEW.profile_summary,
    NEW.skills, NEW.education, NEW.experience, NEW.primary_role,
    NEW.years_experience, NEW.current_company, NEW.current_role, NEW.min_rate,
    NEW.created_at, NEW.updated_at)
  ON CONFLICT (id) DO UPDATE SET
    summary = EXCLUDED.summary,
    profile_summary = EXCLUDED.profile_summary,
    skills = EXCLUDED.skills,
    education = EXCLUDED.education,
    experience = EXCLUDED.experience,
    primary_role = EXCLUDED.primary_role,
    years_experience = EXCLUDED.years_experience,
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

  RETURN NEW;
END $$;


DO $$
BEGIN
  RAISE NOTICE 'embeddings now mirror into core.embeddings as well.';
END $$;
