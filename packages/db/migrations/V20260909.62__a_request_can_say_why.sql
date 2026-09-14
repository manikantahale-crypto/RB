-- Let the person asking for go-live say what they changed and why.
--
-- WHAT WAS MISSING
--
-- `graph_versions` records who compiled a version, who requested it and who
-- approved it, each with a timestamp. It records nothing about WHAT the
-- request is for.
--
-- So the approver — who by `graph_versions_two_person_ck` is never the author —
-- opened the queue and saw a key, a number and a checksum. Everything about
-- intent had to be reconstructed from a diff, or asked for in a message
-- somewhere else, or guessed. Approving a change nobody explained is how a
-- two-person rule becomes a rubber stamp: the second person cannot add
-- anything, so they stop trying.
--
-- WHY A COLUMN AND NOT A SEPARATE TABLE
--
-- It belongs to the version, exactly like `requested_by` and `requested_at`,
-- and it has the same lifetime: written when the request is made, read when it
-- is reviewed, kept afterwards as the record of why this version went live. A
-- side table would be a join for one string and a second place for the request
-- to half-exist.
--
-- DELIBERATELY NOT REQUIRED
--
-- An empty note is honest about a change that speaks for itself, and forcing
-- one produces "update" a thousand times, which is worse than nothing because
-- it looks like an answer. The screen asks for it and explains why it helps;
-- the database does not insist.

BEGIN;

ALTER TABLE authoring.graph_versions
  ADD COLUMN IF NOT EXISTS request_note text;

COMMENT ON COLUMN authoring.graph_versions.request_note IS
  'What the author says this version changes and why, written when go-live is '
  'requested. Shown to the approver, who is never the author. Optional.';

--
-- A note without a request is a note about nothing.
--
-- Not the reverse: a request without a note is fine and is the common case for
-- a change that explains itself.
--
ALTER TABLE authoring.graph_versions
  DROP CONSTRAINT IF EXISTS graph_versions_note_needs_request_ck;
ALTER TABLE authoring.graph_versions
  ADD CONSTRAINT graph_versions_note_needs_request_ck CHECK (
    request_note IS NULL OR requested_at IS NOT NULL
  );

DO $$
DECLARE
  pending int;
BEGIN
  SELECT count(*) INTO pending
    FROM authoring.graph_versions WHERE status = 'pending_go_live';
  RAISE NOTICE
    'requests can carry a note; % version(s) are waiting for approval now.',
    pending;
END $$;

COMMIT;
