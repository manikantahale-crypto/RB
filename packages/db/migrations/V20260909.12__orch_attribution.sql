--
-- Step 5c: make a run say whose it was and what it ran.
--
-- Two gaps the design names, both fixable from data already present:
--
--   orch.steps has no org_id       21,839 steps are unattributable except by
--                                  joining to their run. Any tenant-scoped
--                                  query or RLS policy on steps is impossible
--                                  until the column exists.
--
--   orch.runs cannot name its      A run records graph_key and an integer
--   version                        graph_version, with nothing checking that
--                                  either exists. public.orchestration_job_pins
--                                  was invented to hold that link and keys on
--                                  boss_job_id, so it cannot even be joined to
--                                  a run.
--
-- ══════════════════════════════════════════════════════════════════════════
-- graph_version_id IS NULLABLE, AND THAT IS NOT A COMPROMISE — IT IS THE TRUTH
--
-- The design has it NOT NULL. It cannot be: 8,165 of 9,965 runs never recorded
-- a version at all, and no table in this database knows what they ran. Forcing
-- NOT NULL would mean inventing a version for four fifths of the history or
-- deleting it.
--
-- 1,800 runs do resolve, and they get the link. The rest keep a null that
-- honestly says "this ran before anything recorded which version", which is
-- more useful than a plausible guess.
--
-- Once the worker writes this column, new runs are complete and the null
-- becomes a marker for "before 2026-09-09" rather than a permanent hole.
-- ══════════════════════════════════════════════════════════════════════════
--
-- SAFE TO RE-RUN.
--

-- ═══════════════════════════════════════════ runs: an anchor and a link ══

-- Needed so steps can point at (run, org) as a pair, which is what stops a
-- step being attached to a run belonging to somebody else.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_id_org_key') THEN
    ALTER TABLE orch.runs ADD CONSTRAINT runs_id_org_key UNIQUE (id, organization_id);
  END IF;
END $$;

ALTER TABLE orch.runs ADD COLUMN IF NOT EXISTS graph_version_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_graph_version_fk') THEN
    ALTER TABLE orch.runs
      ADD CONSTRAINT runs_graph_version_fk
      FOREIGN KEY (graph_version_id) REFERENCES authoring.graph_versions (id);
  END IF;

  -- The 29 runs that named a nonexistent organisation were fixed in
  -- V20260909.02, so this can finally be enforced.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_org_fk') THEN
    ALTER TABLE orch.runs
      ADD CONSTRAINT runs_org_fk
      FOREIGN KEY (organization_id) REFERENCES platform.organizations (id);
  END IF;
END $$;

-- Resolve through the graph identity, which is the only path that exists:
-- run.graph_key -> authoring.graphs -> graph_versions.version.
UPDATE orch.runs r
   SET graph_version_id = v.id
  FROM authoring.graphs g
  JOIN authoring.graph_versions v ON v.graph_id = g.id
 WHERE r.graph_version_id IS NULL
   AND r.graph_key = g.graph_key
   AND r.graph_version = v.version;


-- ══════════════════════════════════════════════ steps: whose step is this ══
ALTER TABLE orch.steps ADD COLUMN IF NOT EXISTS org_id  uuid;
-- Retries were invisible: a step that ran three times overwrote itself twice.
-- Existing rows are all attempt 1 because nothing recorded otherwise.
ALTER TABLE orch.steps ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1;

UPDATE orch.steps s
   SET org_id = r.organization_id
  FROM orch.runs r
 WHERE s.org_id IS NULL AND s.run_id = r.id;

DO $$
DECLARE missing int;
BEGIN
  SELECT count(*) INTO missing FROM orch.steps WHERE org_id IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION '% steps have no run to inherit an organisation from', missing;
  END IF;

  ALTER TABLE orch.steps ALTER COLUMN org_id SET NOT NULL;

  -- A step now belongs to a run AND an organisation, and the two must agree.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'steps_run_org_fk') THEN
    ALTER TABLE orch.steps
      ADD CONSTRAINT steps_run_org_fk
      FOREIGN KEY (run_id, org_id) REFERENCES orch.runs (id, organization_id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS steps_org_idx ON orch.steps (org_id);
CREATE INDEX IF NOT EXISTS runs_graph_version_idx ON orch.runs (graph_version_id);


-- ══════════════════════════════════════════════════════════════ report ══
DO $$
DECLARE linked int; total int; no_version int;
BEGIN
  SELECT count(*), count(graph_version_id), count(*) FILTER (WHERE graph_version IS NULL)
    INTO total, linked, no_version FROM orch.runs;

  RAISE NOTICE 'steps  : % rows, all now attributed to an organisation',
    (SELECT count(*) FROM orch.steps);
  RAISE NOTICE 'runs   : % of % linked to the version they ran', linked, total;
  RAISE WARNING '% runs never recorded a version and cannot be linked. Nothing in this', no_version;
  RAISE WARNING '   database knows what they ran; the column stays null rather than guessing.';
END $$;
