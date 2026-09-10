--
-- Turn the mirror around: `core` becomes the source, `syntra` becomes the copy.
--
-- Until now SYNTRA wrote to syntra.* and a mirror carried it into core, so core
-- was correct but derived. That was right while the reads were moving. It is
-- backwards now: SYNTRA, the orchestrator and the authoring platform are meant
-- to USE the new structure, not shadow it.
--
-- After this, writes go to core and the legacy tables follow.
--
-- WHY THE LEGACY TABLES CANNOT SIMPLY BE DROPPED YET
--
-- Nine foreign keys from three other applications point at them:
--
--   relay.email_threads, email_classifications, followups  -> candidates
--   interview_agent.roster, bank_questions                 -> candidates, jobs, matches
--   prism_submissions                                      -> candidates, jobs, resumes
--
-- Their code is not in this repository. Dropping the tables would break their
-- referential integrity, and turning the tables into views is impossible while
-- a foreign key points at them — a key cannot reference a view.
--
-- So the legacy tables stay, fed from core, until those applications move. When
-- they do, this whole file is deleted and the tables go with it.
--
-- WHAT THE REVERSE MIRROR DOES AND DOES NOT CARRY
--
-- It carries identity and the fields another application reads: who the person
-- is, which requirement, which match. It does NOT carry processing state,
-- embeddings or file metadata, because those live in core.processing_jobs,
-- core.embeddings and core.source_files, nothing outside SYNTRA reads them from
-- the legacy tables, and copying them back would mean maintaining the old wide
-- shape forever — which is the thing being retired.
--
-- Those columns therefore go STALE in syntra.* by design. Anything still
-- reading them from there is reading the old world and should move.
--
-- A NOTE ON DEFAULTS
--
-- Several legacy columns are NOT NULL *with a default* — uploaded_at,
-- version_number, is_current, match_status. Passing NULL to them explicitly
-- overrides the default and fails, which is not obvious: the old table would
-- have filled them itself. Every one is coalesced below.
--
-- SAFE TO RE-RUN.
--

-- ══════════════════════════════════════ stop the old direction first ══
--
-- Both directions at once would be an infinite loop. Dropping and creating in
-- one transaction means there is no moment where neither is running.
DROP TRIGGER IF EXISTS candidates_mirror_core ON syntra.candidates;
DROP TRIGGER IF EXISTS jobs_mirror_core       ON syntra.jobs;
DROP TRIGGER IF EXISTS resumes_mirror_core    ON syntra.resumes;
DROP TRIGGER IF EXISTS matches_mirror_core    ON syntra.matches;


-- A resume created in core need not have a file — the path lives in
-- core.source_files and only when there is one. The legacy column was NOT NULL
-- because the old shape assumed every resume was an upload.
ALTER TABLE syntra.resumes ALTER COLUMN file_path DROP NOT NULL;


-- ═══════════════════════════════════════════ core.people -> candidates ══
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
    -- created_by points at syntra.users, which not every platform user has a
    -- row in. A legacy row with no creator is better than no legacy row.
    (SELECT u.id FROM syntra.users u WHERE u.id = NEW.created_by),
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


-- ═══════════════════════════════════════ core.requirements -> jobs ══
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
    -- NOT NULL with a default of '[]'. Passing NULL overrides the default.
    coalesce(NEW.mandatory_skills, '[]'::jsonb),
    coalesce(NEW.preferred_skills, '[]'::jsonb),
    NEW.skill_weights, NEW.score_threshold,
    NEW.min_experience, NEW.max_experience, NEW.visa_requirement,
    NEW.employment_type, NEW.location, NEW.remote_policy, NEW.status,
    coalesce(NEW.uploaded_at, NEW.created_at, now()), NEW.source_email, NEW.message_id, NEW.source_type,
    NEW.source_name, NEW.source_url, NEW.relay_thread_id,
    (SELECT u.id FROM syntra.users u WHERE u.id = NEW.created_by),
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


