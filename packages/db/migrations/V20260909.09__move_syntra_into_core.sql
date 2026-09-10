--
-- Step 4: move the business entities into `core`.
--
-- The design calls this a SET SCHEMA. It cannot be, because the target shape
-- differs from the source: syntra.jobs has 42 columns doing four jobs, and
-- core splits them across requirements, source_files, processing_jobs and
-- embeddings. So this is a projection, table by table, column by column.
--
-- IDS ARE PRESERVED. Every row keeps its primary key, so everything in the
-- database that references a job, candidate, resume or match by id still
-- points at the right thing.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHAT THIS DOES NOT DO
--
-- It does not touch the syntra tables. They remain exactly as they are and
-- remain what the application reads and writes. This is a copy into the target
-- shape so it can be verified against real data before any code moves.
--
-- THAT MEANS THERE ARE BRIEFLY TWO COPIES, AND THEY WILL DRIFT. Every write
-- the application makes from now on lands in syntra and not in core. This is
-- the same failure mode as the agent_runs dual write that has already lost 36
-- rows, and it is acceptable here only because it is temporary and one-way:
-- core is derived, syntra is the source, and nothing reads core yet.
--
-- Re-running this migration re-syncs: every insert is ON CONFLICT DO NOTHING
-- keyed on id, so rows added to syntra since the last run are picked up.
--
-- Step 6 ends it by moving the code onto core and retiring the syntra tables.
-- Until then, `scripts/core-drift.sh` reports the gap.
-- ══════════════════════════════════════════════════════════════════════════
--
-- THE 263. Matches whose job and candidate belong to different organisations
-- cannot satisfy core.matches' composite keys — that is the point of those
-- keys. They are left behind and counted at the end, not silently dropped.
--

-- ═══════════════════════════════════════════════════════════════ people ══
--
-- current_location is not carried: NULL in all 325 rows, while `location` is
-- populated in 131. Two columns for one idea, one never used.
INSERT INTO core.people (
  id, org_id, full_name, email, phone, linkedin, github, location,
  immigration_status, availability, current_title, candidate_source,
  status, created_by, created_at, updated_at)
SELECT c.id, c.org_id, c.full_name, nullif(c.email,'')::citext, c.phone, c.linkedin, c.github,
       c.location, c.immigration_status, c.availability, c.current_title, c.candidate_source,
       coalesce(c.status, 'active'),
       -- created_by is a FK to platform.users; 22 rows have none, and a few
       -- could name a user that no longer exists.
       (SELECT u.id FROM platform.users u WHERE u.id = c.created_by),
       c.created_at, c.updated_at
  FROM syntra.candidates c
 -- One row has neither a name nor an email: a person record identifying
 -- nobody, created 2026-09-04, with no resume and no match pointing at it.
 -- core.people.full_name is NOT NULL and that is the right rule, so this row
 -- is left behind rather than given an invented name. It orphans nothing.
 WHERE c.full_name IS NOT NULL
ON CONFLICT (id) DO NOTHING;


-- ═════════════════════════════════════════════════════════ requirements ══
--
-- `origin` is inferred from what the row carries, because the source tables
-- never recorded it directly. A requirement that arrived by email is ASTRA's
-- intake; one with a job-board source_type is an import; everything else was
-- typed in by a person.
INSERT INTO core.requirements (
  id, org_id, title, company_name, vendor_id, summary, primary_role,
  required_skills, mandatory_skills, preferred_skills, skill_weights,
  score_threshold, min_experience, max_experience, visa_requirement,
  employment_type, location, remote_policy, status, origin,
  created_by, created_at, updated_at)
SELECT j.id, j.org_id, j.title, j.company_name, j.vendor_id, j.jd_summary, j.primary_role,
       j.required_skills, j.mandatory_skills, j.preferred_skills, j.skill_weights,
       j.score_threshold, j.min_experience, j.max_experience, j.visa_requirement,
       j.employment_type, j.location, j.remote_policy,
       coalesce(j.status, 'open'),
       CASE
         WHEN j.source_type IS NOT NULL  THEN 'import'
         WHEN j.source_email IS NOT NULL THEN 'astra'
         ELSE 'manual'
       END,
       (SELECT u.id FROM platform.users u WHERE u.id = j.created_by),
       j.created_at, j.updated_at
  FROM syntra.jobs j
ON CONFLICT (id) DO NOTHING;


