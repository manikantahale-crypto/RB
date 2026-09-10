--
-- Stop playing whack-a-mole with syntra.recruiter_review_items.
--
-- V20260909.35 dropped it. It came back twice, most recently 150 rows between
-- 06:05:14 and 06:06:01 on 2026-09-10, every one of them a duplicate of a
-- review item already in syntra.review_queue.
--
-- IT IS NOT THIS CHECKOUT. node-api's review repository was fixed and asserts
-- rather than creates; nothing under node-api/src, packages/*/src or
-- apps/*/src names `recruiter_review_items` outside a comment. But the rows
-- carry this codebase's own strings -- action_type 'duplicate_review', title
-- 'Duplicate candidate review needed' -- so something is running an OLDER COPY
-- of this repository against this database. Two of the three bursts happened
-- while nothing at all was running on the development machine.
--
-- Dropping it a third time would achieve exactly what the first two did.
--
-- SO THE OLD NAME BECOMES A VIEW, THE WAY public.event_outbox DID
--
-- One table, two names. Old code reading or writing `recruiter_review_items`
-- now reads and writes the real queue. That fixes the duplication at its
-- source: the repository dedupes on source_event_id, and its lookup was
-- landing in a table it had just created empty, so every replayed event looked
-- new. Pointed at the real rows, it finds them and writes nothing.
--
-- WHAT THIS DOES NOT FIX, DELIBERATELY
--
-- The old copy also runs CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT
-- EXISTS at boot. Against a view the CREATE TABLE skips quietly, but
-- CREATE INDEX raises `cannot create index on relation ... not supported for
-- views` -- IF NOT EXISTS checks the relation kind before the name. That whole
-- DDL string runs as one statement, so it fails, and the old copy's review
-- path fails with it.
--
-- That is the better failure. It has spent the day silently writing 519
-- duplicate review items into a table nothing reads. Loud and stopped beats
-- quiet and wrong, and it names the one thing left to do: update that copy.
--
-- SAFE TO RE-RUN.
--

DO $$
DECLARE
  stray     int;
  unmatched int;
BEGIN
  IF to_regclass('syntra.recruiter_review_items') IS NULL THEN
    RAISE NOTICE 'no table to replace.';
  ELSIF (SELECT c.relkind FROM pg_class c
          WHERE c.oid = 'syntra.recruiter_review_items'::regclass) = 'v' THEN
    RAISE NOTICE 'syntra.recruiter_review_items is already the view.';
  ELSE
    EXECUTE 'SELECT count(*) FROM syntra.recruiter_review_items' INTO stray;

    -- The same guard as V20260909.35. A row here that is NOT already in the
    -- queue is a review nobody has seen, and it must not be dropped.
    EXECUTE $q$
      SELECT count(*) FROM syntra.recruiter_review_items s
       WHERE s.source_event_id IS NULL
          OR NOT EXISTS (SELECT 1 FROM syntra.review_queue q
                          WHERE q.source_event_id = s.source_event_id)
    $q$ INTO unmatched;

    IF unmatched > 0 THEN
      RAISE EXCEPTION
        '% of % rows in syntra.recruiter_review_items are not already in '
        'review_queue. Move them across before this runs.', unmatched, stray;
    END IF;

    EXECUTE 'DROP TABLE syntra.recruiter_review_items';
    RAISE NOTICE 'dropped the shell -- % duplicate rows, all present in review_queue.', stray;
  END IF;
END $$;

-- security_invoker so the view is not a way around row-level security on the
-- queue, for the same reason public.event_outbox has it.
CREATE OR REPLACE VIEW syntra.recruiter_review_items
  WITH (security_invoker = true) AS
  SELECT id, user_id, organization_id, action_type, status, title, message,
         payload, source_event_type, source_event_id, created_at,
         decided_at, decided_by, decision_note
    FROM syntra.review_queue;


DO $$
DECLARE
  through_view  int;
  through_table int;
BEGIN
  SELECT count(*) INTO through_view  FROM syntra.recruiter_review_items;
  SELECT count(*) INTO through_table FROM syntra.review_queue;

  IF through_view <> through_table THEN
    RAISE EXCEPTION 'the view shows % rows and the queue holds %.',
      through_view, through_table;
  END IF;

  RAISE NOTICE 'syntra.review_queue: % rows, reachable under both names.', through_table;
END $$;
