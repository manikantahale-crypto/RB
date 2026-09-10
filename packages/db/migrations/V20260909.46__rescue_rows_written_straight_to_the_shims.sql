--
-- Carry into `core` the rows somebody wrote straight to the legacy shims.
--
-- syntra.jobs, candidates, resumes and matches are shims now, fed one way by
-- the mirror in V20260909.27: core -> syntra. Anything written the other way,
-- directly into a shim, is stranded. It is in a table SYNTRA no longer reads.
--
-- Stranded when this was written: 25 requirements, 7 people, 4 resumes and
-- 81 matches, created on 2026-09-10 between 06:54 and 12:22. They are not test
-- fixtures -- 0 of the 25 carry the node-test scratch marker -- they are real
-- postings with titles like "Senior Java Developer". Somebody was using the
-- application and their work went somewhere nothing looks.
--
-- Nothing in THIS repository writes those tables outside a test fixture. The
-- writer is the same older checkout that has been recreating
-- syntra.recruiter_review_items and public.failed_workflows all day.
--
-- WHY A BACKFILL AND NOT A SECOND MIRROR
--
-- A syntra -> core trigger would rescue the next one automatically, and it can
-- be made loop-safe (ON CONFLICT DO NOTHING writes nothing on the way back, so
-- the reverse mirror does not re-fire). It is deliberately NOT done.
--
-- Two mirrors pointing at each other is the arrangement these migrations have
-- spent forty-five steps removing, and it would hide the fault rather than fix
-- it: the old checkout would keep writing to the wrong place indefinitely and
-- nobody would ever see it. The fault is that a stale deployment is running.
-- The fix for that is to stop it.
--
-- So this rescues what is there, and the warning at the bottom is what tells
-- you whether it happened again.
--
-- SAFE TO RE-RUN. Nothing already in core is touched.
--

-- ═════════════════════════════════════════════════════════════ people ══
--
-- `candidate_source` keeps its name in core; `source` is not a column here.
--
-- A person with no name is skipped, not invented. core.people requires
-- full_name and one stranded row does not have one -- a Staging record from
-- an external applicant that was never completed. Filling it with a
-- placeholder would put a fictional person in front of a recruiter; leaving it
-- behind and saying so is the honest half of a rescue.
INSERT INTO core.people (
  id, org_id, full_name, email, phone, current_title, availability,
  candidate_source, location, immigration_status, linkedin, github,
  created_by, created_at, updated_at, status)
SELECT c.id, c.org_id, c.full_name, c.email::citext, c.phone, c.current_title,
       c.availability, c.candidate_source, c.location, c.immigration_status,
       c.linkedin, c.github, c.created_by, c.created_at, c.updated_at, c.status
  FROM syntra.candidates c
 WHERE c.org_id IS NOT NULL
   AND c.full_name IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM core.people p WHERE p.id = c.id)
ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════ requirements ══
--
-- `jd_summary` there, `summary` here. `mandatory_skills` and `preferred_skills`
-- are NOT NULL with a default of '[]', and passing NULL would override the
-- default rather than fall back to it.
INSERT INTO core.requirements (
  id, org_id, title, company_name, vendor_id, summary, primary_role,
  required_skills, mandatory_skills, preferred_skills, skill_weights,
  score_threshold, min_experience, max_experience, visa_requirement,
  employment_type, location, remote_policy, status, uploaded_at,
  source_email, message_id, source_type, source_name, source_url,
  relay_thread_id, created_by, created_at, updated_at)
SELECT j.id, j.org_id, j.title, j.company_name, j.vendor_id, j.jd_summary,
       j.primary_role, j.required_skills,
       coalesce(j.mandatory_skills, '[]'::jsonb),
       coalesce(j.preferred_skills, '[]'::jsonb),
       j.skill_weights, j.score_threshold, j.min_experience, j.max_experience,
       j.visa_requirement, j.employment_type, j.location, j.remote_policy,
       j.status, coalesce(j.uploaded_at, j.created_at, now()), j.source_email,
       j.message_id, j.source_type, j.source_name, j.source_url,
       j.relay_thread_id, j.created_by, j.created_at, j.updated_at
  FROM syntra.jobs j
 WHERE j.org_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM core.requirements r WHERE r.id = j.id)
ON CONFLICT (id) DO NOTHING;


