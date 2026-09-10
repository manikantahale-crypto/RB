--
-- Make `core` able to answer "is this ready to be matched?"
--
-- THE GAP
--
-- Matching only uses records that have finished processing — a resume that is
-- still being parsed has no skills to score. In `syntra` that is one column:
-- `processed_at`, empty while working, filled when done. Every matching query
-- gates on it.
--
-- The target design replaced that column with `core.processing_jobs`: a row
-- per attempt, with a stage, a status, timings and an error. That is a better
-- shape — it keeps the history instead of overwriting it, and gives an
-- operations screen something to read.
--
-- But it was filled once, from a snapshot, and nothing has written to it
-- since. So `core` currently cannot tell which records are ready. Moving the
-- matching queries onto `core` today would have them ask a table that stopped
-- being filled, and quietly match almost nothing.
--
-- WHAT THIS DOES
--
-- Extends the mirror: whenever a job or resume is written in `syntra`, its
-- processing state is written as a `core.processing_jobs` row. `core` then
-- answers the readiness question from data that is always current, and the
-- matching queries can move.
--
-- ONE ROW PER SUBJECT AND STAGE, UPDATED IN PLACE
--
-- The design allows many attempts per subject, keyed
-- (subject_type, subject_id, stage, attempt). The source only ever held the
-- LATEST state — it overwrote `processing_status` each time — so there is only
-- ever one attempt to mirror, and it is updated rather than appended. When the
-- application starts recording attempts properly it can write additional rows
-- itself; this does not stand in the way.
--
-- SAFE TO RE-RUN.
--

-- TRANSLATE THE SOURCE'S OWN VERDICT. DO NOT RE-DERIVE IT.
--
-- The first version of this worked the status out from the timestamps, and the
-- verification below caught it disagreeing with syntra: 109 resumes ready
-- there, 89 here. The reason is that the source data contradicts itself — 20
-- resumes carry BOTH processed_at and processing_failed_at, and
-- processing_status calls them failed.
--
-- So there are two competing definitions of "ready" inside syntra: the status
-- column (86 processed) and the timestamp the matching queries actually gate
-- on (109 with processed_at). Re-deriving picks one and silently changes
-- behaviour. Translating carries both across unchanged, and lets the
-- disagreement stay visible where it belongs — in the source.
CREATE OR REPLACE FUNCTION app.processing_status(source_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(coalesce(source_status, ''))
    WHEN 'processed'  THEN 'succeeded'
    WHEN 'failed'     THEN 'failed'
    WHEN 'processing' THEN 'running'
    ELSE 'pending'
  END
$$;


-- `finished_at` mirrors processed_at EXACTLY, and never the failure time. That
-- is what makes "ready to match" in core identical to `processed_at IS NOT
-- NULL` in syntra. A failed attempt has a status and an error but no finish.
CREATE OR REPLACE FUNCTION app.mirror_processing(
  p_org       uuid,
  p_subject   text,
  p_id        uuid,
  p_stage     text,
  p_status    text,
  p_started   timestamptz,
  p_finished  timestamptz,
  p_error     text,
  p_created   timestamptz
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO core.processing_jobs (
    org_id, application, subject_type, subject_id, stage, status, attempt,
    started_at, finished_at, error, created_at)
  VALUES (
    p_org, 'syntra', p_subject, p_id, p_stage,
    app.processing_status(p_status),
    1, p_started, p_finished, p_error, p_created)
  ON CONFLICT (subject_type, subject_id, stage, attempt) DO UPDATE SET
    status      = EXCLUDED.status,
    started_at  = EXCLUDED.started_at,
    finished_at = EXCLUDED.finished_at,
    error       = EXCLUDED.error;
END $$;


-- ═══════════════════════════════════════ hook it into the two mirrors ══
--
-- Rewritten in full rather than patched, because a trigger function that is
-- half one version and half another is the kind of thing nobody can read.

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
    NEW.years_experience, NEW.current_company, NEW."current_role", NEW.min_rate,
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

  PERFORM app.mirror_processing(
    NEW.org_id, 'resume', NEW.id, 'extract', NEW.processing_status,
    NEW.processing_started_at, NEW.processed_at,
    NEW.processing_error, NEW.created_at);

  RETURN NEW;
END $$;


-- ═══════════════════════════ catch up anything written before this ══
--
-- The mirror only fires on write. Rows written between V20260909.09 and now
-- have no processing row, and a readiness query would call them unprocessed.
INSERT INTO core.processing_jobs (
  org_id, application, subject_type, subject_id, stage, status, attempt,
  started_at, finished_at, error, created_at)
SELECT j.org_id, 'syntra', 'requirement', j.id, 'extract',
       app.processing_status(j.processing_status),
       1, j.processing_started_at, j.processed_at,
       j.processing_error, j.created_at
  FROM syntra.jobs j
ON CONFLICT (subject_type, subject_id, stage, attempt) DO UPDATE SET
  status = EXCLUDED.status, finished_at = EXCLUDED.finished_at, error = EXCLUDED.error;

INSERT INTO core.processing_jobs (
  org_id, application, subject_type, subject_id, stage, status, attempt,
  started_at, finished_at, error, created_at)
SELECT r.org_id, 'syntra', 'resume', r.id, 'extract',
       app.processing_status(r.processing_status),
       1, r.processing_started_at, r.processed_at,
       r.processing_error, r.created_at
  FROM syntra.resumes r
ON CONFLICT (subject_type, subject_id, stage, attempt) DO UPDATE SET
  status = EXCLUDED.status, finished_at = EXCLUDED.finished_at, error = EXCLUDED.error;


-- ══════════════════════════════════════════════════════════ verify ══
DO $$
DECLARE ready_syntra int; ready_core int;
BEGIN
  SELECT count(*) INTO ready_syntra FROM syntra.resumes WHERE processed_at IS NOT NULL;
  SELECT count(*) INTO ready_core
    FROM core.processing_jobs
   WHERE subject_type = 'resume' AND stage = 'extract' AND finished_at IS NOT NULL;

  IF ready_syntra <> ready_core THEN
    RAISE EXCEPTION 'readiness disagrees: % resumes ready in syntra, % in core', ready_syntra, ready_core;
  END IF;

  RAISE NOTICE 'core can now answer readiness: % resumes processed, and it agrees with syntra.', ready_core;
END $$;
