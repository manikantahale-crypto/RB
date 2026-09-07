/**
 * Materialize the node contracts into `node_registry`.
 *
 * Spec §6.1: "Contracts live in git; a build step materializes them to
 * node_registry; CI fails on drift." This is that build step.
 *
 * WHY A BUILD STEP RATHER THAN READING CONTRACTS LIVE.
 * A contract is TypeScript — it holds Zod schemas and three functions. The
 * admin UI cannot import it, and the admin API should not, because the worker
 * is the only place allowed to import module adapters. Materializing turns the
 * declarative half into rows anything can read, and `checksumOf` makes drift
 * between git and the database detectable rather than invisible.
 *
 * WHAT ABOUT THE NODES WITHOUT CONTRACTS.
 * Thirteen of the twenty-two registered nodes are still plain engine functions
 * (ASTRA's 6, ORBIT's 5, the branch node, the human gate). They are written as
 * rows too, marked `source = 'legacy'`, carrying a module and a description but
 * no schemas. The editor needs to OFFER them — a workflow is built for a module
 * and must be able to use that module's nodes — while being honest that it
 * cannot type-check them. A registry that silently omitted half the nodes would
 * be worse than one that admits what it does not know.
 *
 * Run:  npm run materialize:nodes -w @tekisho/worker
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import pg from "pg";

// npm -w runs this from apps/worker, so the repository-root .env is two levels
// up. Both are loaded, nearest first, the same way the smoke scripts do it.
loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), "../../.env") });
import { toRegistryRow, checksumOf, MODULES } from "@tekisho/node-contract";
import { nodeRegistry } from "@tekisho/orchestrator/src/nodes/registry.js";
import { getToolCatalog } from "@tekisho/authoring";
import { contractNodes } from "../src/node-registry.js";
import { declaredNodes } from "../../../adapters/index.js";

/**
 * `astra.requirement.quality` → `astra`; `human.gate` → `platform`.
 *
 * Only for LEGACY rows — a declared node states its own module and is never
 * guessed at. The known set comes from the module registry rather than a list
 * written out here, which is how `orbit` came to be a module in this file and
 * not in the contract, and `relay` in neither.
 */
function moduleOf(key: string): string {
  const head = key.split(".")[0] ?? "";
  return (MODULES as readonly string[]).includes(head) && head !== "platform"
    ? head
    : "platform";
}

async function ensureTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS node_registry (
      registry_key   text PRIMARY KEY,
      key            text NOT NULL,
      version        text NOT NULL,
      module         text NOT NULL,
      shareable      boolean NOT NULL DEFAULT false,
      title          text NOT NULL,
      description    text NOT NULL,
      tags           jsonb NOT NULL DEFAULT '[]',
      input_schema   jsonb,
      output_schema  jsonb,
      config_schema  jsonb,
      admin_exposed  jsonb NOT NULL DEFAULT '[]',
      side_effect    text,
      idempotency    jsonb,
      execution      jsonb,
      llm            jsonb,
      dependencies   jsonb NOT NULL DEFAULT '[]',
      persistence    jsonb,
      fixture_names  jsonb NOT NULL DEFAULT '[]',
      has_stub       boolean NOT NULL DEFAULT false,
      /**
       * Every event the node may publish. NULLABLE ON PURPOSE, with no
       * default: NULL means nobody has declared, '[]' means declared to
       * publish nothing. A default of '[]' would have every undeclared legacy
       * node claiming silence, and a handoff that is merely unknown would be
       * reported as definitely broken.
       */
      emits          jsonb,
      /**
       * 'contract'  declared, and the declaration is what runs.
       * 'declared'  declared, but the engine runs its own implementation, so
       *             nothing checks one against the other. See declaredNodes
       *             in adapters/index.ts for why two nodes are like this.
       * 'legacy'    an engine function with no declaration at all.
       */
      source         text NOT NULL DEFAULT 'contract',
      checksum       text,
      updated_at     timestamptz NOT NULL DEFAULT now()
    )
  `);
  // The table is older than this column on any database that has been
  // materialized before. Additive and nullable, so nothing already there
  // changes meaning: every existing row becomes "not declared", which is
  // exactly what it was.
  await pool.query(
    `ALTER TABLE node_registry ADD COLUMN IF NOT EXISTS emits jsonb`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS node_registry_module_idx ON node_registry (module)`,
  );
}

