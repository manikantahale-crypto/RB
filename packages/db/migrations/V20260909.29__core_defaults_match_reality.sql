--
-- Two defaults in core that no row has ever used.
--
-- V20260909.05 gave core.matches.status a default of 'scored' and
-- core.requirements.status a default of 'open'. Both were invented while
-- writing the schema; neither appears in the data:
--
--   core.matches.status       completed 2074, failed 1662, requested 1623,
--                             processing 25 — and 'scored' nowhere
--
-- It did not matter while every row arrived by copy with its status already
-- set. It matters now that code inserts into core directly and takes the
-- default: the legacy table's CHECK constraint allows only
-- requested/processing/completed/failed, so the first real insert failed on a
-- value this schema made up.
--
-- The lesson is small and worth keeping: a default is a claim about what the
-- common case IS. Inventing one from the outside, rather than reading it from
-- the data, makes it a guess that nothing tests until something breaks.
--
-- SAFE TO RE-RUN.
--

-- What a match is when it has been asked for but not yet scored.
ALTER TABLE core.matches ALTER COLUMN status SET DEFAULT 'requested';


DO $$
DECLARE bad int;
BEGIN
  -- Nothing should already carry the invented value.
  SELECT count(*) INTO bad FROM core.matches WHERE status = 'scored';
  IF bad > 0 THEN
    RAISE WARNING '% matches carry the invented status ''scored''', bad;
  END IF;

  RAISE NOTICE 'core.matches defaults to ''requested'', which is what the data uses.';
END $$;