-- ══════════════════════════════════════════ core.resumes -> resumes ══
CREATE OR REPLACE FUNCTION app.legacy_resume()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO syntra.resumes (
    id, org_id, candidate_id, version_number, is_current, resume_summary,
    profile_summary, skills, education, experience, primary_role,
    years_experience, total_experience, current_company, "current_role",
    min_rate, status, uploaded_at, file_path, created_at, updated_at)
  VALUES (
    NEW.id, NEW.org_id, NEW.person_id, coalesce(NEW.version_number, 1),
    coalesce(NEW.is_current, true),
    NEW.summary, NEW.profile_summary, NEW.skills, NEW.education, NEW.experience,
    NEW.primary_role, NEW.years_experience, NEW.total_experience,
    NEW.current_company, NEW.current_role_title, NEW.min_rate, NEW.status,
    coalesce(NEW.uploaded_at, NEW.created_at, now()),
    (SELECT f.file_path FROM core.source_files f
      WHERE f.subject_type = 'resume' AND f.subject_id = NEW.id LIMIT 1),
    NEW.created_at, NEW.updated_at)
  ON CONFLICT (id) DO UPDATE SET
    resume_summary = EXCLUDED.resume_summary,
    profile_summary = EXCLUDED.profile_summary,
    skills = EXCLUDED.skills, education = EXCLUDED.education,
    experience = EXCLUDED.experience, primary_role = EXCLUDED.primary_role,
    years_experience = EXCLUDED.years_experience,
    total_experience = EXCLUDED.total_experience,
    current_company = EXCLUDED.current_company,
    "current_role" = EXCLUDED."current_role", min_rate = EXCLUDED.min_rate,
    status = EXCLUDED.status, is_current = EXCLUDED.is_current,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END $$;


-- ══════════════════════════════════════════ core.matches -> matches ══
CREATE OR REPLACE FUNCTION app.legacy_match()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO syntra.matches (
    id, org_id, job_id, candidate_id, resume_id, match_status, final_decision,
    score, llm_score, eligibility_score, skill_match_score, tier,
    confidence_score, reasoning, breakdown, evidence, strengths, gaps,
    green_flags, red_flags, score_source, model_name, prompt_version,
    match_requested_at, matched_at, created_at, updated_at)
  VALUES (
    NEW.id, NEW.org_id, NEW.requirement_id, NEW.person_id, NEW.resume_id,
    coalesce(NEW.status, 'requested'), NEW.final_decision, NEW.score, NEW.llm_score,
    NEW.eligibility_score, NEW.skill_match_score, NEW.tier, NEW.confidence_score,
    NEW.reasoning, NEW.breakdown, NEW.evidence, NEW.strengths, NEW.gaps,
    NEW.green_flags, NEW.red_flags, NEW.scored_by, NEW.model_name,
    NEW.prompt_version, NEW.requested_at, NEW.matched_at,
    NEW.created_at, NEW.updated_at)
  ON CONFLICT (id) DO UPDATE SET
    match_status = EXCLUDED.match_status,
    final_decision = EXCLUDED.final_decision, score = EXCLUDED.score,
    llm_score = EXCLUDED.llm_score,
    eligibility_score = EXCLUDED.eligibility_score,
    skill_match_score = EXCLUDED.skill_match_score, tier = EXCLUDED.tier,
    confidence_score = EXCLUDED.confidence_score,
    reasoning = EXCLUDED.reasoning, breakdown = EXCLUDED.breakdown,
    evidence = EXCLUDED.evidence, strengths = EXCLUDED.strengths,
    gaps = EXCLUDED.gaps, green_flags = EXCLUDED.green_flags,
    red_flags = EXCLUDED.red_flags, score_source = EXCLUDED.score_source,
    matched_at = EXCLUDED.matched_at, updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END $$;


CREATE OR REPLACE TRIGGER people_to_legacy
  AFTER INSERT OR UPDATE ON core.people
  FOR EACH ROW EXECUTE FUNCTION app.legacy_candidate();

CREATE OR REPLACE TRIGGER requirements_to_legacy
  AFTER INSERT OR UPDATE ON core.requirements
  FOR EACH ROW EXECUTE FUNCTION app.legacy_job();

CREATE OR REPLACE TRIGGER resumes_to_legacy
  AFTER INSERT OR UPDATE ON core.resumes
  FOR EACH ROW EXECUTE FUNCTION app.legacy_resume();

CREATE OR REPLACE TRIGGER matches_to_legacy
  AFTER INSERT OR UPDATE ON core.matches
  FOR EACH ROW EXECUTE FUNCTION app.legacy_match();


DO $$
DECLARE forward int;
BEGIN
  SELECT count(*) INTO forward
    FROM pg_trigger
   WHERE tgname IN ('candidates_mirror_core','jobs_mirror_core',
                    'resumes_mirror_core','matches_mirror_core')
     AND NOT tgisinternal;

  IF forward > 0 THEN
    RAISE EXCEPTION 'the old direction is still active — % triggers would loop', forward;
  END IF;

  RAISE NOTICE 'core is now the source. syntra.* follows it, for the three';
  RAISE NOTICE 'applications whose foreign keys still point there.';
END $$;
