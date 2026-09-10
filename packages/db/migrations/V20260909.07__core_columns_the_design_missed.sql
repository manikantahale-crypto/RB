--
-- Step 4, prerequisite: columns the target design has nowhere to put.
--
-- The design document says of the SYNTRA move: "Ten tables become three.
-- Nothing is lost." Checked against the live data, that is not quite true.
-- Nine columns are populated — three of them on every single row — and the
-- target shape has no home for them.
--
-- Rather than discover this halfway through the data move and quietly drop
-- them, the target grows here, each column justified by how many rows carry a
-- value:
--
--   core.requirements
--     score_threshold    2,946 of 2,946    per-requirement scoring cutoff
--     mandatory_skills   2,946 of 2,946    sits beside required_skills
--     preferred_skills   2,946 of 2,946    likewise
--
--   core.source_files                      ingestion provenance: where the
--     source_email         557             document came from, which is what
--     message_id         2,638             this table is for
--     source_type           86
--     source_name           86
--     source_url         1,924
--     relay_thread_id       18
--
--   core.people
--     candidate_source     325 of 325      how this person reached the bench
--
-- WHY THESE HOMES
--
-- `mandatory_skills` and `preferred_skills` describe what a requirement asks
-- for, exactly like `required_skills` which the design already places on
-- core.requirements. `score_threshold` is arguably SYNTRA's business rather
-- than the requirement's — but the design already puts `skill_weights` on
-- core.requirements, and splitting two halves of the same knob across two
-- schemas would be worse than following that precedent.
--
-- The provenance columns go on `core.source_files`, whose stated purpose is
-- "file and ingestion metadata". An email, a message id and a source url are
-- ingestion metadata. When `astra` gets its own intake table these may move
-- again; keeping them together makes that a move rather than a hunt.
--
-- ONE COLUMN IS NOT CARRIED, ON EVIDENCE
--
-- syntra.candidates.current_location is NULL in all 325 rows, while `location`
-- is set in 131. Two columns for one idea, one of them never used. Only
-- `location` moves.
--
-- PURELY ADDITIVE. All seven core tables are still empty.
--

ALTER TABLE core.requirements ADD COLUMN IF NOT EXISTS score_threshold  integer;
ALTER TABLE core.requirements ADD COLUMN IF NOT EXISTS mandatory_skills jsonb;
ALTER TABLE core.requirements ADD COLUMN IF NOT EXISTS preferred_skills jsonb;

ALTER TABLE core.source_files ADD COLUMN IF NOT EXISTS source_email    text;
ALTER TABLE core.source_files ADD COLUMN IF NOT EXISTS message_id      text;
ALTER TABLE core.source_files ADD COLUMN IF NOT EXISTS source_type     text;
ALTER TABLE core.source_files ADD COLUMN IF NOT EXISTS source_name     text;
ALTER TABLE core.source_files ADD COLUMN IF NOT EXISTS source_url      text;
ALTER TABLE core.source_files ADD COLUMN IF NOT EXISTS relay_thread_id text;

ALTER TABLE core.people       ADD COLUMN IF NOT EXISTS candidate_source text;

-- `file_path` is NOT NULL in the design, but only 256 of 2,946 jobs have one —
-- most requirements arrive as email or text, not as an uploaded file. A source
-- file row will be created for those 256 and for resumes, so the column stays
-- NOT NULL and rows are simply not created for requirements that have no file.
-- Recorded here because it is the kind of thing that otherwise looks like a
-- bug in the move.

DO $$
BEGIN
  RAISE NOTICE 'core widened: 3 columns on requirements, 6 on source_files, 1 on people';
END $$;
