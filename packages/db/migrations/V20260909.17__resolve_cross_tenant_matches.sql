--
-- Make the 263 cross-tenant matches representable, without losing anything.
--
-- THE PROBLEM
--
-- 263 matches pair one organisation's job with another organisation's
-- candidate. A match carries one org_id and must agree with both sides, so
-- core.matches cannot hold them — that refusal IS the tenant boundary.
--
-- They were valid when written. On 2026-09-03 33 user accounts were moved
-- between the two organisations in one update, and the answer to "who owns
-- this person" changed underneath rows that had already been scored.
--
-- WHY NOT THE TWO OBVIOUS FIXES
--
-- Move the candidates to the job's organisation: 10 candidates are involved,
-- and they hold 1,325 matches between them. Moving them fixes 263 and BREAKS
-- 1,062 that are valid today. Four times the damage it repairs.
--
-- Delete the 263: loses real scoring work, 116 of it already completed, for
-- rows that were correct when they were made.
--
-- WHAT THIS DOES INSTEAD
--
-- Gives each of the 10 people a second row in the other organisation, and
-- points the 263 matches at it.
--
-- That is not a workaround — it is what the design already says. core.people
-- deduplicates per tenant, not globally: "two customers may each know the same
-- person, and that is two rows, because they hold them under different
-- consent." Two agencies both knowing SRAVAN KUMAR ERRA is normal in staffing.
-- The database was previously unable to express it, which is why one row was
-- being shared across a boundary.
--
-- Each person's current resume is copied too, because a match names a resume
-- and that resume must belong to the same organisation.
--
-- IDS ARE DERIVED, NOT RANDOM. The copy's id is md5(original + target org),
-- so re-running finds the same row instead of making another. Nothing is
-- created twice.
--
-- SAFE TO RE-RUN.
--

-- Who needs a second row, and where.
CREATE TEMP TABLE needs_copy AS
SELECT DISTINCT
       c.id                                                   AS original_id,
       j.org_id                                               AS target_org,
       md5(c.id::text || j.org_id::text)::uuid                AS copy_id
  FROM syntra.matches m
  JOIN syntra.jobs j       ON j.id = m.job_id
  JOIN syntra.candidates c ON c.id = m.candidate_id
 WHERE j.org_id <> c.org_id;


-- ═══════════════════════════════════════════════ the person, once each ══
INSERT INTO syntra.candidates (
  id, org_id, full_name, email, phone, current_title, current_location,
  availability, candidate_source, location, immigration_status, linkedin,
  github, created_by, created_at, updated_at, status)
SELECT n.copy_id, n.target_org, c.full_name, c.email, c.phone, c.current_title,
       c.current_location, c.availability, c.candidate_source, c.location,
       c.immigration_status, c.linkedin, c.github,
       -- Attributed to a member of the organisation this copy exists for.
       --
       -- The `created_by` foreign key points at syntra.users, and 3 of the 52
       -- platform users have no row there — the same two-user-table split that
       -- V20260909.14 started unwinding. So the member has to exist in BOTH,
       -- or the insert fails on a key that has nothing to do with this change.
       (SELECT m2.user_id FROM platform.org_members m2
         WHERE m2.org_id = n.target_org
           AND EXISTS (SELECT 1 FROM syntra.users u WHERE u.id = m2.user_id)
         ORDER BY m2.created_at LIMIT 1),
       c.created_at, now(), c.status
  FROM needs_copy n
  JOIN syntra.candidates c ON c.id = n.original_id
ON CONFLICT (id) DO NOTHING;


-- ══════════════════════════════════════════ and their current resume ══
INSERT INTO syntra.resumes (
  id, org_id, candidate_id, original_file_name, file_path, mime_type, raw_text,
  resume_summary, skills, primary_role, summary_hash, years_experience,
  min_rate, current_company, "current_role", education, experience,
  total_experience, version_number, is_current, processing_status, uploaded_at,
  processed_at, created_at, updated_at, profile_summary, embedding_model,
  embedding_version, embedding, status, storage_key)
SELECT md5(r.id::text || n.target_org::text)::uuid, n.target_org, n.copy_id,
       r.original_file_name, r.file_path, r.mime_type, r.raw_text,
       r.resume_summary, r.skills, r.primary_role, r.summary_hash,
       r.years_experience, r.min_rate, r.current_company, r."current_role",
       r.education, r.experience, r.total_experience, r.version_number,
       r.is_current, r.processing_status, r.uploaded_at, r.processed_at,
       r.created_at, now(), r.profile_summary, r.embedding_model,
       r.embedding_version, r.embedding, r.status, r.storage_key
  FROM needs_copy n
  JOIN syntra.resumes r ON r.candidate_id = n.original_id AND r.is_current
ON CONFLICT (id) DO NOTHING;


-- ════════════════════════════════════ point the 263 at the right rows ══
UPDATE syntra.matches m
   SET candidate_id = n.copy_id,
       resume_id    = md5(m.resume_id::text || n.target_org::text)::uuid,
       updated_at   = now()
  FROM needs_copy n, syntra.jobs j
 WHERE m.job_id = j.id
   AND m.candidate_id = n.original_id
   AND j.org_id = n.target_org
   AND j.org_id <> (SELECT c.org_id FROM syntra.candidates c WHERE c.id = m.candidate_id);


-- ══════════════════════════════════════════════════════════ verify ══
DO $$
DECLARE crossed int; copies int;
BEGIN
  SELECT count(*) INTO crossed
    FROM syntra.matches m
    JOIN syntra.jobs j       ON j.id = m.job_id
    JOIN syntra.candidates c ON c.id = m.candidate_id
   WHERE j.org_id <> c.org_id;

  SELECT count(*) INTO copies FROM needs_copy;

  IF crossed > 0 THEN
    RAISE EXCEPTION 'still % matches crossing a tenant boundary — not resolved', crossed;
  END IF;

  RAISE NOTICE '% people now have a second row in the organisation that was matching them.', copies;
  RAISE NOTICE 'No match crosses a tenant boundary. Nothing was deleted.';
END $$;

DROP TABLE needs_copy;
