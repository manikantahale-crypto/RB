--
-- Who asked for a version to go live, and who said yes.
--
-- V20260909.48 gave a version the `pending_go_live` state. A state on its own
-- makes the request visible but not accountable: "approved" with no record of
-- who approved it is a status, not a gate, and the first question after
-- anything goes wrong is which of those two people to talk to.
--
-- Six columns, following the shape the table already uses for `compiled_by`:
-- a typed, foreign-keyed id when the actor is a known user, and a label when it
-- is not. Admin ids here are frequently labels -- `admin-local` in development,
-- deployment names in CI -- and the choice between dropping those and putting
-- them in a uuid column is a false one. Both are provenance.
--
-- NOT NULLABLE-ONLY BY OVERSIGHT: every column is nullable on purpose. The 527
-- versions that exist were promoted before there was a request to record, and
-- inventing a requester for them would be worse than admitting there was none.
--
-- SAFE TO RE-RUN.
--

ALTER TABLE authoring.graph_versions
  ADD COLUMN IF NOT EXISTS requested_by       uuid REFERENCES platform.users (id),
  ADD COLUMN IF NOT EXISTS requested_by_label text,
  ADD COLUMN IF NOT EXISTS requested_at       timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by        uuid REFERENCES platform.users (id),
  ADD COLUMN IF NOT EXISTS approved_by_label  text,
  ADD COLUMN IF NOT EXISTS approved_at        timestamptz;

-- Finding what is waiting for someone is the query the review screen runs, and
-- it is a small slice of a large table.
CREATE INDEX IF NOT EXISTS graph_versions_pending_idx
  ON authoring.graph_versions (graph_id, requested_at DESC)
  WHERE status = 'pending_go_live';


DO $$
BEGIN
  RAISE NOTICE 'graph_versions records who asked and who approved. % awaiting approval.',
    (SELECT count(*) FROM authoring.graph_versions WHERE status = 'pending_go_live');
END $$;
