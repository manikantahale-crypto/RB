--
-- Two indexes RELAY created, written down.
--
-- These are not ours. `relay.email_messages` and `relay.email_threads` belong
-- to RELAY, which runs from a different codebase against this database, and
-- somebody there added:
--
--   idx_relay_msg_thread_date      (thread_id, date DESC)
--   idx_relay_threads_latest_date  (latest_date DESC)
--
-- Both are sensible: the first serves reading a thread newest-first, the
-- second serves listing threads by recency. Nothing here second-guesses them.
--
-- WHY RECORD SOMEBODY ELSE'S INDEX
--
-- Because the alternative is that scripts/rebuild-check.sh reports drift
-- forever, and a drift report that is always red stops being read. The whole
-- value of that check is that a clean result means the files ARE the schema;
-- two permanently-unexplained lines cost exactly that.
--
-- So they are recorded rather than removed. If RELAY drops them, this becomes
-- the thing to delete -- and the check will say so, which is the point.
--
-- IF NOT EXISTS because RELAY may well create them again on its own.
--
-- SAFE TO RE-RUN.
--

DO $$
BEGIN
  IF to_regclass('relay.email_messages') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_relay_msg_thread_date
      ON relay.email_messages USING btree (thread_id, date DESC);
  END IF;

  IF to_regclass('relay.email_threads') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_relay_threads_latest_date
      ON relay.email_threads USING btree (latest_date DESC);
  END IF;
END $$;
