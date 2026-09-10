--
-- Step 2a: give every SYNTRA row an owner.
--
-- The target design makes `org_id` mandatory on the shared business entities
-- and enforces it with composite foreign keys. Those keys cannot go on until
-- every row has an owner, and today the SYNTRA tables have no org column at
-- all — 2,946 jobs, 325 candidates, 292 resumes and 5,384 matches with nothing
-- saying whose they are.
--
-- OWNERSHIP IS DERIVED, NOT DECIDED
--
-- The design document treats "which organisation owns the existing data" as a
-- blocking business decision. It mostly is not: `created_by` is populated and
-- resolves to a user, and a user belongs to an organisation. So the answer is
-- already in the database and this reads it out rather than asking somebody to
-- guess. The passes run strongest-evidence first:
--
--   1  jobs, candidates    created_by -> platform.org_members
--   2  candidates          the jobs they were matched against, where those
--                          jobs agree on one organisation
--   3  resumes             the candidate they belong to
--   4  matches, scoring    the job, with the candidate as fallback
--   5  whatever is left    the organisation that owns everything else
--
-- Pass 5 is a judgement and is marked as one. Everything before it is evidence.
--
-- ADDITIVE AND REVERSIBLE. The column is nullable here on purpose. Nothing
-- reads it yet, nothing is constrained by it, and a wrong answer is one UPDATE
-- away from a better one. NOT NULL and the foreign keys are step 3, which is
-- the step that commits.
--
-- SAFE TO RE-RUN. Columns are added IF NOT EXISTS and every pass is restricted
-- to rows where org_id IS NULL.
--

-- ─────────────────────────────────────────────────────────────── columns ──
ALTER TABLE syntra.jobs           ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE syntra.candidates     ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE syntra.resumes        ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE syntra.matches        ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE syntra.ml_scoring_log ADD COLUMN IF NOT EXISTS org_id uuid;


-- ───────────────────────────────────────────────────────── 1 · the creator ──
--
-- One membership per user is true of all 52 rows today. It will not stay true
-- — the whole point of org_members is that somebody can belong to two
-- organisations — so this refuses to answer for anyone with more than one
-- rather than picking. Those rows fall through to a later pass.
UPDATE syntra.jobs j
   SET org_id = o.org_id
  FROM (SELECT user_id, (array_agg(org_id))[1] AS org_id
          FROM platform.org_members GROUP BY user_id HAVING count(*) = 1) o
 WHERE j.org_id IS NULL AND j.created_by = o.user_id;

UPDATE syntra.candidates c
   SET org_id = o.org_id
  FROM (SELECT user_id, (array_agg(org_id))[1] AS org_id
          FROM platform.org_members GROUP BY user_id HAVING count(*) = 1) o
 WHERE c.org_id IS NULL AND c.created_by = o.user_id;


-- ────────────────────────────────────────── 2 · who they were matched for ──
--
-- 22 candidates have created_by NULL — never filled, rather than pointing at a
-- missing user. They are the earliest data in the database. Where such a
-- candidate was matched against jobs that all belong to one organisation, that
-- is real evidence and better than a default.
--
-- It recovers one row today. It is here because it is the correct order to ask
-- the questions in, and because on a larger dataset it recovers more.
UPDATE syntra.candidates c
   SET org_id = e.org_id
  FROM (
        SELECT m.candidate_id, min(j.org_id::text)::uuid AS org_id
          FROM syntra.matches m
          JOIN syntra.jobs j ON j.id = m.job_id
         WHERE j.org_id IS NOT NULL
         GROUP BY m.candidate_id
        HAVING count(DISTINCT j.org_id) = 1
       ) e
 WHERE c.org_id IS NULL AND c.id = e.candidate_id;


-- ───────────────────────────────────────────────────── 3 · the person's own ──
-- A resume has no creator of its own; it arrived attached to a person.
UPDATE syntra.resumes r
   SET org_id = c.org_id
  FROM syntra.candidates c
 WHERE r.org_id IS NULL AND r.candidate_id = c.id AND c.org_id IS NOT NULL;


-- ──────────────────────────────────────────────── 4 · the requirement side ──
--
-- A match is work done against a requirement, so it belongs to the requirement
-- side. The candidate is only a fallback, for rows where the job's owner could
-- not be resolved.
--
-- See the warning at the bottom: some of these join a job and a candidate that
-- belong to DIFFERENT organisations, and taking the job side is a choice.
UPDATE syntra.matches m
   SET org_id = j.org_id
  FROM syntra.jobs j
 WHERE m.org_id IS NULL AND m.job_id = j.id AND j.org_id IS NOT NULL;

UPDATE syntra.matches m
   SET org_id = c.org_id
  FROM syntra.candidates c
 WHERE m.org_id IS NULL AND m.candidate_id = c.id AND c.org_id IS NOT NULL;

UPDATE syntra.ml_scoring_log l
   SET org_id = j.org_id
  FROM syntra.jobs j
 WHERE l.org_id IS NULL AND l.job_id = j.id AND j.org_id IS NOT NULL;

UPDATE syntra.ml_scoring_log l
   SET org_id = c.org_id
  FROM syntra.candidates c
 WHERE l.org_id IS NULL AND l.candidate_id = c.id AND c.org_id IS NOT NULL;


