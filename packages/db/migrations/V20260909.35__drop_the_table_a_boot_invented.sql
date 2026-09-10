--
-- Remove a table that no migration created and no migration knew about.
--
-- V20260909.31 renamed syntra.recruiter_review_items to syntra.review_queue.
-- A node-api process still running the previous code restarted afterwards,
-- found the old name gone, and created it again — because that repository did
-- CREATE TABLE IF NOT EXISTS at boot. Postgres named its constraints
-- `recruiter_review_items_pkey1` and `..._status_check1`, the `1` being the
-- clearest possible signal that something built a second copy of a table that
-- already existed under another name.
--
-- It then wrote 204 rows into it between 05:02:30 and 05:03:43 on 2026-09-10.
--
-- WHY THOSE 204 ROWS ARE SAFE TO LOSE
--
-- Every one of them duplicates a review item already in review_queue. The
-- repository dedupes on source_event_id, and its lookup ran against the table
-- the process had just created empty, so every replayed event looked new.
-- All 204 source_event_ids resolve to a row in review_queue; 3 of those have
-- already been decided. Keeping them would put settled work back in front of
-- a recruiter.
--
-- The assertion below re-checks that before dropping anything. If a genuinely
-- new item had arrived in the meantime, this migration fails rather than
-- taking it with the rest.
--
-- The boot DDL is gone in the same change — node-api's review repository now
-- asserts and refuses, like the six sites in packages/ and apps/ that were
-- fixed earlier. This was the seventh; the sweep that found those only looked
-- at packages/*/src and apps/*/src.
--
-- NO-OP ON A DATABASE BUILT FROM THESE FILES. The table only exists where a
-- process invented it, which is the point.
--
-- SAFE TO RE-RUN.
--

DO $$
DECLARE
  stray     int;
  unmatched int;
BEGIN
  IF to_regclass('syntra.recruiter_review_items') IS NULL THEN
    RAISE NOTICE 'nothing to remove — syntra.recruiter_review_items does not exist.';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM syntra.recruiter_review_items' INTO stray;

  EXECUTE $q$
    SELECT count(*) FROM syntra.recruiter_review_items s
     WHERE s.source_event_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM syntra.review_queue q
                        WHERE q.source_event_id = s.source_event_id)
  $q$ INTO unmatched;

  IF unmatched > 0 THEN
    RAISE EXCEPTION
      '% of % rows in syntra.recruiter_review_items are not already in '
      'review_queue. They are review items nobody has seen, not duplicates. '
      'Move them across before dropping the table.', unmatched, stray;
  END IF;

  EXECUTE 'DROP TABLE syntra.recruiter_review_items';
  RAISE NOTICE 'dropped syntra.recruiter_review_items — % duplicate rows, all present in review_queue.', stray;
END $$;
