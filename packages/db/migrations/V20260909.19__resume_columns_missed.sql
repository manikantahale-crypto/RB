--
-- Two resume columns that were being lost.
--
-- V20260909.07 audited syntra.jobs and syntra.candidates for populated columns
-- with nowhere to go in `core`, and widened `core` to hold them. It never
-- audited syntra.resumes. Running the same check across all four entities
-- afterwards found two:
--
--   total_experience   156 of 302 rows populated. Not the same thing as
--                      years_experience, which core.resumes already has — one
--                      is the total across a career, the other is what the
--                      parser attributed to the current role. Both are used.
--
--   status             302 of 302 rows populated. core.resumes had no status
--                      column at all, so every resume's state was being
--                      dropped on the way across.
--
-- Neither was noticed because nothing had read core.resumes yet. They would
-- have been found the first time a screen showed a blank column, or not at
-- all.
--
-- The other entities are clean: every populated column on jobs, candidates and
-- matches either exists in core, moved to source_files, embeddings or
-- processing_jobs, or was verified empty before being dropped.
--
-- SAFE TO RE-RUN.
--

-- text, not numeric: the source holds free-form values like '5 years', while
-- years_experience beside it is an integer. Two different fields, which is
-- why both are needed.
ALTER TABLE core.resumes ADD COLUMN IF NOT EXISTS total_experience text;
ALTER TABLE core.resumes ADD COLUMN IF NOT EXISTS status           text;

UPDATE core.resumes c
   SET total_experience = r.total_experience,
       status           = r.status
  FROM syntra.resumes r
 WHERE c.id = r.id
   AND (c.total_experience IS DISTINCT FROM r.total_experience
     OR c.status           IS DISTINCT FROM r.status);


-- Carry them on every write from now on, not just this backfill.
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

  RETURN NEW;
END $$;


-- The file metadata mirror was never written: source_files was filled once by
-- V20260909.09 and nothing has added to it since. Anything uploaded after that
-- has no file row, so a read of file_path or original_file_name from core
-- returns nothing.
CREATE OR REPLACE FUNCTION app.mirror_source_file(
  p_org      uuid,
  p_subject  text,
  p_id       uuid,
  p_name     text,
  p_path     text,
  p_mime     text,
  p_raw      text,
  p_hash     text,
  p_uploaded timestamptz
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- file_path is NOT NULL on core.source_files, so a subject without one gets
  -- no row rather than a row full of nulls.
  IF p_path IS NULL THEN RETURN; END IF;

  INSERT INTO core.source_files (
    org_id, subject_type, subject_id, original_file_name, file_path, mime_type,
    raw_text, content_hash, uploaded_at)
  SELECT p_org, p_subject, p_id, p_name, p_path, p_mime, p_raw, p_hash,
         coalesce(p_uploaded, now())
   WHERE NOT EXISTS (
     SELECT 1 FROM core.source_files f
      WHERE f.subject_type = p_subject AND f.subject_id = p_id);
END $$;


DO $$
DECLARE missing int;
BEGIN
  SELECT count(*) INTO missing
    FROM syntra.resumes r
   WHERE r.status IS DISTINCT FROM (SELECT c.status FROM core.resumes c WHERE c.id = r.id);

  IF missing > 0 THEN
    RAISE EXCEPTION '% resumes still disagree on status', missing;
  END IF;

  RAISE NOTICE 'core.resumes now carries total_experience and status, and follows them on write.';
END $$;
