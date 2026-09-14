--
-- 424 of 433 agents and 283 of 326 workflows are test fixtures.
--
-- They came across in the copy because they were in the old project, and they
-- are named for what they are: custom.g013-golden-*, custom.ab03-runtime-*,
-- custom.phase2-approve-*, custom.trail-syntra, custom.sonuz. None was authored
-- by a person intending to keep it.
--
-- THIS IS NOT TIDINESS, AND THAT IS WHY IT IS WORTH A MIGRATION.
--
-- Every question of the form "is this one real?" costs somebody an
-- investigation. The go-live queue listed ten items waiting for approval and
-- all ten were custom.phase2-approve-* — a screen that governs production,
-- showing nothing anybody should act on. The registry opens on a wall of
-- custom.g013-golden-*. A new person cannot tell which names matter, and
-- neither could this session, repeatedly.
--
-- WHAT IS PROTECTED, AND HOW
--
-- Three guards, all in the WHERE clauses rather than in a comment:
--
--   1. the name must start with 'custom.'   — nothing else is touched
--   2. it must have NEVER RUN               — orch.runs is the evidence
--   3. it must have no active binding       — nothing live is removed
--
-- Guard 2 keeps custom.ab03-runtime-9e39460e.5a55d17c.authored, which ran five
-- times. It is a fixture too, but it has history, and history is the thing
-- that cannot be recreated. Guard 3 is belt and braces: none of these is bound
-- today, and if one ever is, that is a reason to stop rather than proceed.
--
-- The nine real agents are kept: astra, copilot, helix, intake-agent,
-- matching-agent, orbit, prism, tayln, tempo.
--
-- WHAT IS NOT TOUCHED
--
-- orch.event_outbox. It holds 54 rows published by smoke-e2e, fix-500-proof
-- and friends, which are equally fixtures — but the outbox is an audit log,
-- rows in it are referenced by runs, and deleting history to make a count look
-- nicer is the wrong trade. They stay.
--
-- DELETION ORDER follows the foreign keys: only graph_drafts cascades, so
-- plan_steps, event_bindings and graph_versions are cleared explicitly first.
-- Nothing points at builder.agent_definitions at all, so its four child tables
-- are cleared by agent id.
--
-- SAFE TO RE-RUN.
--

DO $$
DECLARE
  doomed_graphs uuid[];
  doomed_agents uuid[];
  n_graphs int;
  n_agents int;
BEGIN
  -- ── workflows ──────────────────────────────────────────────────────────
  SELECT coalesce(array_agg(g.id), '{}')
    INTO doomed_graphs
    FROM authoring.graphs g
   WHERE g.graph_key LIKE 'custom.%'
     AND NOT EXISTS (SELECT 1 FROM orch.runs r WHERE r.graph_key = g.graph_key)
     AND NOT EXISTS (SELECT 1 FROM authoring.event_bindings b
                      WHERE b.graph_id = g.id AND b.status = 'active');

  n_graphs := coalesce(array_length(doomed_graphs, 1), 0);

  IF n_graphs > 0 THEN
    DELETE FROM authoring.plan_steps     WHERE graph_id = ANY(doomed_graphs);
    DELETE FROM authoring.event_bindings WHERE graph_id = ANY(doomed_graphs);
    DELETE FROM authoring.graph_versions WHERE graph_id = ANY(doomed_graphs);
    DELETE FROM authoring.graphs         WHERE id       = ANY(doomed_graphs);
  END IF;

  -- ── agents ─────────────────────────────────────────────────────────────
  SELECT coalesce(array_agg(d.id), '{}')
    INTO doomed_agents
    FROM builder.agent_definitions d
   WHERE d.name LIKE 'custom.%';

  n_agents := coalesce(array_length(doomed_agents, 1), 0);

  IF n_agents > 0 THEN
    DELETE FROM builder.admin_agent_entitlements WHERE agent_id = ANY(doomed_agents);
    DELETE FROM builder.agent_templates          WHERE agent_id = ANY(doomed_agents);
    DELETE FROM builder.agent_versions           WHERE agent_id = ANY(doomed_agents);
    DELETE FROM builder.agent_policies           WHERE agent_id = ANY(doomed_agents);
    DELETE FROM builder.agent_definitions        WHERE id       = ANY(doomed_agents);
  END IF;

  RAISE NOTICE 'removed % fixture workflow(s) and % fixture agent(s)', n_graphs, n_agents;
END $$;


--
-- What is left should be the platform, and nothing should have been taken that
-- anybody can point at.
--
DO $$
DECLARE
  kept_graphs int;
  kept_agents int;
  live_now int;
  lost_history int;
BEGIN
  SELECT count(DISTINCT graph_key) INTO kept_graphs FROM authoring.graphs;
  SELECT count(*) INTO kept_agents FROM builder.agent_definitions;
  SELECT count(*) INTO live_now
    FROM authoring.graph_versions WHERE status = 'live';

  -- A run whose workflow no longer exists would mean guard 2 failed.
  SELECT count(DISTINCT r.graph_key) INTO lost_history
    FROM orch.runs r
   WHERE r.graph_key LIKE 'custom.%'
     AND NOT EXISTS (SELECT 1 FROM authoring.graphs g
                      WHERE g.graph_key = r.graph_key);

  IF lost_history > 0 THEN
    RAISE EXCEPTION
      '% workflow(s) with recorded runs were deleted. Guard 2 did not hold.',
      lost_history;
  END IF;

  RAISE NOTICE '% workflows and % agents remain; % versions live',
    kept_graphs, kept_agents, live_now;
END $$;
