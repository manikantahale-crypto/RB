-- R__seed_agent_templates — Stage 1 product templates (design §5A)
-- =============================================================================
-- Templates are data: nodes, wiring, policyExt key, conditionalOn.
-- Generator loads the active row for agent_key; Zod schemas for policyExt live
-- in @tekisho/authoring (named by template.policyExt).
--
-- Node impl keys MUST match runtime nodeRegistry
-- (packages/orchestrator/src/nodes/registry.ts). No authoring-only tools.
-- =============================================================================

INSERT INTO agent_templates (
  id, agent_key, agent_id, display_name, version, template, is_active
) VALUES

-- SYNTRA — AI Candidate Matching (maps to matching-agent)
(
  '01900000-0000-7000-8000-000000000601',
  'syntra',
  '01900000-0000-7000-8000-000000000501',
  'SYNTRA — AI Candidate Matching',
  1,
  '{
    "agentKey": "syntra",
    "displayName": "SYNTRA — AI Candidate Matching",
    "policyExt": "SyntraPolicyExt",
    "nodes": [
      { "id": "jd",     "impl": "syntra.jd.process" },
      { "id": "resume", "impl": "syntra.resume.process" },
      { "id": "match",  "impl": "syntra.match.process", "configFrom": ["matchThreshold", "rerank"] }
    ],
    "wiring": [
      ["__start__", "jd"],
      ["jd", "resume"],
      ["resume", "match"],
      ["match", "__end__"]
    ],
    "conditionalOn": {
      "hardFilters": "stamp hardFilters onto match node config when non-empty"
    }
  }'::jsonb,
  true
),

-- Intake — raw arrival → entities (maps to intake-agent)
-- Reuses Syntra runtime nodes until dedicated intake nodes exist.
(
  '01900000-0000-7000-8000-000000000602',
  'intake',
  '01900000-0000-7000-8000-000000000502',
  'Intake — Channel Arrival Interpreter',
  1,
  '{
    "agentKey": "intake",
    "displayName": "Intake — Channel Arrival Interpreter",
    "policyExt": "IntakePolicyExt",
    "nodes": [
      { "id": "jd",     "impl": "syntra.jd.process" },
      { "id": "resume", "impl": "syntra.resume.process" }
    ],
    "wiring": [
      ["__start__", "jd"],
      ["jd", "resume"],
      ["resume", "__end__"]
    ],
    "conditionalOn": {}
  }'::jsonb,
  true
),

-- Copilot — recruiter conversational surface
-- Reuses Syntra match node until dedicated copilot nodes exist.
(
  '01900000-0000-7000-8000-000000000603',
  'copilot',
  '01900000-0000-7000-8000-000000000503',
  'Copilot — Recruiter Assistant',
  1,
  '{
    "agentKey": "copilot",
    "displayName": "Copilot — Recruiter Assistant",
    "policyExt": "CopilotPolicyExt",
    "nodes": [
      { "id": "match", "impl": "syntra.match.process" }
    ],
    "wiring": [
      ["__start__", "match"],
      ["match", "__end__"]
    ],
    "conditionalOn": {}
  }'::jsonb,
  true
),

