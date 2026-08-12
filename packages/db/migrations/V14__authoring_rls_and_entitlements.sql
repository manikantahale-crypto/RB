-- V14 — Authoring RLS + per-agent entitlements (design A3 / Appendix A.7)
-- agent_policies / agent_versions: tenant rows + global defaults (org_id IS NULL)
-- admin_agent_entitlements: which admin may Edit/Generate which agent
-- agent_templates: platform reference (read-all; no FORCE)
--
-- NOTE: predicates use current_setting('app.org_id') inline rather than
-- app.current_org_id() so CREATE POLICY works when the migrator role lacks
-- USAGE on schema app (observed on managed Supabase).

-- -----------------------------------------------------------------------------
-- Entitlements
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_agent_entitlements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   text NOT NULL,
  agent_id   uuid NOT NULL REFERENCES agent_definitions (id),
  org_id     uuid REFERENCES organizations (id), -- NULL = global / all-orgs grant
  can_edit   boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_agent_entitlements_scope
  ON admin_agent_entitlements (admin_id, agent_id, COALESCE(org_id::text, '~global~'));

CREATE INDEX IF NOT EXISTS admin_agent_entitlements_admin
  ON admin_agent_entitlements (admin_id);

GRANT SELECT ON admin_agent_entitlements TO syntra_app, syntra_relay;

ALTER TABLE admin_agent_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_agent_entitlements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_agent_entitlements_read ON admin_agent_entitlements;
CREATE POLICY admin_agent_entitlements_read ON admin_agent_entitlements
  FOR SELECT TO syntra_app, syntra_relay
  USING (true);

DROP POLICY IF EXISTS admin_agent_entitlements_migrator ON admin_agent_entitlements;
CREATE POLICY admin_agent_entitlements_migrator ON admin_agent_entitlements
  FOR ALL TO syntra_migrator
  USING (true)
  WITH CHECK (true);

-- Seed local admin with edit on seeded product-agents (Stage 1 bootstrap).
INSERT INTO admin_agent_entitlements (admin_id, agent_id, org_id, can_edit)
SELECT 'admin-local', d.id, NULL, true
  FROM agent_definitions d
 WHERE d.name IN ('matching-agent', 'intake-agent', 'copilot')
  AND NOT EXISTS (
    SELECT 1 FROM admin_agent_entitlements e
     WHERE e.admin_id = 'admin-local' AND e.agent_id = d.id AND e.org_id IS NULL
  );

-- -----------------------------------------------------------------------------
-- agent_policies — mirror matching_policies (global readable; writes scoped)
-- -----------------------------------------------------------------------------
ALTER TABLE agent_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_policies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_policies_read ON agent_policies;
CREATE POLICY agent_policies_read ON agent_policies
  FOR SELECT TO syntra_app, syntra_relay
  USING (
    org_id IS NULL
    OR org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  );

DROP POLICY IF EXISTS agent_policies_insert ON agent_policies;
CREATE POLICY agent_policies_insert ON agent_policies
  FOR INSERT TO syntra_app, syntra_relay
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    )
    OR (
      org_id IS NULL
      AND NULLIF(current_setting('app.org_id', true), '')::uuid IS NULL
    )
  );

DROP POLICY IF EXISTS agent_policies_update ON agent_policies;
CREATE POLICY agent_policies_update ON agent_policies
  FOR UPDATE TO syntra_app, syntra_relay
  USING (
    (
      org_id IS NOT NULL
      AND org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    )
    OR (
      org_id IS NULL
      AND NULLIF(current_setting('app.org_id', true), '')::uuid IS NULL
    )
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    )
    OR (
      org_id IS NULL
      AND NULLIF(current_setting('app.org_id', true), '')::uuid IS NULL
    )
  );

DROP POLICY IF EXISTS agent_policies_delete ON agent_policies;
CREATE POLICY agent_policies_delete ON agent_policies
  FOR DELETE TO syntra_app, syntra_relay
  USING (
    (
      org_id IS NOT NULL
      AND org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    )
    OR (
      org_id IS NULL
      AND NULLIF(current_setting('app.org_id', true), '')::uuid IS NULL
    )
  );

DROP POLICY IF EXISTS agent_policies_migrator ON agent_policies;
CREATE POLICY agent_policies_migrator ON agent_policies
  FOR ALL TO syntra_migrator
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- agent_versions
-- -----------------------------------------------------------------------------
ALTER TABLE agent_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_versions_read ON agent_versions;
CREATE POLICY agent_versions_read ON agent_versions
  FOR SELECT TO syntra_app, syntra_relay
  USING (
    org_id IS NULL
    OR org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  );

DROP POLICY IF EXISTS agent_versions_insert ON agent_versions;
CREATE POLICY agent_versions_insert ON agent_versions
  FOR INSERT TO syntra_app, syntra_relay
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    )
    OR (
      org_id IS NULL
      AND NULLIF(current_setting('app.org_id', true), '')::uuid IS NULL
    )
  );

DROP POLICY IF EXISTS agent_versions_update ON agent_versions;
CREATE POLICY agent_versions_update ON agent_versions
  FOR UPDATE TO syntra_app, syntra_relay
  USING (
    (
      org_id IS NOT NULL
      AND org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    )
    OR (
      org_id IS NULL
      AND NULLIF(current_setting('app.org_id', true), '')::uuid IS NULL
    )
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    )
    OR (
      org_id IS NULL
      AND NULLIF(current_setting('app.org_id', true), '')::uuid IS NULL
    )
  );

DROP POLICY IF EXISTS agent_versions_delete ON agent_versions;
CREATE POLICY agent_versions_delete ON agent_versions
  FOR DELETE TO syntra_app, syntra_relay
  USING (
    (
      org_id IS NOT NULL
      AND org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    )
    OR (
      org_id IS NULL
      AND NULLIF(current_setting('app.org_id', true), '')::uuid IS NULL
    )
  );

DROP POLICY IF EXISTS agent_versions_migrator ON agent_versions;
CREATE POLICY agent_versions_migrator ON agent_versions
  FOR ALL TO syntra_migrator
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- agent_templates — platform reference (no tenant column)
-- -----------------------------------------------------------------------------
ALTER TABLE agent_templates ENABLE ROW LEVEL SECURITY;
-- No FORCE: migrator/seeds must write without an owner bypass work-around.

DROP POLICY IF EXISTS agent_templates_read ON agent_templates;
CREATE POLICY agent_templates_read ON agent_templates
  FOR SELECT TO syntra_app, syntra_relay
  USING (true);

DROP POLICY IF EXISTS agent_templates_migrator ON agent_templates;
CREATE POLICY agent_templates_migrator ON agent_templates
  FOR ALL TO syntra_migrator
  USING (true)
  WITH CHECK (true);
