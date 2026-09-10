--
-- Keep `core` current while the code moves onto it.
--
-- THE PROBLEM THIS SOLVES
--
-- V20260909.09 copied the business entities into `core`. The application still
-- writes to `syntra`, so the copy has been going stale from the moment it was
-- taken. That is the same shape as the agent_runs dual write, which has
-- already lost 36 runs by failing open, and it is the reason moving reads onto
-- `core` would be unsafe today: a read would miss every row written since.
--
-- WHY NOT MOVE THE CODE INSTEAD
--
-- 45 write sites — 8 inserts and 37 updates — across 15 files, and they cannot
-- move one file at a time. `core.matches` has composite foreign keys to
-- requirements, people and resumes, so a match written to `core` whose job was
-- written to `syntra` fails the key. The writes have to move as one cluster,
-- and a change that large against a live database is exactly what should not
-- be done in one step.
--
-- So: four triggers make `core` follow `syntra` automatically, whichever file
-- does the writing. Then reads move onto `core` one file at a time, safely,
-- because `core` is never behind. When the last reader has moved, the writes
-- move and these triggers come off.
--
-- THIS IS A TEMPORARY SCAFFOLD. It has a job and an end. Leaving it in place
-- permanently would mean two copies forever, which is the thing being fixed.
--
-- DIRECTION IS ONE WAY. syntra -> core, never back. Two-way sync between
-- tables with different shapes is a way to lose data quietly.
--
-- SAFE TO RE-RUN.
--

-- ═════════════════════════════════════════════ candidates -> core.people ══
CREATE OR REPLACE FUNCTION app.mirror_candidate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A person with no name cannot satisfy core.people.full_name NOT NULL. One
  -- such row exists and it is referenced by nothing; skipping keeps the rule
  -- rather than inventing a name.
  IF NEW.full_name IS NULL THEN RETURN NEW; END IF;

  INSERT INTO core.people (
    id, org_id, full_name, email, phone, linkedin, github, location,
    immigration_status, availability, current_title, candidate_source,
    status, created_by, created_at, updated_at)
  VALUES (
    NEW.id, NEW.org_id, NEW.full_name, nullif(NEW.email,'')::citext, NEW.phone,
    NEW.linkedin, NEW.github, NEW.location, NEW.immigration_status,
    NEW.availability, NEW.current_title, NEW.candidate_source,
    coalesce(NEW.status,'active'),
    (SELECT u.id FROM platform.users u WHERE u.id = NEW.created_by),
    NEW.created_at, NEW.updated_at)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    linkedin = EXCLUDED.linkedin,
    github = EXCLUDED.github,
    location = EXCLUDED.location,
    immigration_status = EXCLUDED.immigration_status,
    availability = EXCLUDED.availability,
    current_title = EXCLUDED.current_title,
    candidate_source = EXCLUDED.candidate_source,
    status = EXCLUDED.status,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END $$;


-- ═══════════════════════════════════════════ jobs -> core.requirements ══
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

  RETURN NEW;
END $$;


-- ═════════════════════════════════════════════ resumes -> core.resumes ══
CREATE OR REPLACE FUNCTION app.mirror_resume()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The person must be in core first. When a candidate and their resume are
  -- written in one statement the candidate's trigger has already fired, so
  -- this is only false for the nameless row skipped above.
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

  RETURN NEW;
END $$;


-- ═════════════════════════════════════════════ matches -> core.matches ══
CREATE OR REPLACE FUNCTION app.mirror_match()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- All three parents must exist in core AND agree on the organisation. A
  -- cross-tenant match cannot be represented in core — that is the whole point
  -- of the composite keys — so it is skipped rather than failing the write the
  -- application just made. 263 historical rows are in this state.
  IF NOT EXISTS (SELECT 1 FROM core.requirements q WHERE q.id = NEW.job_id       AND q.org_id = NEW.org_id)
  OR NOT EXISTS (SELECT 1 FROM core.people       p WHERE p.id = NEW.candidate_id AND p.org_id = NEW.org_id)
  OR NOT EXISTS (SELECT 1 FROM core.resumes      s WHERE s.id = NEW.resume_id    AND s.org_id = NEW.org_id)
  THEN
    RAISE WARNING 'core mirror skipped match % — its requirement, person and resume do not agree on an organisation', NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO core.matches (
    id, org_id, requirement_id, person_id, resume_id, status, final_decision,
    score, llm_score, eligibility_score, skill_match_score, tier,
    confidence_score, reasoning, breakdown, evidence, strengths, gaps,
    green_flags, red_flags, scored_by, model_name, prompt_version,
    requested_at, matched_at, created_at, updated_at)
  VALUES (
    NEW.id, NEW.org_id, NEW.job_id, NEW.candidate_id, NEW.resume_id,
    coalesce(NEW.match_status,'scored'), NEW.final_decision, NEW.score,
    NEW.llm_score, NEW.eligibility_score, NEW.skill_match_score, NEW.tier,
    NEW.confidence_score, NEW.reasoning, NEW.breakdown, NEW.evidence,
    NEW.strengths, NEW.gaps, NEW.green_flags, NEW.red_flags,
    coalesce(NEW.score_source,'syntra'), NEW.model_name, NEW.prompt_version,
    NEW.match_requested_at, NEW.matched_at, NEW.created_at, NEW.updated_at)
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    final_decision = EXCLUDED.final_decision,
    score = EXCLUDED.score,
    llm_score = EXCLUDED.llm_score,
    eligibility_score = EXCLUDED.eligibility_score,
    skill_match_score = EXCLUDED.skill_match_score,
    tier = EXCLUDED.tier,
    confidence_score = EXCLUDED.confidence_score,
    reasoning = EXCLUDED.reasoning,
    breakdown = EXCLUDED.breakdown,
    evidence = EXCLUDED.evidence,
    strengths = EXCLUDED.strengths,
    gaps = EXCLUDED.gaps,
    green_flags = EXCLUDED.green_flags,
    red_flags = EXCLUDED.red_flags,
    scored_by = EXCLUDED.scored_by,
    model_name = EXCLUDED.model_name,
    prompt_version = EXCLUDED.prompt_version,
    matched_at = EXCLUDED.matched_at,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END $$;


CREATE OR REPLACE TRIGGER candidates_mirror_core
  AFTER INSERT OR UPDATE ON syntra.candidates
  FOR EACH ROW EXECUTE FUNCTION app.mirror_candidate();

CREATE OR REPLACE TRIGGER jobs_mirror_core
  AFTER INSERT OR UPDATE ON syntra.jobs
  FOR EACH ROW EXECUTE FUNCTION app.mirror_job();

CREATE OR REPLACE TRIGGER resumes_mirror_core
  AFTER INSERT OR UPDATE ON syntra.resumes
  FOR EACH ROW EXECUTE FUNCTION app.mirror_resume();

CREATE OR REPLACE TRIGGER matches_mirror_core
  AFTER INSERT OR UPDATE ON syntra.matches
  FOR EACH ROW EXECUTE FUNCTION app.mirror_match();


DO $$
BEGIN
  RAISE NOTICE 'core now follows syntra on insert and update.';
  RAISE NOTICE 'Reads can move onto core one file at a time. Remove these triggers';
  RAISE NOTICE 'when the writes have moved — they are scaffolding, not architecture.';
END $$;
