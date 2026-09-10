--
-- How a requirement arrived belongs to the requirement, not to its file.
--
-- V20260909.07 put six intake columns on core.source_files, reasoning that
-- "an email, a message id and a source url are ingestion metadata" and
-- source_files is the ingestion table. That reasoning was wrong in one
-- specific way: a source_files row only exists where there IS a file.
--
--   requirements with a file           256
--   requirements with a source_email   557
--   requirements with a message_id   2,638
--
-- So most of the provenance had nowhere to live. A requirement that arrived by
-- email has no file, and it is exactly the one whose source email matters.
--
-- This is the second instance of the same mistake — uploaded_at was the first,
-- fixed in V20260909.22. The pattern worth remembering: if a column is
-- populated on more rows than have a file, it is not file metadata.
--
-- The columns move onto core.requirements. They stay on core.source_files as
-- well, where a file exists, because the file's own provenance is a real thing
-- and dropping it would be a third version of this mistake in the opposite
-- direction.
--
-- SAFE TO RE-RUN.
--

ALTER TABLE core.requirements ADD COLUMN IF NOT EXISTS source_email    text;
ALTER TABLE core.requirements ADD COLUMN IF NOT EXISTS message_id      text;
ALTER TABLE core.requirements ADD COLUMN IF NOT EXISTS source_type     text;
ALTER TABLE core.requirements ADD COLUMN IF NOT EXISTS source_name     text;
ALTER TABLE core.requirements ADD COLUMN IF NOT EXISTS source_url      text;
ALTER TABLE core.requirements ADD COLUMN IF NOT EXISTS relay_thread_id text;

UPDATE core.requirements c
   SET source_email    = j.source_email,
       message_id      = j.message_id,
       source_type     = j.source_type,
       source_name     = j.source_name,
       source_url      = j.source_url,
       relay_thread_id = j.relay_thread_id
  FROM syntra.jobs j
 WHERE c.id = j.id
   AND (c.source_email    IS DISTINCT FROM j.source_email
     OR c.message_id      IS DISTINCT FROM j.message_id
     OR c.source_type     IS DISTINCT FROM j.source_type
     OR c.source_name     IS DISTINCT FROM j.source_name
     OR c.source_url      IS DISTINCT FROM j.source_url
     OR c.relay_thread_id IS DISTINCT FROM j.relay_thread_id);


CREATE OR REPLACE FUNCTION app.mirror_job()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO core.requirements (
    id, org_id, title, company_name, vendor_id, summary, primary_role,
    required_skills, mandatory_skills, preferred_skills, skill_weights,
    score_threshold, min_experience, max_experience, visa_requirement,
    employment_type, location, remote_policy, status, origin, uploaded_at,
    source_email, message_id, source_type, source_name, source_url,
    relay_thread_id, created_by, created_at, updated_at)
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
    NEW.uploaded_at, NEW.source_email, NEW.message_id, NEW.source_type,
    NEW.source_name, NEW.source_url, NEW.relay_thread_id,
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
    source_email = EXCLUDED.source_email, message_id = EXCLUDED.message_id,
    source_type = EXCLUDED.source_type, source_name = EXCLUDED.source_name,
    source_url = EXCLUDED.source_url,
    relay_thread_id = EXCLUDED.relay_thread_id,
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


DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
    FROM syntra.jobs j JOIN core.requirements c ON c.id = j.id
   WHERE j.source_email IS DISTINCT FROM c.source_email
      OR j.message_id   IS DISTINCT FROM c.message_id
      OR j.source_url   IS DISTINCT FROM c.source_url;
  IF bad > 0 THEN
    RAISE EXCEPTION '% requirements disagree on their provenance', bad;
  END IF;

  RAISE NOTICE 'intake provenance is on the requirement: % with a source email, % with a message id.',
    (SELECT count(source_email) FROM core.requirements),
    (SELECT count(message_id) FROM core.requirements);
END $$;
