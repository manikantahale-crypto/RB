-- A match score says how it was made.
--
-- WHAT WAS WRONG
--
-- core.matches.score is the number the recruiter's threshold is applied to,
-- and until now it was whatever the model said, verbatim. The model does not
-- know which skills the requirement called mandatory — it sees two summaries
-- — so it can say 88 for a candidate missing the one skill the requirement
-- cannot do without. Nothing recorded that a cap should have applied, and
-- nothing could, because the requirement's mandatory_skills were never
-- written (0 rows until 2026-09-20).
--
-- `llm_score` already exists on the table (it came across in the copy from a
-- V44 the other project applied). What is missing is the word for HOW the
-- final score was reached.
--
-- WHAT THIS DOES
--
-- One column, four values:
--   llm               the model's score, unchanged
--   llm_capped        the model's score, lowered by a rule the evidence
--                     supports (a mandatory skill missing; required-skill
--                     coverage under the threshold) — evidence.caps_applied
--                     names the rule
--   provisional_skill no model answer; tier 2's skill overlap stands in
--   fallback          neither; the row was scored some other way
--
-- Existing rows are left NULL: how they were scored is not recorded and a
-- guess would look like a fact. The worker writes it from now on
-- (modules/syntra/workers/matchRequested.worker.js).
--
-- SAFE TO RE-RUN.

BEGIN;

ALTER TABLE core.matches ADD COLUMN IF NOT EXISTS score_source text;

ALTER TABLE core.matches DROP CONSTRAINT IF EXISTS matches_score_source_check;
ALTER TABLE core.matches
  ADD CONSTRAINT matches_score_source_check
  CHECK (score_source IS NULL OR score_source IN ('llm', 'llm_capped', 'provisional_skill', 'fallback'));

COMMENT ON COLUMN core.matches.llm_score IS
  'The model''s match score (0-100) before any cap. score is what the recruiter sees.';
COMMENT ON COLUMN core.matches.score_source IS
  'How score was reached: llm | llm_capped | provisional_skill | fallback. NULL for rows scored before V20260909.74.';

DO $$
DECLARE
  scored int;
BEGIN
  SELECT count(*) INTO scored FROM core.matches WHERE status = 'completed';
  RAISE NOTICE 'core.matches.score_source added; % completed row(s) predate it and stay NULL.', scored;
END $$;

COMMIT;
