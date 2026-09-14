import type { Pool } from "pg";
import { AgentTemplateSchema } from "./agent-template.js";
import { TEMPLATE_SEED_CATALOG } from "./template-catalog.js";
import { defaultDraftPolicyForTemplate } from "./product-agent-defaults.js";

/**
 * Create authoring tables if missing (same idea as GraphCompiler.ensureSchemaAndSeed).
 * No FKs here — migrator may lack REFERENCES on agent_definitions / organizations;
 * Flyway V12–V14 own the full schema with FKs when applied.
 */
/**
 * The tables the authoring layer cannot start without, schema-qualified.
 *
 * Named here rather than created here. See the note on ensureAuthoringSchema.
 *
 * THIS LIST WAS WRONG AND NOTHING NOTICED.
 *
 * It named six tables unqualified — agent_policies, graph_definitions and so
 * on — which resolve through `public` by search_path. Four of those moved to
 * `builder` and two are legacy: `public.graph_definitions` is a compatibility
 * VIEW over the authoring tables, and `public.graph_versions` is a superseded
 * table nothing reads. So the check passed against a database where the real
 * tables could have been missing, and failed against one where everything it
 * actually needs was present.
 *
 * Qualified now, and naming what the code reads.
 */
const REQUIRED_TABLES = [
  // what a workflow IS, and its history
  "authoring.graphs",
  "authoring.graph_versions",
  "authoring.graph_drafts",
  // what starts one
  "authoring.event_catalog",
  "authoring.event_bindings",
  // what may go in one
  "authoring.node_registry",
  // the admin app's own model
  "builder.agent_definitions",
  "builder.agent_policies",
  "builder.agent_versions",
  "builder.agent_templates",
  "builder.admin_agent_entitlements",
] as const;

/**
 * Fail loudly if the schema is not there, instead of building a guess of it.
 *
 * The message names the fix, because the person who sees this is usually
 * setting up a new environment and does not yet know how migrations are run
 * here.
 */
async function assertAuthoringTables(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ missing: string[] }>(
    `SELECT coalesce(array_agg(t), '{}') AS missing
       FROM unnest($1::text[]) AS t
      WHERE to_regclass(t) IS NULL`,
    [REQUIRED_TABLES as unknown as string[]],
  );

  const missing = rows[0]?.missing ?? [];
  if (missing.length > 0) {
    throw new Error(
      `[authoring] missing ${missing.length} table(s): ${missing.join(", ")}.\n` +
        `The schema comes from packages/db/migrations. Apply them first:\n` +
        `  flyway -url=... migrate      (or psql -f each V*.sql in order)\n` +
        `Verify with scripts/rebuild-check.sh.`,
    );
  }
}

/**
 * Row-level security is a fact about the schema, so this checks it.
 *
 * IT USED TO APPLY IT, AND THAT IS WHY IT WAS WRONG.
 *
 * Two functions here ran ~190 lines of ALTER TABLE and CREATE POLICY at every
 * boot, "mirroring V14 for boot without Flyway". Every CREATE POLICY named its
 * table UNQUALIFIED, so it resolved through search_path to `public` — where
 * these tables have not lived since they moved to `authoring` and `builder`.
 * Against a project built from the new baseline, `public` is empty, and all
 * 52 statements failed with 42P01 and were logged as "skipped".
 *
 * Nothing was broken by that, which is the worrying part: the migrations had
 * already applied every one of those policies, so boot was re-applying work
 * that was done, failing to, and reporting neither. A warning printed 52 times
 * at every start is a warning nobody reads.
 *
 * So the policies belong to packages/db/migrations, like the tables do, and
 * this asserts rather than writes — the same move already made for
 * CREATE TABLE. A missing policy now stops the app with a message naming the
 * table, instead of leaving it open and printing a line about it.
 */
async function assertRowLevelSecurity(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ relation: string; reason: string }>(
    `SELECT n.nspname || '.' || c.relname AS relation,
            CASE WHEN NOT c.relrowsecurity THEN 'RLS is not enabled'
                 ELSE 'no policies' END AS reason
       FROM unnest($1::text[]) AS t(name)
       JOIN pg_class c ON c.oid = t.name::regclass
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT c.relrowsecurity
         OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)`,
    [REQUIRED_TABLES as unknown as string[]],
  );

  if (rows.length > 0) {
    const lines = rows.map((r) => `  ${r.relation} — ${r.reason}`);
    throw new Error(
      [
        `[authoring] row-level security is missing on ${rows.length} table(s):`,
        ...lines,
        `The policies come from packages/db/migrations. Apply them first.`,
      ].join("\n"),
    );
  }
}

/**
 * Grants, row-level security and seed data for the authoring layer.
 *
 * IT NO LONGER CREATES TABLES, AND THAT IS THE POINT.
 *
 * It used to, with CREATE TABLE IF NOT EXISTS, because Flyway had never run
 * against this database and something had to make the app work. Its own
 * comment said as much: "Flyway V12-V14 own the full schema with FKs when
 * applied." They were not applied, so this was the schema, and the database
 * ended up with three authors — hand-pasted SQL, migration files nobody ran,
 * and this function — none of which agreed.
 *
 * That is fixed: the migrations now build the database from empty, checked on
 * every push by the `schema` job and locally by scripts/rebuild-check.sh.
 *
 * Creating tables here would undo it. A CREATE TABLE IF NOT EXISTS silently
 * accepts a table whose shape it did not create, and silently invents one that
 * no migration knows about — which is exactly how a column ends up existing in
 * production and in no file. So this now checks and refuses.
 */
