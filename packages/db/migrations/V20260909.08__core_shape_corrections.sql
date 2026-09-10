--
-- Step 4, second prerequisite: two more corrections found by reading the data.
--
-- ═══════════════════════════════════════════════ 1 · ONE MORE COLUMN ══
--
-- syntra.matches.llm_score is set on 482 of 5,384 rows and core.matches has
-- nowhere to put it. `score` is the final number; `llm_score` is what the model
-- said before SYNTRA's weighting was applied. Two different facts.
--
-- Two other columns turned out to need no new home:
--   policy_id      0 of 5,384 populated — carried by nothing, dropped
--   retry_count,   these are processing state, and core.processing_jobs is
--   matching_error exactly the table that exists to hold it
--
ALTER TABLE core.matches ADD COLUMN IF NOT EXISTS llm_score numeric;


-- ═════════════════════════════ 2 · A RULE THE DATA DOES NOT SATISFY ══
--
-- The design gives core.people a per-tenant unique key on email:
--
--   UNIQUE (org_id, lower(email))     -- deduplication, per tenant
--
-- 24 email addresses appear more than once inside the same organisation,
-- across 117 of the 325 candidate rows. The move would reject a third of the
-- people.
--
-- These are not corrupt. They are the duplicates SYNTRA has an entire workflow
-- for — `duplicate.review`, with a human gate. The design's constraint assumes
-- that review has already happened; in this database it has not, and
-- public.duplicate_reviews has zero rows.
--
-- So the index is relaxed to non-unique. The rule is still the target, and it
-- is enforced the day the duplicates are merged:
--
--   -- find them
--   SELECT org_id, lower(email), count(*), array_agg(id)
--     FROM core.people WHERE email IS NOT NULL AND deleted_at IS NULL
--    GROUP BY 1,2 HAVING count(*) > 1;
--
--   -- then, once each group is one row
--   DROP INDEX core.people_org_email_idx;
--   CREATE UNIQUE INDEX people_org_email_idx ON core.people (org_id, lower(email::text))
--     WHERE email IS NOT NULL AND deleted_at IS NULL;
--
-- The alternative — dropping 117 people so a constraint passes — would delete
-- the very rows the duplicate workflow exists to reconcile, and would orphan
-- the matches pointing at them.
DROP INDEX IF EXISTS core.people_org_email_idx;
CREATE INDEX IF NOT EXISTS people_org_email_idx
  ON core.people (org_id, lower(email::text))
  WHERE email IS NOT NULL AND deleted_at IS NULL;


DO $$
BEGIN
  RAISE NOTICE 'core.matches.llm_score added; people email index relaxed pending duplicate review';
END $$;
