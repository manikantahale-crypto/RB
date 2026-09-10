--
-- Authoring owns the bindings, and public.graph_event_bindings becomes a copy.
--
-- V20260909.25 mirrored the old table into authoring.event_bindings so the
-- reads could move. Every write now goes to authoring — the activate path, the
-- take-offline route, the two agent routes and the day-1 seed — so the mirror
-- turns around, as it did for the SYNTRA tables in V20260909.27 and for the
-- event catalogue in V20260909.34.
--
-- WHAT THE OLD TABLE IS STILL FOR
--
-- node-api's orchestration activity screen, RELAY and INTERVIEW's fallback
-- resolution, and a handful of scripts still read it. They read ACTIVE
-- bindings; the 461 retired rows are history nobody joins on.
--
-- TWO COLUMNS DO NOT COME BACK, AND NEITHER WAS CARRYING ANYTHING
--
--   agent_id  A binding names a workflow now. Builder's unit of authorship was
--             an agent, the platform's is a workflow, and the agent_* model is
--             being retired with this project. The 20 active legacy rows KEEP
--             the agent_id they have — this migration changes their id, not
--             their columns — so the activity screen's labels are unaffected
--             for everything that exists today. A binding created from here on
--             has no agent, because there is no longer such a thing.
--
--   version   Every binding said 1. `pinned_version_id` replaces it and is
--             NULL for a binding that follows whichever version is live, which
--             is what all of them want. The copy gets NULL rather than a
--             number nothing chose.
--
-- SAFE TO RE-RUN.
--

-- ═════════════════════════════════════ 1 · give the copy the same row ids ══
--
-- The 481 rows correspond one-for-one but share no ids: V20260909.11 filled
-- authoring.event_bindings with fresh ones. A mirror keyed on anything but the
-- primary key would be guesswork, so the ids are aligned first.
--
-- Only the ACTIVE rows, and only because for those the pairing is certain:
-- `graph_event_bindings_one_active` and `event_bindings_one_active_idx` each
-- allow exactly one active row per (event_type, scope), so matching on that is
-- matching on a unique key. The retired rows are left with the ids they have.
--
-- Nothing has a foreign key onto public.graph_event_bindings.id — checked —
-- so changing it changes nothing else.
UPDATE public.graph_event_bindings l
   SET id = b.id
  FROM authoring.event_bindings b
 WHERE l.status = 'active'
   AND b.status = 'active'
   AND b.event_type = l.event_type
   AND b.org_id IS NOT DISTINCT FROM l.org_id
   AND l.id <> b.id
   AND NOT EXISTS (SELECT 1 FROM public.graph_event_bindings x WHERE x.id = b.id);


-- ══════════════════════════════════════════════ 2 · stop the forward mirror ══
DROP TRIGGER IF EXISTS graph_event_bindings_mirror_authoring ON public.graph_event_bindings;


-- ══════════════════════════════════════════════ 3 · mirror the other way ══
CREATE OR REPLACE FUNCTION app.legacy_event_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_graph_key text;
BEGIN
  SELECT g.graph_key INTO v_graph_key
    FROM authoring.graphs g WHERE g.id = NEW.graph_id;

  -- graph_id is a foreign key, so this cannot be NULL in practice. If it ever
  -- is, the legacy row would name no workflow and be worse than absent.
  IF v_graph_key IS NULL THEN
    RAISE WARNING 'legacy mirror skipped binding on % — graph % has no key',
      NEW.event_type, NEW.graph_id;
    RETURN NEW;
  END IF;

  INSERT INTO public.graph_event_bindings (
    id, event_type, org_id, graph_key, module_queue, version, status, source,
    created_at, updated_at)
  VALUES (
    NEW.id, NEW.event_type, NEW.org_id, v_graph_key, NEW.queue_key,
    (SELECT v.version FROM authoring.graph_versions v WHERE v.id = NEW.pinned_version_id),
    NEW.status,
    -- The old table's check allows only these two. `authoring` is the honest
    -- answer for anything the platform did not seed.
    CASE WHEN NEW.source = 'seed' THEN 'seed' ELSE 'authoring' END,
    NEW.created_at, NEW.updated_at)
  ON CONFLICT (id) DO UPDATE SET
    graph_key    = EXCLUDED.graph_key,
    module_queue = EXCLUDED.module_queue,
    version      = EXCLUDED.version,
    status       = EXCLUDED.status,
    updated_at   = EXCLUDED.updated_at;
    -- agent_id is deliberately NOT written. On an existing row it is history
    -- worth keeping; on a new one there is no agent to name.

  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER event_bindings_legacy_mirror
  AFTER INSERT OR UPDATE ON authoring.event_bindings
  FOR EACH ROW EXECUTE FUNCTION app.legacy_event_binding();


-- ══════════════════════════════════ 4 · a bound event is a routed event ══
--
-- `handling` is what the router consults to decide whether an event starts a
-- workflow. An event with an active binding and `handling = 'terminal'` is
-- acknowledged and dropped however correct the workflow behind it is — the
-- fault that silently killed RELAY's two bindings.
--
-- The activate path now promotes it in the same transaction. This catches
-- anything bound before that was true.
--
-- Only `terminal` is promoted. `resume` and `fail` are not mistakes to correct:
-- a bound `fail` event goes to the router AND to dispatch, so the failure is
-- still recorded and the retry workflow still runs. Rewriting its handling to
-- `graph` would take the recording away.
UPDATE authoring.event_catalog c
   SET handling = 'graph', updated_at = now()
 WHERE c.handling = 'terminal'
   AND EXISTS (SELECT 1 FROM authoring.event_bindings b
                WHERE b.event_type = c.event_type AND b.status = 'active');


DO $$
DECLARE
  misaligned int;
  routable   int;
BEGIN
  SELECT count(*) INTO misaligned
    FROM public.graph_event_bindings l
   WHERE l.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM authoring.event_bindings b WHERE b.id = l.id);

  -- Bound events the catalogue also calls `graph`. The rest still route —
  -- a binding outranks handling — so this is a description, not a shortfall.
  SELECT count(*) INTO routable
    FROM authoring.event_bindings b
    JOIN authoring.event_catalog c ON c.event_type = b.event_type
   WHERE b.status = 'active' AND c.handling = 'graph';

  IF misaligned > 0 THEN
    RAISE WARNING '% active legacy bindings have no matching authoring row. The mirror will not reach them.', misaligned;
  END IF;

  RAISE NOTICE 'active bindings: % in authoring, % in the copy. % also handled as graph.',
    (SELECT count(*) FROM authoring.event_bindings WHERE status = 'active'),
    (SELECT count(*) FROM public.graph_event_bindings WHERE status = 'active'),
    routable;
END $$;