-- Mock product agents (authoring placeholders until dedicated runtime nodes exist)
(
  '01900000-0000-7000-8000-000000000604',
  'astra',
  '01900000-0000-7000-8000-000000000504',
  'ASTRA — Workforce Analytics',
  1,
  '{
    "agentKey": "astra",
    "displayName": "ASTRA — Workforce Analytics",
    "policyExt": "SyntraPolicyExt",
    "nodes": [
      { "id": "jd",     "impl": "syntra.jd.process" },
      { "id": "resume", "impl": "syntra.resume.process" },
      { "id": "match",  "impl": "syntra.match.process", "configFrom": ["matchThreshold", "rerank"] }
    ],
    "wiring": [
      ["__start__", "jd"],
      ["jd", "resume"],
      ["resume", "match"],
      ["match", "__end__"]
    ],
    "conditionalOn": {
      "hardFilters": "stamp hardFilters onto match node config when non-empty"
    }
  }'::jsonb,
  true
),
(
  '01900000-0000-7000-8000-000000000605',
  'orbit',
  '01900000-0000-7000-8000-000000000505',
  'ORBIT — Pipeline Orchestration',
  1,
  '{
    "agentKey": "orbit",
    "displayName": "ORBIT — Pipeline Orchestration",
    "policyExt": "SyntraPolicyExt",
    "nodes": [
      { "id": "jd",     "impl": "syntra.jd.process" },
      { "id": "resume", "impl": "syntra.resume.process" },
      { "id": "match",  "impl": "syntra.match.process", "configFrom": ["matchThreshold", "rerank"] }
    ],
    "wiring": [
      ["__start__", "jd"],
      ["jd", "resume"],
      ["resume", "match"],
      ["match", "__end__"]
    ],
    "conditionalOn": {
      "hardFilters": "stamp hardFilters onto match node config when non-empty"
    }
  }'::jsonb,
  true
),
(
  '01900000-0000-7000-8000-000000000606',
  'helix',
  '01900000-0000-7000-8000-000000000506',
  'HELIX — Candidate Journey',
  1,
  '{
    "agentKey": "helix",
    "displayName": "HELIX — Candidate Journey",
    "policyExt": "SyntraPolicyExt",
    "nodes": [
      { "id": "jd",     "impl": "syntra.jd.process" },
      { "id": "resume", "impl": "syntra.resume.process" },
      { "id": "match",  "impl": "syntra.match.process", "configFrom": ["matchThreshold", "rerank"] }
    ],
    "wiring": [
      ["__start__", "jd"],
      ["jd", "resume"],
      ["resume", "match"],
      ["match", "__end__"]
    ],
    "conditionalOn": {
      "hardFilters": "stamp hardFilters onto match node config when non-empty"
    }
  }'::jsonb,
  true
),
(
  '01900000-0000-7000-8000-000000000607',
  'tempo',
  '01900000-0000-7000-8000-000000000507',
  'TEMPO — Scheduling & Follow-ups',
  1,
  '{
    "agentKey": "tempo",
    "displayName": "TEMPO — Scheduling & Follow-ups",
    "policyExt": "SyntraPolicyExt",
    "nodes": [
      { "id": "jd",     "impl": "syntra.jd.process" },
      { "id": "resume", "impl": "syntra.resume.process" },
      { "id": "match",  "impl": "syntra.match.process", "configFrom": ["matchThreshold", "rerank"] }
    ],
    "wiring": [
      ["__start__", "jd"],
      ["jd", "resume"],
      ["resume", "match"],
      ["match", "__end__"]
    ],
    "conditionalOn": {
      "hardFilters": "stamp hardFilters onto match node config when non-empty"
    }
  }'::jsonb,
  true
),
(
  '01900000-0000-7000-8000-000000000608',
  'prism',
  '01900000-0000-7000-8000-000000000508',
  'PRISM — Insights & Reporting',
  1,
  '{
    "agentKey": "prism",
    "displayName": "PRISM — Insights & Reporting",
    "policyExt": "SyntraPolicyExt",
    "nodes": [
      { "id": "jd",     "impl": "syntra.jd.process" },
      { "id": "resume", "impl": "syntra.resume.process" },
      { "id": "match",  "impl": "syntra.match.process", "configFrom": ["matchThreshold", "rerank"] }
    ],
    "wiring": [
      ["__start__", "jd"],
      ["jd", "resume"],
      ["resume", "match"],
      ["match", "__end__"]
    ],
    "conditionalOn": {
      "hardFilters": "stamp hardFilters onto match node config when non-empty"
    }
  }'::jsonb,
  true
),
(
  '01900000-0000-7000-8000-000000000609',
  'tayln',
  '01900000-0000-7000-8000-000000000509',
  'TAYLN — Personalized Outreach',
  1,
  '{
    "agentKey": "tayln",
    "displayName": "TAYLN — Personalized Outreach",
    "policyExt": "SyntraPolicyExt",
    "nodes": [
      { "id": "jd",     "impl": "syntra.jd.process" },
      { "id": "resume", "impl": "syntra.resume.process" },
      { "id": "match",  "impl": "syntra.match.process", "configFrom": ["matchThreshold", "rerank"] }
    ],
    "wiring": [
      ["__start__", "jd"],
      ["jd", "resume"],
      ["resume", "match"],
      ["match", "__end__"]
    ],
    "conditionalOn": {
      "hardFilters": "stamp hardFilters onto match node config when non-empty"
    }
  }'::jsonb,
  true
)

ON CONFLICT (agent_key, version) DO UPDATE SET
  agent_id     = EXCLUDED.agent_id,
  display_name = EXCLUDED.display_name,
  template     = EXCLUDED.template,
  is_active    = EXCLUDED.is_active,
  updated_at   = now();
