--
-- Authoring owns workflows, and public.graph_definitions becomes a view.
--
-- Fourteen places wrote that table. All fourteen now write authoring.graphs,
-- authoring.graph_drafts and authoring.graph_versions through the five
-- functions in apps/admin-api/src/lib/authoring-writes.ts, and the
-- orchestrator's compiler -- the read on every single run -- loads its
-- topology from authoring.graph_versions.
--
-- WHY A VIEW AND NOT A MIRROR
--
-- The same reason as public.event_outbox in V20260909.38: nothing writes the
-- old name any more, so there is no second writer to reconcile. The difference
-- is that this view is READ-ONLY -- one table became three, so it is a UNION,
-- and a UNION is not auto-updatable. That is not a limitation to work around.
-- Anything still WRITING public.graph_definitions is writing a workflow that
-- will never run, because the compiler stopped reading this table; failing
-- loudly is the correct answer and the only one that gets it fixed.
--
-- THE ROWS ARE KEPT, NOT DROPPED
--
-- The table is renamed aside rather than deleted. Checked first: all 515 of
-- its rows are already represented in authoring -- 0 unaccounted for -- and
-- the view returns 610, the extra 95 being retired versions that lived in
-- public.graph_versions and never made it into graph_definitions. So nothing
-- here is load-bearing. It stays anyway, until the new project is created,
-- because that is the rule for every other superseded table.
--
-- SAFE TO RE-RUN.
--

-- ══════════════════════════════════════════════ 1 · stop the forward mirror ══
--
-- It fed authoring FROM this table. With the writes moved, it would be a
-- trigger on a table nothing writes -- and once the view replaces it, a
-- trigger on something that cannot have one.
DROP TRIGGER IF EXISTS graph_definitions_mirror_authoring ON public.graph_definitions;


-- ══════════════════════════════════════ 2 · nothing is lost by standing down ══
DO $$
DECLARE
  orphaned int;
BEGIN
  IF to_regclass('public.graph_definitions') IS NULL THEN
    RAISE NOTICE 'nothing to rename - public.graph_definitions does not exist.';
    RETURN;
  END IF;

  -- Separate branch, not an OR: `::regclass` on a missing name raises, and SQL
  -- does not promise to skip the second operand once the first is true.
  IF (SELECT c.relkind FROM pg_class c
       WHERE c.oid = 'public.graph_definitions'::regclass) <> 'r' THEN
    RAISE NOTICE 'public.graph_definitions is already the view.';
    RETURN;
  END IF;

  SELECT count(*) INTO orphaned
    FROM public.graph_definitions t
   WHERE NOT EXISTS (
     SELECT 1 FROM authoring.graph_versions v
       JOIN authoring.graphs g ON g.id = v.graph_id
      WHERE g.graph_key = t.graph_key AND v.version = t.version)
     AND NOT EXISTS (
     SELECT 1 FROM authoring.graph_drafts d
       JOIN authoring.graphs g ON g.id = d.graph_id
      WHERE g.graph_key = t.graph_key AND t.version = 0);

  IF orphaned > 0 THEN
    RAISE EXCEPTION
      '% rows in public.graph_definitions have no counterpart in authoring. '
      'They would stop being readable. Carry them across before this runs.',
      orphaned;
  END IF;

  ALTER TABLE public.graph_definitions RENAME TO graph_definitions_superseded;
  RAISE NOTICE 'public.graph_definitions -> graph_definitions_superseded (% rows kept)',
    (SELECT count(*) FROM public.graph_definitions_superseded);
END $$;


-- ═════════════════════════════════════════════ 3 · the old name still reads ══
--
-- Column for column what the table had. `id` is text there and is text here:
-- a version's id is its uuid rendered as text, a draft's is `<key>@draft`,
-- which is the reserved working-copy slot -- one per workflow, version 0.
--
-- security_invoker for the same reason as the other two compatibility views:
-- it must not become a way around row-level security on what it reads.
CREATE OR REPLACE VIEW public.graph_definitions
  WITH (security_invoker = true) AS
  SELECT v.id::text                       AS id,
         g.org_id::text                   AS org_id,
         g.graph_key,
         v.version,
         v.definition,
         v.checksum,
         -- Three statuses stay three. 'compiled' is a numbered build waiting
         -- to go live; calling it 'retired' would show a workflow under review
         -- as one already taken off the air.
         CASE v.status
           WHEN 'live'     THEN 'active'
           WHEN 'compiled' THEN 'draft'
           ELSE 'retired'
         END                              AS status,
         coalesce(v.compiled_by::text, v.compiled_by_label, 'seed') AS created_by,
         v.compiled_at                    AS created_at,
         CASE WHEN v.status = 'live' THEN v.compiled_at END AS activated_at
    FROM authoring.graph_versions v
    JOIN authoring.graphs g ON g.id = v.graph_id

  UNION ALL

  SELECT g.graph_key || '@draft'          AS id,
         g.org_id::text                   AS org_id,
         g.graph_key,
         0                                AS version,
         d.definition,
         d.checksum,
         'draft'                          AS status,
         coalesce(d.updated_by::text, g.created_by_label, 'seed') AS created_by,
         d.updated_at                     AS created_at,
         NULL::timestamptz                AS activated_at
    FROM authoring.graph_drafts d
    JOIN authoring.graphs g ON g.id = d.graph_id;

GRANT SELECT ON public.graph_definitions TO postgres;


DO $$
DECLARE
  through_view int;
BEGIN
  SELECT count(*) INTO through_view FROM public.graph_definitions;
  RAISE NOTICE 'public.graph_definitions reads % rows from authoring (% live).',
    through_view,
    (SELECT count(*) FROM authoring.graph_versions WHERE status = 'live');
END $$;
