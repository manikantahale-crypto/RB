-- R__seed_mock_product_agents — authoring placeholders (ASTRA, ORBIT, HELIX, TEMPO, PRISM, TAYLN)
-- =============================================================================
-- Runtime spine rows for upcoming product agents. Same Syntra tool contract as
-- matching-agent until dedicated nodes ship. Authoring templates live in
-- R__seed_agent_templates.sql (agent_templates ids 604–609).
-- =============================================================================

INSERT INTO agent_definitions (
  id, name, version, purpose, system_prompt_ref,
  allowed_tools, autonomy, model_config, is_active
) VALUES

('01900000-0000-7000-8000-000000000504',
 'astra',
 '1.0.0',
 'Analyze bench talent, pipeline health, and hiring signals.',
 'prompts/astra@1.0.0',
 '[
    { "name": "syntra.jd.process",     "min_version": "1.0.0" },
    { "name": "syntra.resume.process", "min_version": "1.0.0" },
    { "name": "syntra.match.process",  "min_version": "1.0.0" }
  ]'::jsonb,
 '{
    "READ":           "AUTO",
    "INTERNAL_WRITE": "AUTO",
    "DATA_SHAPING":   "AUTO",
    "CONTROL":        "AUTO",
    "EXTERNAL_COMM":  "SUGGEST"
  }'::jsonb,
 '{
    "provider":              "anthropic",
    "model":                 "claude-sonnet-5",
    "temperature":           0,
    "max_output_tokens":     8192,
    "embedding": { "provider": "voyage", "model": "voyage-3-large", "dims": 1024 },
    "cost_budget_usd_per_run": 0.50,
    "timeout_ms":            300000
  }'::jsonb,
 true),

('01900000-0000-7000-8000-000000000505',
 'orbit',
 '1.0.0',
 'Coordinate handoffs across intake, matching, and recruiter workflows.',
 'prompts/orbit@1.0.0',
 '[
    { "name": "syntra.jd.process",     "min_version": "1.0.0" },
    { "name": "syntra.resume.process", "min_version": "1.0.0" },
    { "name": "syntra.match.process",  "min_version": "1.0.0" }
  ]'::jsonb,
 '{
    "READ":           "AUTO",
    "INTERNAL_WRITE": "AUTO",
    "DATA_SHAPING":   "AUTO",
    "CONTROL":        "AUTO",
    "EXTERNAL_COMM":  "SUGGEST"
  }'::jsonb,
 '{
    "provider":              "anthropic",
    "model":                 "claude-sonnet-5",
    "temperature":           0,
    "max_output_tokens":     8192,
    "embedding": { "provider": "voyage", "model": "voyage-3-large", "dims": 1024 },
    "cost_budget_usd_per_run": 0.50,
    "timeout_ms":            300000
  }'::jsonb,
 true),

('01900000-0000-7000-8000-000000000506',
 'helix',
 '1.0.0',
 'Guide candidates through lifecycle steps from intake to placement.',
 'prompts/helix@1.0.0',
 '[
    { "name": "syntra.jd.process",     "min_version": "1.0.0" },
    { "name": "syntra.resume.process", "min_version": "1.0.0" },
    { "name": "syntra.match.process",  "min_version": "1.0.0" }
  ]'::jsonb,
 '{
    "READ":           "AUTO",
    "INTERNAL_WRITE": "AUTO",
    "DATA_SHAPING":   "AUTO",
    "CONTROL":        "AUTO",
    "EXTERNAL_COMM":  "SUGGEST"
  }'::jsonb,
 '{
    "provider":              "anthropic",
    "model":                 "claude-sonnet-5",
    "temperature":           0,
    "max_output_tokens":     8192,
    "embedding": { "provider": "voyage", "model": "voyage-3-large", "dims": 1024 },
    "cost_budget_usd_per_run": 0.50,
    "timeout_ms":            300000
  }'::jsonb,
 true),

('01900000-0000-7000-8000-000000000507',
 'tempo',
 '1.0.0',
 'Schedule interviews, reminders, and timed follow-up actions.',
 'prompts/tempo@1.0.0',
 '[
    { "name": "syntra.jd.process",     "min_version": "1.0.0" },
    { "name": "syntra.resume.process", "min_version": "1.0.0" },
    { "name": "syntra.match.process",  "min_version": "1.0.0" }
  ]'::jsonb,
 '{
    "READ":           "AUTO",
    "INTERNAL_WRITE": "AUTO",
    "DATA_SHAPING":   "AUTO",
    "CONTROL":        "AUTO",
    "EXTERNAL_COMM":  "SUGGEST"
  }'::jsonb,
 '{
    "provider":              "anthropic",
    "model":                 "claude-sonnet-5",
    "temperature":           0,
    "max_output_tokens":     8192,
    "embedding": { "provider": "voyage", "model": "voyage-3-large", "dims": 1024 },
    "cost_budget_usd_per_run": 0.50,
    "timeout_ms":            300000
  }'::jsonb,
 true),

('01900000-0000-7000-8000-000000000508',
 'prism',
 '1.0.0',
 'Summarize match quality, recruiter activity, and bench performance.',
 'prompts/prism@1.0.0',
 '[
    { "name": "syntra.jd.process",     "min_version": "1.0.0" },
    { "name": "syntra.resume.process", "min_version": "1.0.0" },
    { "name": "syntra.match.process",  "min_version": "1.0.0" }
  ]'::jsonb,
 '{
    "READ":           "AUTO",
    "INTERNAL_WRITE": "AUTO",
    "DATA_SHAPING":   "AUTO",
    "CONTROL":        "AUTO",
    "EXTERNAL_COMM":  "SUGGEST"
  }'::jsonb,
 '{
    "provider":              "anthropic",
    "model":                 "claude-sonnet-5",
    "temperature":           0,
    "max_output_tokens":     8192,
    "embedding": { "provider": "voyage", "model": "voyage-3-large", "dims": 1024 },
    "cost_budget_usd_per_run": 0.50,
    "timeout_ms":            300000
  }'::jsonb,
 true),

('01900000-0000-7000-8000-000000000509',
 'tayln',
 '1.0.0',
 'Draft tailored outreach and messaging for candidates and clients.',
 'prompts/tayln@1.0.0',
 '[
    { "name": "syntra.jd.process",     "min_version": "1.0.0" },
    { "name": "syntra.resume.process", "min_version": "1.0.0" },
    { "name": "syntra.match.process",  "min_version": "1.0.0" }
  ]'::jsonb,
 '{
    "READ":           "AUTO",
    "INTERNAL_WRITE": "AUTO",
    "DATA_SHAPING":   "AUTO",
    "CONTROL":        "AUTO",
    "EXTERNAL_COMM":  "SUGGEST"
  }'::jsonb,
 '{
    "provider":              "anthropic",
    "model":                 "claude-sonnet-5",
    "temperature":           0,
    "max_output_tokens":     8192,
    "embedding": { "provider": "voyage", "model": "voyage-3-large", "dims": 1024 },
    "cost_budget_usd_per_run": 0.50,
    "timeout_ms":            300000
  }'::jsonb,
 true)

ON CONFLICT (name, version) DO UPDATE
  SET purpose           = EXCLUDED.purpose,
      system_prompt_ref = EXCLUDED.system_prompt_ref
  WHERE agent_definitions.purpose           IS DISTINCT FROM EXCLUDED.purpose
     OR agent_definitions.system_prompt_ref IS DISTINCT FROM EXCLUDED.system_prompt_ref;