async function main() {
  const url = process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_MIGRATOR_URL or DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new pg.Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await ensureTable(pool);

    const written: string[] = [];

    /**
     * One upsert for both kinds of declaration. `source` is the only
     * difference, and it is load-bearing: the admin screens read it to decide
     * whether a declaration is a guarantee or a description.
     */
    const writeDeclaration = async (
      contract: (typeof contractNodes)[number] | (typeof declaredNodes)[number],
      source: "contract" | "declared",
    ) => {
      const row = toRegistryRow(contract);
      const checksum = checksumOf(row);
      await pool.query(
        `INSERT INTO node_registry (
           registry_key, key, version, module, shareable, title, description,
           tags, input_schema, output_schema, config_schema, admin_exposed,
           side_effect, idempotency, execution, llm, dependencies, persistence,
           fixture_names, has_stub, source, checksum, emits, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,
           $12::jsonb,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,
           $18::jsonb,$19::jsonb,$20,$22,$21,$23::jsonb, now()
         )
         ON CONFLICT (registry_key) DO UPDATE SET
           key=$2, version=$3, module=$4, shareable=$5, title=$6,
           description=$7, tags=$8::jsonb, input_schema=$9::jsonb,
           output_schema=$10::jsonb, config_schema=$11::jsonb,
           admin_exposed=$12::jsonb, side_effect=$13, idempotency=$14::jsonb,
           execution=$15::jsonb, llm=$16::jsonb, dependencies=$17::jsonb,
           persistence=$18::jsonb, fixture_names=$19::jsonb, has_stub=$20,
           source=$22, checksum=$21, emits=$23::jsonb, updated_at=now()`,
        [
          row.registry_key,
          row.key,
          row.version,
          row.module,
          row.shareable,
          row.title,
          row.description,
          JSON.stringify(row.tags),
          JSON.stringify(row.input_schema),
          JSON.stringify(row.output_schema),
          JSON.stringify(row.config_schema),
          JSON.stringify(row.admin_exposed),
          row.side_effect,
          JSON.stringify(row.idempotency),
          JSON.stringify(row.execution),
          JSON.stringify(row.llm),
          JSON.stringify(row.dependencies),
          JSON.stringify(row.persistence),
          JSON.stringify(row.fixture_names),
          row.has_stub,
          checksum,
          source,
          JSON.stringify(row.emits),
        ],
      );
      written.push(`${row.registry_key} (${source})`);
    };

    // ── declared and enforced: the contract is what runs ────────────────
    for (const contract of contractNodes) {
      await writeDeclaration(contract, "contract");
    }

    // ── declared, but the engine runs it ───────────────────────────────
    for (const contract of declaredNodes) {
      await writeDeclaration(contract, "declared");
    }

    // ── the rest: known to the runtime, undeclared ─────────────────────
    const contractKeys = new Set([
      ...contractNodes.map((c) => c.key),
      ...declaredNodes.map((c) => c.key),
    ]);
    const catalog = getToolCatalog();

    for (const key of Object.keys(nodeRegistry)) {
      if (contractKeys.has(key)) continue;
      const entry = catalog.find((t) => t.key === key);
      await pool.query(
        `INSERT INTO node_registry (
           registry_key, key, version, module, shareable, title, description,
           source, updated_at
         ) VALUES ($1,$2,'1.0.0',$3,false,$4,$5,'legacy', now())
         ON CONFLICT (registry_key) DO UPDATE SET
           module=$3, title=$4, description=$5, source='legacy', updated_at=now()`,
        [
          `${key}@1`,
          key,
          moduleOf(key),
          key,
          entry?.description ??
            "No contract yet — this node has not declared what it takes or returns.",
        ],
      );
      written.push(`${key}@1 (legacy)`);
    }

    // Anything in the table that no longer exists in code is drift, and drift
    // that is only detected by a person is not detected.
    const { rows: stale } = await pool.query<{ registry_key: string }>(
      `SELECT registry_key FROM node_registry WHERE registry_key <> ALL($1::text[])`,
      [written.map((w) => w.split(" ")[0])],
    );
    if (stale.length) {
      console.warn(
        `\n${stale.length} row(s) in node_registry are not in the code any more:`,
      );
      for (const s of stale) console.warn(`   ${s.registry_key}`);
      console.warn("Remove them deliberately; this script does not delete.\n");
    }

    const { rows: counts } = await pool.query<{ source: string; n: string }>(
      `SELECT source, count(*) n FROM node_registry GROUP BY source ORDER BY source`,
    );
    console.log("node_registry materialized:");
    for (const c of counts) console.log(`   ${c.source.padEnd(9)} ${c.n}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
