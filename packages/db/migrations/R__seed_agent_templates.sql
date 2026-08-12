-- R__seed_agent_templates — Stage 1 product templates (design §5A)
-- =============================================================================
-- Templates are data: nodes, wiring, policyExt key, conditionalOn.
-- Generator loads the active row for agent_key; Zod schemas for policyExt live
-- in @tekisho/authoring (named by template.policyExt).
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
      { "id": "parse",     "impl": "parse_jd" },
      { "id": "normalize", "impl": "normalize_skills" },
      { "id": "embed",     "impl": "generate_embedding" },
      { "id": "search",    "impl": "search_bench_hybrid" },
      { "id": "dedupe",    "impl": "deduplicate_candidates" },
      { "id": "match",     "impl": "calculate_match_score", "configFrom": ["matchThreshold", "rerank"] },
      { "id": "explain",   "impl": "generate_match_explanation" },
      { "id": "persist",   "impl": "persist_match_results" }
    ],
    "wiring": [
      ["__start__", "parse"],
      ["parse", "normalize"],
      ["normalize", "embed"],
      ["embed", "search"],
      ["search", "dedupe"],
      ["dedupe", "match"],
      ["match", "explain"],
      ["explain", "persist"],
      ["persist", "__end__"]
    ],
    "conditionalOn": {
      "hardFilters": "insert filter node before match when non-empty"
    }
  }'::jsonb,
  true
),

-- Intake — raw arrival → entities (maps to intake-agent)
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
      { "id": "extract", "impl": "extract_document_text" },
      { "id": "parse",   "impl": "parse_jd" },
      { "id": "resume",  "impl": "parse_resume" },
      { "id": "record",  "impl": "record_activity" }
    ],
    "wiring": [
      ["__start__", "extract"],
      ["extract", "parse"],
      ["parse", "record"],
      ["record", "__end__"]
    ],
    "conditionalOn": {}
  }'::jsonb,
  true
),

-- Copilot — recruiter conversational surface
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
      { "id": "search",  "impl": "search_bench_hybrid" },
      { "id": "score",   "impl": "calculate_match_score" },
      { "id": "draft",   "impl": "draft_communication" },
      { "id": "record",  "impl": "record_activity" }
    ],
    "wiring": [
      ["__start__", "search"],
      ["search", "score"],
      ["score", "draft"],
      ["draft", "record"],
      ["record", "__end__"]
    ],
    "conditionalOn": {}
  }'::jsonb,
  true
)

ON CONFLICT (agent_key, version) DO UPDATE SET
  agent_id     = EXCLUDED.agent_id,
  display_name = EXCLUDED.display_name,
  template     = EXCLUDED.template,
  is_active    = EXCLUDED.is_active,
  updated_at   = now();
