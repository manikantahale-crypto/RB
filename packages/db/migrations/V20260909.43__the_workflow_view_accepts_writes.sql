--
-- public.graph_definitions accepts writes again.
--
-- V20260909.40 made it a view so the old name kept reading. A view over a
-- UNION cannot be auto-updatable, so writes to it started failing -- which was
-- fine for this repository, where all fourteen writers had moved, and NOT fine
-- for anybody else still on that name. Other people are still using these
-- tables, and a name that reads but will not write is a worse thing to hand
-- them than either a working name or an absent one.
--
-- INSTEAD OF triggers give the view back its three verbs. A row written here
-- is decomposed into the tables that actually hold it, so the workflow it
-- describes really does run -- which a write to the old TABLE would no longer
-- have achieved, since the compiler stopped reading it.
--
-- HOW A ROW IS ROUTED
--
--   version 0, or an id ending '@draft'  -> authoring.graph_drafts
--   any other version                    -> authoring.graph_versions
--
-- and the status word is translated at the boundary:
--
--   'active'  <-> 'live'        on the air
--   'draft'   <-> 'compiled'    a numbered build, not on the air
--   'retired' <-> 'retired'
--
-- ONE THING DOES NOT ROUND-TRIP, AND IT IS WORTH SAYING
--
-- `id`. The old table's id was text somebody assembled, like
-- `graph_syntra_jd_workflow_v7_global`; a version's id here is a uuid. So an
-- INSERT followed by an UPDATE ... WHERE id = <that text> will not match.
--
-- Every path that did this already carries a fallback to
-- (graph_key, version) for exactly the case where the id missed, which is why
-- this is a caveat rather than a break. Anything looking up by graph_key and
-- version -- which is everything else -- is unaffected.
--
-- SAFE TO RE-RUN.
--

CREATE OR REPLACE FUNCTION app.graph_definitions_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_graph_id  uuid;
  v_is_draft  boolean;
  v_status    text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT g.id INTO v_graph_id
      FROM authoring.graphs g
     WHERE g.graph_key = OLD.graph_key
       AND coalesce(g.org_id::text, '~global~') = coalesce(OLD.org_id, '~global~');
    IF v_graph_id IS NULL THEN
      RETURN OLD;
    END IF;

    IF coalesce(OLD.version, 0) = 0 THEN
      DELETE FROM authoring.graph_drafts WHERE graph_id = v_graph_id;
    ELSE
      DELETE FROM authoring.graph_versions
       WHERE graph_id = v_graph_id AND version = OLD.version;
    END IF;
    RETURN OLD;
  END IF;

  -- A draft has no version of its own. The old table spent a number on every
  -- editing session; version 0 is the reserved working-copy slot that replaced
  -- that, and an id ending '@draft' is how this view renders it on the way out.
  v_is_draft := coalesce(NEW.version, 0) = 0 OR NEW.id LIKE '%@draft';

  v_status := CASE NEW.status
                WHEN 'active'  THEN 'live'
                WHEN 'draft'   THEN 'compiled'
                ELSE 'retired'
              END;

  INSERT INTO authoring.graphs
    (org_id, graph_key, application, title, status, created_by_label)
  VALUES (
    NEW.org_id::uuid, NEW.graph_key,
    (SELECT a.key FROM platform.applications a
      WHERE a.key = split_part(NEW.graph_key, '.', 1)),
    NEW.graph_key,
    CASE WHEN NEW.status = 'active' THEN 'active' ELSE 'draft' END,
    NEW.created_by)
  ON CONFLICT (coalesce(org_id::text, '~global~'), graph_key)
    DO UPDATE SET updated_at = now()
  RETURNING id INTO v_graph_id;

  IF v_is_draft THEN
    INSERT INTO authoring.graph_drafts
      (graph_id, definition, checksum, updated_at)
    VALUES (v_graph_id, NEW.definition, NEW.checksum, now())
    ON CONFLICT (graph_id) DO UPDATE SET
      definition = EXCLUDED.definition,
      checksum   = EXCLUDED.checksum,
      updated_at = now();
    RETURN NEW;
  END IF;

  -- One live version per workflow is an index, not a convention, so whatever
  -- is live steps down before this one steps up. Same transaction, or the
  -- second write is simply refused.
  IF v_status = 'live' THEN
    UPDATE authoring.graph_versions
       SET status = 'retired'
     WHERE graph_id = v_graph_id
       AND status = 'live'
       AND version <> NEW.version;
  END IF;

  INSERT INTO authoring.graph_versions
    (graph_id, org_id, version, definition, checksum, status,
     compiled_by_label, compiled_at)
  VALUES (
    v_graph_id, NEW.org_id::uuid, NEW.version, NEW.definition, NEW.checksum,
    v_status, NEW.created_by, coalesce(NEW.created_at, now()))
  ON CONFLICT (graph_id, version) DO UPDATE SET
    definition = EXCLUDED.definition,
    checksum   = EXCLUDED.checksum,
    status     = EXCLUDED.status;

  IF v_status = 'live' THEN
    UPDATE authoring.graphs SET status = 'active', updated_at = now()
     WHERE id = v_graph_id AND status <> 'active';
  END IF;

  RETURN NEW;
END $$;


CREATE OR REPLACE TRIGGER graph_definitions_instead_of_insert
  INSTEAD OF INSERT ON public.graph_definitions
  FOR EACH ROW EXECUTE FUNCTION app.graph_definitions_write();

CREATE OR REPLACE TRIGGER graph_definitions_instead_of_update
  INSTEAD OF UPDATE ON public.graph_definitions
  FOR EACH ROW EXECUTE FUNCTION app.graph_definitions_write();

CREATE OR REPLACE TRIGGER graph_definitions_instead_of_delete
  INSTEAD OF DELETE ON public.graph_definitions
  FOR EACH ROW EXECUTE FUNCTION app.graph_definitions_write();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.graph_definitions TO postgres;


DO $$
BEGIN
  RAISE NOTICE 'public.graph_definitions reads and writes again (% rows).',
    (SELECT count(*) FROM public.graph_definitions);
END $$;