export async function ensureAuthoringSchema(pool: Pool): Promise<void> {
  await assertAuthoringTables(pool);
  await assertRowLevelSecurity(pool);

  try {
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
      `ALTER TABLE builder.agent_policies DROP CONSTRAINT IF EXISTS agent_policies_status_check`,
    );
    await pool.query(`
      ALTER TABLE builder.agent_policies
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
      `ALTER TABLE builder.agent_versions DROP CONSTRAINT IF EXISTS agent_versions_status_check`,
    );
    await pool.query(`
      ALTER TABLE builder.agent_versions
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
    // Prefer keyed update / id bump (handles ASTRA version re-seeds), then insert.
    // Falls back to ON CONFLICT(id) style when unique (agent_key, version) collides.
    const payload = [
      s.agentId,
      s.displayName,
      JSON.stringify(template),
      s.agentKey,
      s.version,
    ];

    const updated = await pool.query(
      `UPDATE builder.agent_templates
          SET agent_id = $1,
              display_name = $2,
              template = $3::jsonb,
              is_active = true,
              updated_at = now()
        WHERE agent_key = $4 AND version = $5`,
      payload,
    );

    if ((updated.rowCount ?? 0) > 0) continue;

    const bumped = await pool.query(
      `UPDATE builder.agent_templates
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

    try {
      await pool.query(
        `INSERT INTO builder.agent_templates (
           id, agent_key, agent_id, display_name, version, template, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, true)
         ON CONFLICT (id) DO UPDATE SET
           agent_key = EXCLUDED.agent_key,
           agent_id = EXCLUDED.agent_id,
           display_name = EXCLUDED.display_name,
           version = EXCLUDED.version,
           template = EXCLUDED.template,
           is_active = true,
           updated_at = now()`,
        [
          s.id,
          s.agentKey,
          s.agentId,
          s.displayName,
          s.version,
          JSON.stringify(template),
        ],
      );
    } catch (err: any) {
      if (err?.code === "23505") {
        await pool.query(
          `UPDATE builder.agent_templates
              SET agent_id = $1,
                  display_name = $2,
                  template = $3::jsonb,
                  is_active = true,
                  updated_at = now()
            WHERE agent_key = $4 AND version = $5`,
          [
            s.agentId,
            s.displayName,
            JSON.stringify(template),
            s.agentKey,
            s.version,
          ],
        );
        continue;
      }
      throw err;
    }
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
  { name: "orbit.lifecycle.transition", min_version: "1.0.0" },
  { name: "orbit.activity.note", min_version: "1.0.0" },
]);

const ORBIT_RUNTIME_TOOLS = JSON.stringify([
  { name: "orbit.lifecycle.transition", min_version: "1.0.0" },
  { name: "orbit.placement.confirm", min_version: "1.0.0" },
  { name: "orbit.revenue.arrange", min_version: "1.0.0" },
  { name: "orbit.activity.note", min_version: "1.0.0" },
  { name: "orbit.route.decision", min_version: "1.0.0" },
  { name: "orch.branch.decision", min_version: "1.0.0" },
  { name: "human.gate", min_version: "1.0.0" },
]);

/**
 * Ensure agent_definitions + draft policies exist for catalog product agents
 * (mock agents HELIX/TEMPO/… are not in runtime R__seed_agent_definitions).
 */
export async function seedProductAgentDefinitions(pool: Pool): Promise<void> {
  let defs = 0;
  let policies = 0;

  for (const s of TEMPLATE_SEED_CATALOG) {
    if (!s.purpose) continue;

    const toolsJson =
      s.agentKey === "astra"
        ? ASTRA_RUNTIME_TOOLS
        : s.agentKey === "orbit"
          ? ORBIT_RUNTIME_TOOLS
          : PRODUCT_AGENT_RUNTIME_TOOLS;

    const defRow = await pool.query(
      `SELECT 1 FROM builder.agent_definitions WHERE id = $1`,
      [s.agentId],
    );
    if ((defRow.rowCount ?? 0) === 0) {
      await pool.query(
        `INSERT INTO builder.agent_definitions (
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
    } else if (s.agentKey === "astra" || s.agentKey === "orbit") {
      // Align existing definition with real runtime tools (was Syntra placeholder).
      await pool.query(
        `UPDATE builder.agent_definitions
            SET allowed_tools = $2::jsonb,
                purpose = $3,
                updated_at = now()
          WHERE id = $1`,
        [s.agentId, toolsJson, s.purpose],
      );
    }

    const policy = defaultDraftPolicyForTemplate({
      agentId: s.agentId,
      agentKey: s.agentKey,
      displayName: s.displayName,
      policyExt: s.template.policyExt,
    });

    const polRow = await pool.query(
      `SELECT policy FROM builder.agent_policies
        WHERE agent_id = $1 AND org_id IS NULL AND version = 1`,
      [s.agentId],
    );
    if ((polRow.rowCount ?? 0) === 0) {
      await pool.query(
        `INSERT INTO builder.agent_policies (
           org_id, agent_id, policy, status, version, created_by
         ) VALUES (NULL, $1, $2::jsonb, 'draft', 1, 'seed')`,
        [s.agentId, JSON.stringify(policy)],
      );
      policies++;
    } else if (s.agentKey === "astra" || s.agentKey === "orbit") {
      // Align draft/generated policy tools with runtime (was Syntra placeholder).
      await pool.query(
        `UPDATE builder.agent_policies
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
      `SELECT 1 FROM builder.admin_agent_entitlements
        WHERE admin_id = 'admin-local' AND agent_id = $1 AND org_id IS NULL`,
      [s.agentId],
    );
    if ((existing.rowCount ?? 0) > 0) continue;
    await pool.query(
      `INSERT INTO builder.admin_agent_entitlements (admin_id, agent_id, org_id, can_edit)
       VALUES ('admin-local', $1, NULL, true)`,
      [s.agentId],
    );
  }
  console.log("[authoring] admin-local entitlements seeded");
}

