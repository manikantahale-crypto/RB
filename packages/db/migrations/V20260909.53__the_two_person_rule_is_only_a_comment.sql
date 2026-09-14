--
-- The two-person rule was designed, documented, referenced, and never written.
--
-- V20260909.49 added requested_by / requested_by_label / approved_by /
-- approved_by_label to authoring.graph_versions so the platform could say who
-- asked for a version and who said yes. The point of recording both is that
-- they must be different people. Nothing anywhere enforced it:
--
--   * V20260909.49 added the four columns and no constraint.
--   * approveGoLive() never compared the approver to the requester.
--   * Comments in two files name a constraint, graph_versions_two_person_ck,
--     that does not exist in any database.
--
-- Proved rather than assumed: against the reference database, one caller
-- requested go-live and then approved it, as the same identity, and the
-- version went live. That is the control these columns exist to provide,
-- absent while appearing to be present -- which is worse than absent, because
-- the screens and the comments both say it is there.
--
-- WHY THE COMPARISON IS NOT ON THE UUID COLUMNS
--
-- The obvious constraint is
--
--     CHECK (approved_by IS NULL OR requested_by IS NULL
--            OR approved_by <> requested_by)
--
-- and it would be inert. attribution() writes a uuid into *_by when the caller
-- resolves to a row in platform.users and a free-text label into *_by_label
-- otherwise, and every request the admin screens make today arrives as a label
-- (x-admin-id: admin-local). Both uuid columns are therefore NULL on both
-- sides of every such request, the OR short-circuits, and the check passes for
-- exactly the traffic it was written to stop.
--
-- So this compares the EFFECTIVE identity: the uuid where there is one, the
-- label otherwise.
--
-- WHY IT IS GUARDED ON THE TIMESTAMPS
--
-- coalesce(NULL, NULL) IS DISTINCT FROM coalesce(NULL, NULL) is false, so a
-- row with no attribution at all -- which is all 527 existing versions, and
-- every version created before V20260909.49 -- would fail a bare comparison.
-- The rule only has anything to say once both acts have actually happened, so
-- it applies only when both timestamps are set.
--
-- A row where both acts happened and NEITHER identity was recorded is still
-- refused. Two anonymous acts cannot be shown to be two different people, and
-- a rule that accepts "unknown approved what unknown requested" is not a rule.
--
-- NOT VALID is deliberate and is immediately validated in a second statement:
-- ADD CONSTRAINT ... NOT VALID takes a lesser lock and does not scan, and the
-- VALIDATE that follows scans without blocking writes. The scan is checked
-- rather than skipped -- a constraint left NOT VALID enforces new rows while
-- quietly tolerating old ones, which is how a table ends up with rows its own
-- constraint forbids.
--
-- SAFE TO RE-RUN.
--

DO $$
DECLARE
  violations int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'authoring.graph_versions'::regclass
       AND conname  = 'graph_versions_two_person_ck'
  ) THEN
    RAISE NOTICE 'graph_versions_two_person_ck already exists';
    RETURN;
  END IF;

  -- Say what is wrong before refusing to add it, rather than after.
  SELECT count(*) INTO violations
    FROM authoring.graph_versions
   WHERE approved_at IS NOT NULL
     AND requested_at IS NOT NULL
     AND coalesce(approved_by::text, approved_by_label)
         IS NOT DISTINCT FROM
         coalesce(requested_by::text, requested_by_label);

  IF violations > 0 THEN
    RAISE EXCEPTION
      '% version(s) were approved by whoever requested them. They have to be '
      'reviewed by a person before this rule can be enforced -- see '
      'authoring.graph_versions where approved_at and requested_at are both set.',
      violations;
  END IF;

  ALTER TABLE authoring.graph_versions
    ADD CONSTRAINT graph_versions_two_person_ck CHECK (
      approved_at IS NULL
      OR requested_at IS NULL
      OR coalesce(approved_by::text, approved_by_label)
         IS DISTINCT FROM
         coalesce(requested_by::text, requested_by_label)
    ) NOT VALID;

  ALTER TABLE authoring.graph_versions
    VALIDATE CONSTRAINT graph_versions_two_person_ck;

  RAISE NOTICE 'graph_versions_two_person_ck added and validated';
END $$;


--
-- The rule, exercised. A migration that adds a constraint and does not try it
-- has shown that the statement parsed, not that it refuses anything.
--
DO $$
DECLARE
  graph uuid;
  refused boolean := false;
BEGIN
  INSERT INTO authoring.graphs (graph_key, application, title, status)
       VALUES ('__two_person_probe__', 'syntra', 'probe', 'draft')
    RETURNING id INTO graph;

  BEGIN
    INSERT INTO authoring.graph_versions
           (graph_id, version, definition, checksum, status,
            requested_by_label, requested_at,
            approved_by_label,  approved_at)
         VALUES (graph, 1, '{"nodes":[],"edges":[]}'::jsonb, 'probe', 'live',
                 'same-person', now(),
                 'same-person', now());
  EXCEPTION WHEN check_violation THEN
    refused := true;
  END;

  DELETE FROM authoring.graph_versions WHERE graph_id = graph;
  DELETE FROM authoring.graphs        WHERE id = graph;

  IF NOT refused THEN
    RAISE EXCEPTION
      'graph_versions_two_person_ck accepted a version requested and approved '
      'by the same identity. The rule is not being enforced.';
  END IF;

  RAISE NOTICE 'the same person cannot request and approve a version.';
END $$;
