--
-- Step 3: make ownership mandatory and enforce the tenant boundary.
--
-- This is the first migration that COMMITS rather than adds. Everything before
-- it could be undone by dropping a schema nobody read. After this, org_id is
-- NOT NULL and rows that cross a tenant boundary are refused.
--
-- It is safe to run because step 2a already gave every row an owner: 2,946
-- jobs, 325 candidates, 292 resumes, 5,384 matches and 431 scoring rows, all
-- covered. NOT NULL on a column with no nulls is a scan, not a rewrite, and
-- these tables are small enough for it to be instant.
--
-- ══════════════════════════════════════════════════════════════════════════
-- TWO SETS OF ROWS THAT CANNOT SATISFY THESE KEYS, AND WHAT IS DONE ABOUT THEM
--
-- 263 matches join a job and a candidate belonging to DIFFERENT organisations.
-- They were given the job's organisation in step 2a, so the key to the job
-- passes and the keys to the candidate and the resume cannot.
--
-- Those two constraints are added NOT VALID: Postgres enforces them on every
-- INSERT and UPDATE from now on, but does not check the rows already there. So
-- the leak closes today — a new cross-tenant match is refused by the database —
-- while 263 rows of historical test data stay visible instead of being
-- silently deleted to make a constraint pass.
--
-- When they have been dealt with, finish the job with:
--
--   ALTER TABLE syntra.matches VALIDATE CONSTRAINT matches_candidate_org_fk;
--   ALTER TABLE syntra.matches VALIDATE CONSTRAINT matches_resume_org_fk;
--
-- Both will fail until the last one is gone, which is the point: the database
-- will not let anyone believe the boundary is fully enforced while it is not.
--
-- 55 ml_scoring_log rows reference a job_id that does not exist in
-- syntra.jobs at all — not an org mismatch, a job that is gone. No foreign key
-- is added there, deliberately: see the note above that table.
-- ══════════════════════════════════════════════════════════════════════════
--
-- SAFE TO RE-RUN. Every constraint is guarded by a catalogue check, since
-- ALTER TABLE ADD CONSTRAINT has no IF NOT EXISTS.
--

-- ══════════════════════════════════════ 1 · ownership becomes mandatory ══
DO $$
DECLARE t text; missing int;
BEGIN
  FOREACH t IN ARRAY ARRAY['jobs','candidates','resumes','matches','ml_scoring_log'] LOOP
    -- Refuse rather than fail halfway: a clear message beats a constraint
    -- violation naming a row number nobody can act on.
    EXECUTE format('SELECT count(*) FROM syntra.%I WHERE org_id IS NULL', t) INTO missing;
    IF missing > 0 THEN
      RAISE EXCEPTION 'syntra.% has % rows with no owner. Run V20260909.04 first, or decide who owns them.', t, missing;
    END IF;

    EXECUTE format('ALTER TABLE syntra.%I ALTER COLUMN org_id SET NOT NULL', t);
  END LOOP;
END $$;


-- ═══════════════════════════════ 2 · the owner must be a real organisation ══
DO $$
DECLARE t text; cname text;
BEGIN
  FOREACH t IN ARRAY ARRAY['jobs','candidates','resumes','matches','ml_scoring_log'] LOOP
    cname := t || '_org_fk';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cname) THEN
      EXECUTE format(
        'ALTER TABLE syntra.%I ADD CONSTRAINT %I
           FOREIGN KEY (org_id) REFERENCES platform.organizations (id)', t, cname);
    END IF;
  END LOOP;
END $$;


-- ══════════════════════════ 3 · something to hang composite keys from ══
--
-- id is already the primary key, so this adds nothing by itself. It exists so
-- children can reference (id, org_id) as a pair, which is what makes a
-- cross-tenant row unrepresentable rather than merely discouraged.
DO $$
DECLARE t text; cname text;
BEGIN
  FOREACH t IN ARRAY ARRAY['jobs','candidates','resumes'] LOOP
    cname := t || '_id_org_key';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cname) THEN
      EXECUTE format('ALTER TABLE syntra.%I ADD CONSTRAINT %I UNIQUE (id, org_id)', t, cname);
    END IF;
  END LOOP;
END $$;


-- ═══════════════════════════════════ 4 · the keys that pass as they are ══
DO $$
BEGIN
  -- A resume belongs to the same customer as the person it describes. True of
  -- all 292 rows.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resumes_candidate_org_fk') THEN
    ALTER TABLE syntra.resumes
      ADD CONSTRAINT resumes_candidate_org_fk
      FOREIGN KEY (candidate_id, org_id) REFERENCES syntra.candidates (id, org_id);
  END IF;

  -- A match belongs to the same customer as the requirement it scores against.
  -- True of all 5,384, because that is where step 2a took the org from.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_job_org_fk') THEN
    ALTER TABLE syntra.matches
      ADD CONSTRAINT matches_job_org_fk
      FOREIGN KEY (job_id, org_id) REFERENCES syntra.jobs (id, org_id);
  END IF;
END $$;


-- ══════════════════ 5 · the keys the historical rows cannot satisfy yet ══
--
-- NOT VALID means: enforced from now on, existing rows not checked.
--
-- This is the whole tenant boundary for the candidate side. It is what would
-- have refused the 2026-09-03 reorganisation described in V20260909.05 at the
-- moment it happened, rather than leaving 263 inconsistent rows behind.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_candidate_org_fk') THEN
    ALTER TABLE syntra.matches
      ADD CONSTRAINT matches_candidate_org_fk
      FOREIGN KEY (candidate_id, org_id) REFERENCES syntra.candidates (id, org_id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_resume_org_fk') THEN
    ALTER TABLE syntra.matches
      ADD CONSTRAINT matches_resume_org_fk
      FOREIGN KEY (resume_id, org_id) REFERENCES syntra.resumes (id, org_id)
      NOT VALID;
  END IF;
END $$;


-- ═════════════════════════════════════ 6 · why the scoring log has no key ══
--
-- 55 of its 431 rows name a job that no longer exists. That is not corruption:
-- ml_scoring_log is an append-only record of what a model decided, and a
-- record outliving its subject is what a log is for. A foreign key here would
-- mean deleting a job requires deleting the evidence of how it was scored,
-- which is the opposite of what an audit trail is.
--
-- org_id IS constrained, above, because "which customer's data was this
-- model run on" must always have an answer.


-- ══════════════════════════════════════════════════════════════ report ══
DO $$
DECLARE blocked_candidate int; blocked_resume int;
BEGIN
  SELECT count(*) INTO blocked_candidate
    FROM syntra.matches m
    LEFT JOIN syntra.candidates c ON c.id = m.candidate_id AND c.org_id = m.org_id
   WHERE c.id IS NULL;

  SELECT count(*) INTO blocked_resume
    FROM syntra.matches m
    LEFT JOIN syntra.resumes r ON r.id = m.resume_id AND r.org_id = m.org_id
   WHERE r.id IS NULL;

  RAISE NOTICE 'org_id is now NOT NULL on 5 tables and must name a real organisation.';
  RAISE NOTICE 'Cross-tenant matches are refused from now on.';

  IF blocked_candidate > 0 OR blocked_resume > 0 THEN
    RAISE WARNING 'Two constraints are NOT VALID: % rows fail the candidate key, % fail the resume key.',
      blocked_candidate, blocked_resume;
    RAISE WARNING 'New rows are enforced. VALIDATE CONSTRAINT once those rows are resolved.';
  ELSE
    RAISE NOTICE 'No rows block validation — run VALIDATE CONSTRAINT to finish the job.';
  END IF;
END $$;