-- ═══════════════════════════════════ 5 · the umbrella — A JUDGEMENT, NOT EVIDENCE ══
--
-- What is left has no signal at all: created_by was never filled, and nothing
-- else in the database points at these rows. Roughly 24 of them, all created
-- 2026-08-06 to 2026-08-19, before whatever started recording a creator.
--
-- They go to the organisation that owns everything else — 48 of 52 users,
-- 9,938 of 9,965 runs, 2,799 of 2,946 jobs. This matches the decision already
-- taken for the 29 unattributed runs in V20260909.02: put them under the same
-- umbrella rather than delete them, and revisit at the production cutover when
-- dropping test data is a deliberate act.
--
-- IF THAT IS WRONG, THIS IS THE BLOCK TO CHANGE. Delete it and those rows stay
-- NULL, and step 3 will refuse to make org_id NOT NULL until someone decides.
-- That is the correct failure: better a migration that stops than a database
-- that quietly claims the wrong owner.
DO $$
DECLARE
  umbrella constant uuid := '2b8e12b3-1745-4ae9-902c-5a249c28ba94';
  n int; total int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.organizations WHERE id = umbrella) THEN
    RAISE NOTICE 'umbrella organisation not present; leaving unattributed rows alone';
    RETURN;
  END IF;

  UPDATE syntra.jobs       SET org_id = umbrella WHERE org_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  UPDATE syntra.candidates SET org_id = umbrella WHERE org_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  -- Re-run the person-to-resume pass: the candidates just given an owner may
  -- have resumes that pass 3 could not reach.
  UPDATE syntra.resumes r
     SET org_id = c.org_id
    FROM syntra.candidates c
   WHERE r.org_id IS NULL AND r.candidate_id = c.id AND c.org_id IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  UPDATE syntra.resumes        SET org_id = umbrella WHERE org_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  UPDATE syntra.matches        SET org_id = umbrella WHERE org_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  UPDATE syntra.ml_scoring_log SET org_id = umbrella WHERE org_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  IF total > 0 THEN
    RAISE NOTICE 'umbrella: % rows had no evidence of an owner and were given one', total;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────── indexes ──
-- Every query that becomes tenant-scoped filters on this column, and step 3
-- puts a composite key on it.
CREATE INDEX IF NOT EXISTS jobs_org_idx           ON syntra.jobs (org_id);
CREATE INDEX IF NOT EXISTS candidates_org_idx     ON syntra.candidates (org_id);
CREATE INDEX IF NOT EXISTS resumes_org_idx        ON syntra.resumes (org_id);
CREATE INDEX IF NOT EXISTS matches_org_idx        ON syntra.matches (org_id);
CREATE INDEX IF NOT EXISTS ml_scoring_log_org_idx ON syntra.ml_scoring_log (org_id);


-- ══════════════════════════════════════════════════════════════ report ══
DO $$
DECLARE
  r record;
  crossed int;
BEGIN
  FOR r IN
    SELECT 'jobs' t, count(*) n, count(org_id) owned FROM syntra.jobs
    UNION ALL SELECT 'candidates', count(*), count(org_id) FROM syntra.candidates
    UNION ALL SELECT 'resumes',    count(*), count(org_id) FROM syntra.resumes
    UNION ALL SELECT 'matches',    count(*), count(org_id) FROM syntra.matches
    UNION ALL SELECT 'ml_scoring_log', count(*), count(org_id) FROM syntra.ml_scoring_log
  LOOP
    IF r.owned = r.n THEN
      RAISE NOTICE '% : % of % owned', rpad(r.t, 15), r.owned, r.n;
    ELSE
      RAISE WARNING '% : % of % owned — % still unattributed',
        rpad(r.t, 15), r.owned, r.n, r.n - r.owned;
    END IF;
  END LOOP;

  -- THE FINDING THAT MATTERS MORE THAN THE ROWS.
  --
  -- A match whose job and candidate belong to different organisations means
  -- the two sides disagree about who owns them. The cause here was NOT the
  -- matcher: every path that inserts a match joins c.created_by = j.created_by,
  -- so these rows were consistent when they were written. 33 users then had
  -- their organization_id rewritten in a single update on 2026-09-03, and the
  -- mapping underneath them changed.
  --
  -- What that exposes is still real: isolation is by USER, not by
  -- ORGANISATION. Two recruiters at one agency cannot see each other's
  -- candidates, and a person moving between agencies silently reclassifies
  -- everything they ever touched.
  SELECT count(*) INTO crossed
    FROM syntra.matches m
    JOIN syntra.jobs j       ON j.id = m.job_id
    JOIN syntra.candidates c ON c.id = m.candidate_id
   WHERE j.org_id IS NOT NULL AND c.org_id IS NOT NULL AND j.org_id <> c.org_id;

  IF crossed > 0 THEN
    RAISE WARNING 'CROSS-TENANT: % matches join a job and a candidate from different organisations.', crossed;
    RAISE WARNING '              They carry the JOB''s organisation. Cause: 33 users had their';
    RAISE WARNING '              organization_id rewritten in one update on 2026-09-03, so rows';
    RAISE WARNING '              consistent when written became inconsistent afterwards.';
  END IF;
END $$;