-- ══════════════════════════════════════════════════════════════ resumes ══
--
-- version_number and is_current already exist upstream, and every candidate
-- has exactly one resume today, so the versioning maps across untouched.
INSERT INTO core.resumes (
  id, org_id, person_id, version_number, is_current, summary, profile_summary,
  skills, education, experience, primary_role, years_experience,
  current_company, current_role_title, min_rate, created_at, updated_at)
SELECT r.id, r.org_id, r.candidate_id,
       coalesce(r.version_number, 1), coalesce(r.is_current, true),
       r.resume_summary, r.profile_summary, r.skills, r.education, r.experience,
       r.primary_role, r.years_experience, r.current_company, r.current_role, r.min_rate,
       r.created_at, r.updated_at
  FROM syntra.resumes r
  -- A resume whose person did not make it across would fail the composite key.
 WHERE EXISTS (SELECT 1 FROM core.people p WHERE p.id = r.candidate_id AND p.org_id = r.org_id)
ON CONFLICT (id) DO NOTHING;


-- ══════════════════════════════════════════════════════════════ matches ══
--
-- Only rows whose requirement, person AND resume all belong to the same
-- organisation. The rest are the 263, reported below.
INSERT INTO core.matches (
  id, org_id, requirement_id, person_id, resume_id, status, final_decision,
  score, llm_score, eligibility_score, skill_match_score, tier, confidence_score,
  reasoning, breakdown, evidence, strengths, gaps, green_flags, red_flags,
  scored_by, model_name, prompt_version, requested_at, matched_at,
  created_at, updated_at)
SELECT m.id, m.org_id, m.job_id, m.candidate_id, m.resume_id,
       coalesce(m.match_status, 'scored'), m.final_decision,
       m.score, m.llm_score, m.eligibility_score, m.skill_match_score, m.tier,
       m.confidence_score, m.reasoning, m.breakdown, m.evidence, m.strengths,
       m.gaps, m.green_flags, m.red_flags,
       coalesce(m.score_source, 'syntra'), m.model_name, m.prompt_version,
       m.match_requested_at, m.matched_at, m.created_at, m.updated_at
  FROM syntra.matches m
 WHERE EXISTS (SELECT 1 FROM core.requirements q WHERE q.id = m.job_id       AND q.org_id = m.org_id)
   AND EXISTS (SELECT 1 FROM core.people       p WHERE p.id = m.candidate_id AND p.org_id = m.org_id)
   AND EXISTS (SELECT 1 FROM core.resumes      s WHERE s.id = m.resume_id    AND s.org_id = m.org_id)
ON CONFLICT (id) DO NOTHING;


-- ═════════════════════════════════════════════════════════ source files ══
--
-- File and ingestion metadata, off the wide tables. Only 256 of 2,946
-- requirements have a file_path — most arrive as email or text — so a row is
-- created only where there is something to record.
INSERT INTO core.source_files (
  org_id, subject_type, subject_id, original_file_name, file_path, mime_type,
  raw_text, content_hash, uploaded_at,
  source_email, message_id, source_type, source_name, source_url, relay_thread_id)
SELECT j.org_id, 'requirement', j.id, j.original_file_name, j.file_path, j.mime_type,
       j.raw_text, j.summary_hash, coalesce(j.uploaded_at, j.created_at),
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


-- ═══════════════════════════════════════════════════════════ embeddings ══
--
-- Out of the entity tables and into one place, versioned by model so a
-- re-embed adds a row instead of destroying the previous vector.
INSERT INTO core.embeddings (org_id, subject_type, subject_id, model, model_version, embedding, created_at)
SELECT j.org_id, 'requirement', j.id,
       coalesce(j.embedding_model, 'unknown'), coalesce(j.embedding_version, '1'),
       j.embedding, coalesce(j.processed_at, j.created_at)
  FROM syntra.jobs j
 WHERE j.embedding IS NOT NULL
ON CONFLICT (subject_type, subject_id, model, model_version) DO NOTHING;

INSERT INTO core.embeddings (org_id, subject_type, subject_id, model, model_version, embedding, created_at)
SELECT r.org_id, 'resume', r.id,
       coalesce(r.embedding_model, 'unknown'), coalesce(r.embedding_version, '1'),
       r.embedding, coalesce(r.processed_at, r.created_at)
  FROM syntra.resumes r
 WHERE r.embedding IS NOT NULL
ON CONFLICT (subject_type, subject_id, model, model_version) DO NOTHING;


