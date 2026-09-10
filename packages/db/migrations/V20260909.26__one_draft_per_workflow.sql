--
-- Make the existing drafts match the model: one per workflow, at version 0.
--
-- Opening the editor used to allocate max(version) + 1, so every editing
-- session consumed a version number and left a row behind. `syntra.authored`
-- reached version 124 with a single active version and 32 drafts.
--
-- The code no longer does that (a draft now sits at version 0), but the rows
-- already written do not unwind themselves. This brings them into line.
--
-- WHAT IS REMOVED, AND WHAT IS NOT
--
--   83 workflows have drafts, and 83 drafts are KEPT — the newest of each.
--   31 rows are deleted, and all 31 are superseded `syntra.authored` drafts.
--   Every other workflow has exactly one draft and loses nothing.
--
-- Checked before writing this: no binding points at a draft, so nothing routes
-- to any of these rows. 77 of the 83 workflows have no published version at
-- all — their draft is the whole workflow — which is why the newest is kept
-- rather than the set being emptied.
--
-- The newest surviving `syntra.authored` draft is from 2026-08-15, so the 31
-- being removed are older editing sessions that were already superseded by it.
--
-- THIS DELETES ROWS SOMEBODY ONCE TYPED INTO. That is why it keeps the newest
-- per workflow rather than deduplicating on content, and why the count is
-- asserted below rather than assumed.
--
-- PUBLISHED VERSION NUMBERS ARE NOT RENUMBERED. syntra.authored stays at 124
-- and its next publish is 125. Those numbers are real history — a run may have
-- pinned one — and renumbering them to look tidier would break exactly the
-- thing versions exist for.
--
-- SAFE TO RE-RUN.
--

-- Keep the newest draft per workflow and organisation.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY graph_key, coalesce(org_id, '~global~')
           ORDER BY created_at DESC, version DESC
         ) AS rn
    FROM graph_definitions
   WHERE status = 'draft'
)
DELETE FROM graph_definitions g
 USING ranked r
 WHERE g.id = r.id AND r.rn > 1;


-- The survivors move to the reserved working-copy slot. The id follows, so a
-- draft is addressable as "this workflow's draft" rather than by a number that
-- no longer means anything.
UPDATE graph_definitions
   SET version = 0,
       id      = graph_key || '@draft'
 WHERE status = 'draft'
   AND version <> 0
   -- Defensive: never collide with a draft that already moved.
   AND NOT EXISTS (
     SELECT 1 FROM graph_definitions x
      WHERE x.id = graph_definitions.graph_key || '@draft'
        AND x.id <> graph_definitions.id
   );


DO $$
DECLARE
  drafts       int;
  workflows    int;
  numbered     int;
  routed       int;
BEGIN
  SELECT count(*), count(DISTINCT graph_key) INTO drafts, workflows
    FROM graph_definitions WHERE status = 'draft';

  SELECT count(*) INTO numbered
    FROM graph_definitions WHERE status = 'draft' AND version <> 0;

  SELECT count(*) INTO routed
    FROM graph_event_bindings b
    JOIN graph_definitions g ON g.graph_key = b.graph_key AND g.version = b.version
   WHERE g.status = 'draft';

  IF drafts <> workflows THEN
    RAISE EXCEPTION 'still % drafts across % workflows — not one each', drafts, workflows;
  END IF;

  IF numbered > 0 THEN
    RAISE WARNING '% drafts still carry a version number', numbered;
  END IF;

  IF routed > 0 THEN
    RAISE EXCEPTION '% bindings now point at a draft — routing must never reach one', routed;
  END IF;

  RAISE NOTICE 'one draft per workflow: % drafts, % workflows, all at version 0.',
    drafts, workflows;
END $$;