-- ══════════════════════════════════════════════════════════ resumes ══
--
-- `candidate_id` becomes `person_id`, and `current_role` becomes
-- `current_role_title` because `current_role` is a reserved word.
--
-- The file columns -- original_file_name, file_path, mime_type, raw_text --
-- are NOT carried, because core.resumes does not have them: a file is a row in
-- core.source_files, which is the separation that stopped 91% of requirements
-- pretending to have a document they never had.
--
-- version_number and is_current are omitted rather than passed, so their
-- defaults apply. Passing NULL into a NOT NULL column with a default does not
-- fall back to the default -- it fails.
INSERT INTO core.resumes (
  id, org_id, person_id, summary, profile_summary, skills, education,
  experience, primary_role, years_experience, current_company,
  current_role_title, min_rate, total_experience, status,
  uploaded_at, created_at, updated_at)
SELECT r.id, r.org_id, r.candidate_id, r.resume_summary, r.profile_summary,
       r.skills, r.education, r.experience, r.primary_role, r.years_experience,
       r.current_company, r.current_role, r.min_rate, r.total_experience,
       r.status, r.uploaded_at, r.created_at, r.updated_at
  FROM syntra.resumes r
 WHERE r.org_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM core.people p WHERE p.id = r.candidate_id)
   AND NOT EXISTS (SELECT 1 FROM core.resumes cr WHERE cr.id = r.id)
ON CONFLICT (id) DO NOTHING;


-- ══════════════════════════════════════════════════════════ matches ══
--
-- job_id -> requirement_id, candidate_id -> person_id, match_status -> status,
-- match_requested_at -> requested_at. All four referenced rows must already be
-- in core, or the composite tenant keys reject the row -- which is the point of
-- them, so the row is skipped rather than forced.
INSERT INTO core.matches (
  id, org_id, requirement_id, person_id, resume_id, status, final_decision,
  score, eligibility_score, skill_match_score, tier, confidence_score,
  reasoning, breakdown, evidence, strengths, gaps, green_flags, red_flags,
  model_name, prompt_version, requested_at, matched_at,
  created_at, updated_at, llm_score)
SELECT m.id, m.org_id, m.job_id, m.candidate_id, m.resume_id, m.match_status,
       m.final_decision, m.score, m.eligibility_score, m.skill_match_score,
       m.tier, m.confidence_score, m.reasoning, m.breakdown, m.evidence,
       m.strengths, m.gaps, m.green_flags, m.red_flags, m.model_name,
       m.prompt_version, m.match_requested_at, m.matched_at,
       m.created_at, m.updated_at, m.llm_score
  FROM syntra.matches m
 WHERE m.org_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM core.requirements r WHERE r.id = m.job_id)
   AND EXISTS (SELECT 1 FROM core.people p WHERE p.id = m.candidate_id)
   AND EXISTS (SELECT 1 FROM core.resumes cr WHERE cr.id = m.resume_id)
   AND NOT EXISTS (SELECT 1 FROM core.matches cm WHERE cm.id = m.id)
ON CONFLICT (id) DO NOTHING;


DO $$
DECLARE
  unnameable   int;
  people_left  int;
  reqs_left    int;
  resumes_left int;
  matches_left int;
BEGIN
  SELECT count(*) INTO unnameable FROM syntra.candidates c
   WHERE c.full_name IS NULL
     AND NOT EXISTS (SELECT 1 FROM core.people p WHERE p.id = c.id);

  SELECT count(*) INTO people_left FROM syntra.candidates c
   WHERE c.full_name IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM core.people p WHERE p.id = c.id);
  SELECT count(*) INTO reqs_left FROM syntra.jobs j
   WHERE NOT EXISTS (SELECT 1 FROM core.requirements r WHERE r.id = j.id);
  SELECT count(*) INTO resumes_left FROM syntra.resumes r
   WHERE NOT EXISTS (SELECT 1 FROM core.resumes cr WHERE cr.id = r.id);
  SELECT count(*) INTO matches_left FROM syntra.matches m
   WHERE NOT EXISTS (SELECT 1 FROM core.matches cm WHERE cm.id = m.id);

  RAISE NOTICE 'core now holds % people, % requirements, % resumes, % matches.',
    (SELECT count(*) FROM core.people),
    (SELECT count(*) FROM core.requirements),
    (SELECT count(*) FROM core.resumes),
    (SELECT count(*) FROM core.matches);

  IF unnameable > 0 THEN
    RAISE WARNING '% stranded candidate(s) have no full_name and were left where they are.', unnameable;
    RAISE WARNING '  core.people requires one. They are incomplete records, not lost work.';
  END IF;

  IF people_left + reqs_left + resumes_left + matches_left > 0 THEN
    RAISE WARNING 'STILL STRANDED: % people, % requirements, % resumes, % matches.',
      people_left, reqs_left, resumes_left, matches_left;
    RAISE WARNING '  Something is still writing syntra.* directly. Nothing in this repo does.';
    RAISE WARNING '  Find the deployment doing it before trusting these tables.';
  END IF;
END $$;