-- ══════════════════════════════════════════════════════ processing jobs ══
--
-- The same six columns repeated on three tables become rows in one state
-- machine. `attempt` comes from retry_count where there is one, so a match
-- that was retried four times is one row recording attempt 5 rather than four
-- lost attempts — the history before this migration was overwritten in place
-- and cannot be recovered.
INSERT INTO core.processing_jobs (
  org_id, application, subject_type, subject_id, stage, status, attempt,
  started_at, finished_at, error, created_at)
SELECT j.org_id, 'syntra', 'requirement', j.id, 'extract',
       CASE
         WHEN j.processing_failed_at IS NOT NULL THEN 'failed'
         WHEN j.processed_at IS NOT NULL         THEN 'succeeded'
         WHEN j.processing_started_at IS NOT NULL THEN 'running'
         ELSE 'pending'
       END,
       1, j.processing_started_at, coalesce(j.processed_at, j.processing_failed_at),
       j.processing_error, j.created_at
  FROM syntra.jobs j
 WHERE j.processing_status IS NOT NULL OR j.processed_at IS NOT NULL
ON CONFLICT (subject_type, subject_id, stage, attempt) DO NOTHING;

INSERT INTO core.processing_jobs (
  org_id, application, subject_type, subject_id, stage, status, attempt,
  started_at, finished_at, error, created_at)
SELECT r.org_id, 'syntra', 'resume', r.id, 'extract',
       CASE
         WHEN r.processing_failed_at IS NOT NULL THEN 'failed'
         WHEN r.processed_at IS NOT NULL         THEN 'succeeded'
         WHEN r.processing_started_at IS NOT NULL THEN 'running'
         ELSE 'pending'
       END,
       1, r.processing_started_at, coalesce(r.processed_at, r.processing_failed_at),
       r.processing_error, r.created_at
  FROM syntra.resumes r
 WHERE r.processing_status IS NOT NULL OR r.processed_at IS NOT NULL
ON CONFLICT (subject_type, subject_id, stage, attempt) DO NOTHING;

INSERT INTO core.processing_jobs (
  org_id, application, subject_type, subject_id, stage, status, attempt,
  started_at, finished_at, error, created_at)
SELECT m.org_id, 'syntra', 'match', m.id, 'score',
       CASE
         WHEN m.matching_failed_at IS NOT NULL THEN 'failed'
         WHEN m.matched_at IS NOT NULL         THEN 'succeeded'
         WHEN m.matching_started_at IS NOT NULL THEN 'running'
         ELSE 'pending'
       END,
       coalesce(m.retry_count, 0) + 1,
       m.matching_started_at, coalesce(m.matched_at, m.matching_failed_at),
       m.matching_error, m.created_at
  FROM syntra.matches m
 WHERE EXISTS (SELECT 1 FROM core.matches cm WHERE cm.id = m.id)
ON CONFLICT (subject_type, subject_id, stage, attempt) DO NOTHING;


-- ══════════════════════════════════════════════════════════════ report ══
DO $$
DECLARE
  r record;
  left_behind int;
BEGIN
  FOR r IN
    SELECT 'people'      t, (SELECT count(*) FROM syntra.candidates) src, count(*) got FROM core.people
    UNION ALL SELECT 'requirements', (SELECT count(*) FROM syntra.jobs),      count(*) FROM core.requirements
    UNION ALL SELECT 'resumes',      (SELECT count(*) FROM syntra.resumes),   count(*) FROM core.resumes
    UNION ALL SELECT 'matches',      (SELECT count(*) FROM syntra.matches),   count(*) FROM core.matches
  LOOP
    IF r.got = r.src THEN
      RAISE NOTICE '% : % of %', rpad(r.t, 13), r.got, r.src;
    ELSE
      RAISE WARNING '% : % of % — % did not move', rpad(r.t, 13), r.got, r.src, r.src - r.got;
    END IF;
  END LOOP;

  RAISE NOTICE 'source_files: %, embeddings: %, processing_jobs: %',
    (SELECT count(*) FROM core.source_files),
    (SELECT count(*) FROM core.embeddings),
    (SELECT count(*) FROM core.processing_jobs);

  SELECT count(*) INTO left_behind
    FROM syntra.matches m
   WHERE NOT EXISTS (SELECT 1 FROM core.matches cm WHERE cm.id = m.id);

  IF left_behind > 0 THEN
    RAISE WARNING '% matches were left behind: their job and candidate belong to different', left_behind;
    RAISE WARNING '   organisations, which core.matches cannot represent. They remain in';
    RAISE WARNING '   syntra.matches. Decide whether to delete them or re-own the candidate.';
  END IF;
END $$;
