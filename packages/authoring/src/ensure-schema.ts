import type { Pool } from "pg";
import { AgentTemplateSchema } from "./agent-template.js";
import { TEMPLATE_SEED_CATALOG } from "./template-catalog.js";
import { defaultDraftPolicyForTemplate } from "./product-agent-defaults.js";

/**
 * Create authoring tables if missing (same idea as GraphCompiler.ensureSchemaAndSeed).
 * No FKs here — migrator may lack REFERENCES on agent_definitions / organizations;
 * Flyway V12–V14 own the full schema with FKs when applied.
 */
export async function ensureAuthoringSchema(pool: Pool): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_policies (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id        uuid,
        agent_id      uuid NOT NULL,
        policy        jsonb NOT NULL,
        status        text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'generated', 'pending_go_live', 'compiled', 'published', 'active')),
        version       int  NOT NULL,
        checksum      text,
        created_by    text NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS agent_policies_key_version_scope
        ON agent_policies (agent_id, version, COALESCE(org_id::text, '~global~'));
      CREATE UNIQUE INDEX IF NOT EXISTS agent_policies_one_active
        ON agent_policies (agent_id, COALESCE(org_id::text, '~global~'))
        WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS agent_policies_agent_lookup
        ON agent_policies (agent_id, status);
    `);

    // Widen status CHECK if tables already existed without pending_go_live (local ensure).
    await widenAuthoringStatusChecks(pool);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_versions (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id        uuid NOT NULL,
        org_id          uuid,
        policy_id       uuid NOT NULL,
        version         int  NOT NULL,
        artifact_ref    text NOT NULL,
        artifact_source text NOT NULL,
        checksum        text NOT NULL,
        status          text NOT NULL
                        CHECK (status IN ('draft', 'generated', 'pending_go_live', 'compiled', 'published', 'active')),
        generated_by    text NOT NULL,
        generated_at    timestamptz NOT NULL DEFAULT now(),
        meta            jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    `);

    await pool.query(`
      ALTER TABLE agent_versions
        ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb
    `).catch(() => {
      /* ignore */
    });

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS agent_versions_key_version_scope
        ON agent_versions (agent_id, version, COALESCE(org_id::text, '~global~'));
      CREATE INDEX IF NOT EXISTS agent_versions_policy_lookup
        ON agent_versions (policy_id);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_templates (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_key     text NOT NULL,
        agent_id      uuid,
        display_name  text NOT NULL,
        version       int  NOT NULL DEFAULT 1,
        template      jsonb NOT NULL,
        is_active     boolean NOT NULL DEFAULT true,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT agent_templates_key_version_key UNIQUE (agent_key, version)
      )
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS agent_templates_one_active
        ON agent_templates (agent_key)
        WHERE is_active = true;
      CREATE INDEX IF NOT EXISTS agent_templates_agent_id_lookup
        ON agent_templates (agent_id)
        WHERE agent_id IS NOT NULL;
    `);

    // Stage 2 Compile store (runtime-owned in prod environments).
    // If Flyway runtime migrations haven't run yet, create the minimal tables
    // so the admin API compile endpoint can persist artifacts.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS graph_definitions (
        id            text PRIMARY KEY,
        org_id        text, -- NULL = global default
        graph_key     text NOT NULL,
        version       int  NOT NULL,
        definition    jsonb NOT NULL,
        checksum      text NOT NULL,
        status        text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'active', 'retired')),
        created_by    text NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        activated_at  timestamptz
      );
      CREATE UNIQUE INDEX IF NOT EXISTS graph_definitions_key_version_scope
        ON graph_definitions (graph_key, version, COALESCE(org_id, '~global~'));
      CREATE UNIQUE INDEX IF NOT EXISTS graph_definitions_one_active
        ON graph_definitions (graph_key, COALESCE(org_id, '~global~'))
        WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS graph_definitions_lookup
        ON graph_definitions (graph_key, status);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_agent_entitlements (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id   text NOT NULL,
        agent_id   uuid NOT NULL,
        org_id     uuid,
        can_edit   boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS admin_agent_entitlements_scope
        ON admin_agent_entitlements (admin_id, agent_id, COALESCE(org_id::text, '~global~'));
      CREATE INDEX IF NOT EXISTS admin_agent_entitlements_admin
        ON admin_agent_entitlements (admin_id);
    `);

    // Stage 2 Compile store (runtime-owned in prod environments).
    // We create it here best-effort so `POST /agents/:id/compile` works in local/dev
    // even when Flyway migrations haven't been applied.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS graph_versions (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id        text,
        graph_id      text NOT NULL,
        graph_key     text NOT NULL,
        version       int  NOT NULL,
        definition    jsonb NOT NULL,
        checksum      text NOT NULL,
        status        text NOT NULL DEFAULT 'compiled'
                      CHECK (status IN ('draft', 'compiled', 'published', 'active', 'retired')),
        compiled_by  text NOT NULL,
        compiled_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const role of ["syntra_app", "syntra_relay", "syntra_migrator"]) {
      try {
        await pool.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON agent_policies, agent_versions TO ${role}`,
        );
        await pool.query(`GRANT SELECT ON agent_templates TO ${role}`);
        await pool.query(
          `GRANT SELECT, INSERT ON admin_agent_entitlements TO ${role}`,
        );
        await pool.query(`GRANT INSERT ON agent_definitions TO ${role}`);
        await pool.query(
          `GRANT SELECT, INSERT, UPDATE ON graph_event_bindings TO ${role}`,
        );

        // Stage 2 Compile writes graph_definitions (runtime store).
        // The runtime also creates/owns the table in some environments, so
        // this is best-effort to keep local/dev working.
        await pool.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON graph_definitions TO ${role}`,
        );

        await pool.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON graph_versions TO ${role}`,
        );
      } catch {
        /* role may not exist in local/dev */
      }
    }

    await applyAuthoringRls(pool);
    await applyGraphStoreRls(pool);
    await seedAgentTemplates(pool);
    await seedProductAgentDefinitions(pool);
    await seedDefaultEntitlements(pool);

    console.log(
      "[authoring] agent_policies / agent_versions / agent_templates / entitlements ready",
    );
  } catch (err: any) {
    if (err?.code === "42501") {
      console.warn(
        "[authoring] ensureAuthoringSchema soft-skipped (permission denied). Apply Flyway V12–V14 if tables are missing.",
      );
      return;
    }
    throw err;
  }
}

/** Allow pending_go_live on existing DBs created before V16. */
async function widenAuthoringStatusChecks(pool: Pool): Promise<void> {
  try {
    await pool.query(
      `ALTER TABLE agent_policies DROP CONSTRAINT IF EXISTS agent_policies_status_check`,
    );
    await pool.query(`
      ALTER TABLE agent_policies
        ADD CONSTRAINT agent_policies_status_check
        CHECK (status IN (
          'draft', 'generated', 'pending_go_live', 'compiled', 'published', 'active'
        ))
    `);
  } catch {
    /* table may not exist yet / no permission */
  }
  try {
    await pool.query(
      `ALTER TABLE agent_versions DROP CONSTRAINT IF EXISTS agent_versions_status_check`,
    );
    await pool.query(`
      ALTER TABLE agent_versions
        ADD CONSTRAINT agent_versions_status_check
        CHECK (status IN (
          'draft', 'generated', 'pending_go_live', 'compiled', 'published', 'active'
        ))
    `);
  } catch {
    /* ignore */
  }
}

/** Upsert catalog templates (idempotent). */
export async function seedAgentTemplates(pool: Pool): Promise<void> {
  for (const s of TEMPLATE_SEED_CATALOG) {
    const template = AgentTemplateSchema.parse(s.template);
    const payload = [
      s.agentId,
      s.displayName,
      JSON.stringify(template),
      s.agentKey,
      s.version,
    ];

    // Match exact (agent_key, version) first.
    const updated = await pool.query(
      `UPDATE agent_templates
          SET agent_id = $1,
              display_name = $2,
              template = $3::jsonb,
              is_active = true,
              updated_at = now()
        WHERE agent_key = $4 AND version = $5`,
      payload,
    );

    if ((updated.rowCount ?? 0) > 0) continue;

    // Version bump of the same catalog id (avoids PK collision on re-seed).
    const bumped = await pool.query(
      `UPDATE agent_templates
          SET agent_id = $1,
              display_name = $2,
              template = $3::jsonb,
              version = $4,
              is_active = true,
              updated_at = now()
        WHERE id = $5`,
      [
        s.agentId,
        s.displayName,
        JSON.stringify(template),
        s.version,
        s.id,
      ],
    );

    if ((bumped.rowCount ?? 0) > 0) continue;

    await pool.query(
      `INSERT INTO agent_templates (
         id, agent_key, agent_id, display_name, version, template, is_active
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, true)`,
      [
        s.id,
        s.agentKey,
        s.agentId,
        s.displayName,
        s.version,
        JSON.stringify(template),
      ],
    );
  }

  console.log(
    `[authoring] agent_templates seeded (${TEMPLATE_SEED_CATALOG.length})`,
  );
}

const PRODUCT_AGENT_RUNTIME_TOOLS = JSON.stringify([
  { name: "syntra.jd.process", min_version: "1.0.0" },
  { name: "syntra.resume.process", min_version: "1.0.0" },
  { name: "syntra.match.process", min_version: "1.0.0" },
]);

const PRODUCT_AGENT_AUTONOMY = JSON.stringify({
  READ: "AUTO",
  INTERNAL_WRITE: "AUTO",
  DATA_SHAPING: "AUTO",
  CONTROL: "AUTO",
  EXTERNAL_COMM: "SUGGEST",
});

const PRODUCT_AGENT_MODEL = JSON.stringify({
  provider: "anthropic",
  model: "claude-sonnet-5",
  temperature: 0,
  max_output_tokens: 8192,
  embedding: { provider: "voyage", model: "voyage-3-large", dims: 1024 },
  cost_budget_usd_per_run: 0.5,
  timeout_ms: 300000,
});

const ASTRA_RUNTIME_TOOLS = JSON.stringify([
  { name: "astra.requirement.intake", min_version: "1.0.0" },
  { name: "astra.requirement.ingest", min_version: "1.0.0" },
  { name: "astra.jobboard.fetch", min_version: "1.0.0" },
  { name: "astra.requirement.quality", min_version: "1.0.0" },
  { name: "astra.requirement.normalize", min_version: "1.0.0" },
  { name: "orch.branch.decision", min_version: "1.0.0" },
  { name: "human.gate", min_version: "1.0.0" },
  { name: "astra.route.decision", min_version: "1.0.0" },
]);

/**
 * Ensure agent_definitions + draft policies exist for catalog product agents
 * (mock agents ASTRA, ORBIT, etc. are not in runtime R__seed_agent_definitions).
 */
export async function seedProductAgentDefinitions(pool: Pool): Promise<void> {
  let defs = 0;
  let policies = 0;

  for (const s of TEMPLATE_SEED_CATALOG) {
    if (!s.purpose) continue;

    const defRow = await pool.query(
      `SELECT 1 FROM agent_definitions WHERE id = $1`,
      [s.agentId],
    );
    if ((defRow.rowCount ?? 0) === 0) {
      const toolsJson =
        s.agentKey === "astra" ? ASTRA_RUNTIME_TOOLS : PRODUCT_AGENT_RUNTIME_TOOLS;
      await pool.query(
        `INSERT INTO agent_definitions (
           id, name, version, purpose, system_prompt_ref,
           allowed_tools, autonomy, model_config, is_active
         ) VALUES ($1, $2, '1.0.0', $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, true)`,
        [
          s.agentId,
          s.agentKey,
          s.purpose,
          `prompts/${s.agentKey}@1.0.0`,
          toolsJson,
          PRODUCT_AGENT_AUTONOMY,
          PRODUCT_AGENT_MODEL,
        ],
      );
      defs++;
    } else if (s.agentKey === "astra") {
      // Align existing ASTRA definition with real runtime tools (was Syntra placeholder).
      await pool.query(
        `UPDATE agent_definitions
            SET allowed_tools = $2::jsonb,
                purpose = $3,
                updated_at = now()
          WHERE id = $1`,
        [s.agentId, ASTRA_RUNTIME_TOOLS, s.purpose],
      );
    }

    const policy = defaultDraftPolicyForTemplate({
      agentId: s.agentId,
      agentKey: s.agentKey,
      displayName: s.displayName,
      policyExt: s.template.policyExt,
    });

    const polRow = await pool.query(
      `SELECT policy FROM agent_policies
        WHERE agent_id = $1 AND org_id IS NULL AND version = 1`,
      [s.agentId],
    );
    if ((polRow.rowCount ?? 0) === 0) {
      await pool.query(
        `INSERT INTO agent_policies (
           org_id, agent_id, policy, status, version, created_by
         ) VALUES (NULL, $1, $2::jsonb, 'draft', 1, 'seed')`,
        [s.agentId, JSON.stringify(policy)],
      );
      policies++;
    } else if (s.agentKey === "astra") {
      // Align draft/generated ASTRA policy tools with runtime (was Syntra placeholder).
      await pool.query(
        `UPDATE agent_policies
            SET policy = $2::jsonb,
                updated_at = now()
          WHERE agent_id = $1
            AND org_id IS NULL
            AND version = 1
            AND status IN ('draft', 'generated')`,
        [s.agentId, JSON.stringify(policy)],
      );
    }
  }

  if (defs > 0 || policies > 0) {
    console.log(
      `[authoring] product agents seeded (definitions +${defs}, draft policies +${policies})`,
    );
  }
}

/** Grant admin-local edit on catalog agents (fail-closed for everyone else). */
export async function seedDefaultEntitlements(pool: Pool): Promise<void> {
  for (const s of TEMPLATE_SEED_CATALOG) {
    const existing = await pool.query(
      `SELECT 1 FROM admin_agent_entitlements
        WHERE admin_id = 'admin-local' AND agent_id = $1 AND org_id IS NULL`,
      [s.agentId],
    );
    if ((existing.rowCount ?? 0) > 0) continue;
    await pool.query(
      `INSERT INTO admin_agent_entitlements (admin_id, agent_id, org_id, can_edit)
       VALUES ('admin-local', $1, NULL, true)`,
      [s.agentId],
    );
  }
  console.log("[authoring] admin-local entitlements seeded");
}

/**
 * Apply Stage 1 authoring RLS (idempotent). Mirrors V14 for boot without Flyway.
 * Uses current_setting(...) inline — syntra_migrator may lack USAGE on schema app,
 * which blocks CREATE POLICY that references app.current_org_id().
 */
export async function applyAuthoringRls(pool: Pool): Promise<void> {
  const org = `NULLIF(current_setting('app.org_id', true), '')::uuid`;

  try {
    await pool.query(`GRANT USAGE ON SCHEMA app TO syntra_migrator`);
  } catch {
    /* may already have it or role missing */
  }

  const statements = [
    `ALTER TABLE agent_policies ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE agent_policies FORCE ROW LEVEL SECURITY`,
    `ALTER TABLE agent_versions ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE agent_versions FORCE ROW LEVEL SECURITY`,
    `ALTER TABLE admin_agent_entitlements ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE admin_agent_entitlements FORCE ROW LEVEL SECURITY`,
    `ALTER TABLE agent_templates ENABLE ROW LEVEL SECURITY`,

    `DROP POLICY IF EXISTS agent_policies_read ON agent_policies`,
    `CREATE POLICY agent_policies_read ON agent_policies
       FOR SELECT TO syntra_app, syntra_relay
       USING (org_id IS NULL OR org_id = ${org})`,
    `DROP POLICY IF EXISTS agent_policies_insert ON agent_policies`,
    `CREATE POLICY agent_policies_insert ON agent_policies
       FOR INSERT TO syntra_app, syntra_relay
       WITH CHECK (
         (org_id IS NOT NULL AND org_id = ${org})
         OR (org_id IS NULL AND ${org} IS NULL)
       )`,
    `DROP POLICY IF EXISTS agent_policies_update ON agent_policies`,
    `CREATE POLICY agent_policies_update ON agent_policies
       FOR UPDATE TO syntra_app, syntra_relay
       USING (
         (org_id IS NOT NULL AND org_id = ${org})
         OR (org_id IS NULL AND ${org} IS NULL)
       )
       WITH CHECK (
         (org_id IS NOT NULL AND org_id = ${org})
         OR (org_id IS NULL AND ${org} IS NULL)
       )`,
    `DROP POLICY IF EXISTS agent_policies_delete ON agent_policies`,
    `CREATE POLICY agent_policies_delete ON agent_policies
       FOR DELETE TO syntra_app, syntra_relay
       USING (
         (org_id IS NOT NULL AND org_id = ${org})
         OR (org_id IS NULL AND ${org} IS NULL)
       )`,
    `DROP POLICY IF EXISTS agent_policies_migrator ON agent_policies`,
    `CREATE POLICY agent_policies_migrator ON agent_policies
       FOR ALL TO syntra_migrator USING (true) WITH CHECK (true)`,

    `DROP POLICY IF EXISTS agent_versions_read ON agent_versions`,
    `CREATE POLICY agent_versions_read ON agent_versions
       FOR SELECT TO syntra_app, syntra_relay
       USING (org_id IS NULL OR org_id = ${org})`,
    `DROP POLICY IF EXISTS agent_versions_insert ON agent_versions`,
    `CREATE POLICY agent_versions_insert ON agent_versions
       FOR INSERT TO syntra_app, syntra_relay
       WITH CHECK (
         (org_id IS NOT NULL AND org_id = ${org})
         OR (org_id IS NULL AND ${org} IS NULL)
       )`,
    `DROP POLICY IF EXISTS agent_versions_update ON agent_versions`,
    `CREATE POLICY agent_versions_update ON agent_versions
       FOR UPDATE TO syntra_app, syntra_relay
       USING (
         (org_id IS NOT NULL AND org_id = ${org})
         OR (org_id IS NULL AND ${org} IS NULL)
       )
       WITH CHECK (
         (org_id IS NOT NULL AND org_id = ${org})
         OR (org_id IS NULL AND ${org} IS NULL)
       )`,
    `DROP POLICY IF EXISTS agent_versions_delete ON agent_versions`,
    `CREATE POLICY agent_versions_delete ON agent_versions
       FOR DELETE TO syntra_app, syntra_relay
       USING (
         (org_id IS NOT NULL AND org_id = ${org})
         OR (org_id IS NULL AND ${org} IS NULL)
       )`,
    `DROP POLICY IF EXISTS agent_versions_migrator ON agent_versions`,
    `CREATE POLICY agent_versions_migrator ON agent_versions
       FOR ALL TO syntra_migrator USING (true) WITH CHECK (true)`,

    `DROP POLICY IF EXISTS admin_agent_entitlements_read ON admin_agent_entitlements`,
    `CREATE POLICY admin_agent_entitlements_read ON admin_agent_entitlements
       FOR SELECT TO syntra_app, syntra_relay USING (true)`,
    `DROP POLICY IF EXISTS admin_agent_entitlements_migrator ON admin_agent_entitlements`,
    `CREATE POLICY admin_agent_entitlements_migrator ON admin_agent_entitlements
       FOR ALL TO syntra_migrator USING (true) WITH CHECK (true)`,

    `DROP POLICY IF EXISTS agent_templates_read ON agent_templates`,
    `CREATE POLICY agent_templates_read ON agent_templates
       FOR SELECT TO syntra_app, syntra_relay USING (true)`,
    `DROP POLICY IF EXISTS agent_templates_migrator ON agent_templates`,
    `CREATE POLICY agent_templates_migrator ON agent_templates
       FOR ALL TO syntra_migrator USING (true) WITH CHECK (true)`,
  ];

  for (const sql of statements) {
    try {
      await pool.query(sql);
    } catch (err: any) {
      if (err?.code === "42704") continue; // undefined object/role
      console.warn(
        `[authoring] applyAuthoringRls skipped: ${err?.code ?? ""} ${err?.message ?? err}`,
      );
    }
  }
}

/**
 * Stage 2 Compile store RLS (idempotent, best-effort).
 *
 * We scope reads/writes by `org_id` matching `app.org_id`.
 * If `org_id` is NULL in the row, it's treated as global.
 */
export async function applyGraphStoreRls(pool: Pool): Promise<void> {
  const orgText = `NULLIF(current_setting('app.org_id', true), '')`;

  const statements = [
    // graph_definitions: runtime store topology materialisation.
    `ALTER TABLE graph_definitions ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE graph_definitions FORCE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS graph_definitions_read ON graph_definitions`,
    `CREATE POLICY graph_definitions_read ON graph_definitions
       FOR SELECT TO syntra_app, syntra_relay
       USING (org_id IS NULL OR org_id::text = ${orgText})`,
    `DROP POLICY IF EXISTS graph_definitions_insert ON graph_definitions`,
    `CREATE POLICY graph_definitions_insert ON graph_definitions
       FOR INSERT TO syntra_app, syntra_relay
       WITH CHECK (org_id IS NULL OR org_id::text = ${orgText})`,
    `DROP POLICY IF EXISTS graph_definitions_update ON graph_definitions`,
    `CREATE POLICY graph_definitions_update ON graph_definitions
       FOR UPDATE TO syntra_app, syntra_relay
       USING (org_id IS NULL OR org_id::text = ${orgText})
       WITH CHECK (org_id IS NULL OR org_id::text = ${orgText})`,
    `DROP POLICY IF EXISTS graph_definitions_delete ON graph_definitions`,
    `CREATE POLICY graph_definitions_delete ON graph_definitions
       FOR DELETE TO syntra_app, syntra_relay
       USING (org_id IS NULL OR org_id::text = ${orgText})`,
    `DROP POLICY IF EXISTS graph_definitions_migrator ON graph_definitions`,
    `CREATE POLICY graph_definitions_migrator ON graph_definitions
       FOR ALL TO syntra_migrator USING (true) WITH CHECK (true)`,

    // graph_versions: compile history tracker.
    `ALTER TABLE graph_versions ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE graph_versions FORCE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS graph_versions_read ON graph_versions`,
    `CREATE POLICY graph_versions_read ON graph_versions
       FOR SELECT TO syntra_app, syntra_relay
       USING (org_id IS NULL OR org_id::text = ${orgText})`,
    `DROP POLICY IF EXISTS graph_versions_insert ON graph_versions`,
    `CREATE POLICY graph_versions_insert ON graph_versions
       FOR INSERT TO syntra_app, syntra_relay
       WITH CHECK (org_id IS NULL OR org_id::text = ${orgText})`,
    `DROP POLICY IF EXISTS graph_versions_update ON graph_versions`,
    `CREATE POLICY graph_versions_update ON graph_versions
       FOR UPDATE TO syntra_app, syntra_relay
       USING (org_id IS NULL OR org_id::text = ${orgText})
       WITH CHECK (org_id IS NULL OR org_id::text = ${orgText})`,
    `DROP POLICY IF EXISTS graph_versions_delete ON graph_versions`,
    `CREATE POLICY graph_versions_delete ON graph_versions
       FOR DELETE TO syntra_app, syntra_relay
       USING (org_id IS NULL OR org_id::text = ${orgText})`,
    `DROP POLICY IF EXISTS graph_versions_migrator ON graph_versions`,
    `CREATE POLICY graph_versions_migrator ON graph_versions
       FOR ALL TO syntra_migrator USING (true) WITH CHECK (true)`,
  ];

  for (const sql of statements) {
    try {
      await pool.query(sql);
    } catch (err: any) {
      // undefined object/policy/role
      if (err?.code === "42704") continue;
      console.warn(
        `[authoring] applyGraphStoreRls skipped: ${err?.code ?? ""} ${err?.message ?? err}`,
      );
    }
  }
}
