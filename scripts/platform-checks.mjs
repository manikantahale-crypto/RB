/**
 * Run the four platform checks against a real database.
 *
 *   npm run check:platform
 *
 * Reads DATABASE_URL from the environment or from .env at the repo root.
 * Read-only: four SELECTs, no writes, nothing created.
 *
 * Exits 1 when a check FAILS. A check that cannot see reports "not checked"
 * and does not fail the run — otherwise this is red from the day it lands, for
 * a column that does not exist yet, and everybody learns to ignore it.
 *
 * The logic lives in apps/admin-api/src/lib/platform-checks.ts and is unit
 * tested there. This file only gathers facts and prints.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { MODULES } from "@tekisho/node-contract";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

/** Queues a worker actually serves — from packages/orchestrator's routing table. */
const WORKED_QUEUES = [
  "module.syntra.jd",
  "module.design.resume",
  "module.design.duplicate",
  "module.syntra.match",
  "module.orbit.bench",
];

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(root, ".env"), "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
    if (line) return line.slice("DATABASE_URL=".length).trim();
  } catch {
    /* fall through */
  }
  throw new Error("No DATABASE_URL in the environment or in .env");
}

async function gather(pool) {
  const [bindings, graphs, registry] = await Promise.all([
    pool.query(
      `SELECT event_type, graph_key, module_queue
         FROM graph_event_bindings WHERE status = 'active'`,
    ),
    pool.query(
      `SELECT graph_key, definition FROM graph_definitions WHERE status = 'active'`,
    ),
    pool.query(`SELECT key, module, shareable, emits FROM node_registry`),
  ]);

  /**
   * Handling is not a column yet. Passing null rather than an empty map is the
   * difference between "not checked" and "every binding is wrong".
   */
  let handlingOf = null;
  try {
    const h = await pool.query(
      `SELECT event_type, handling FROM event_schemas WHERE handling IS NOT NULL`,
    );
    handlingOf = new Map(h.rows.map((r) => [r.event_type, r.handling]));
  } catch {
    handlingOf = null;
  }

  return {
    bindings: bindings.rows.map((r) => ({
      eventType: r.event_type,
      graphKey: r.graph_key,
      moduleQueue: r.module_queue ?? null,
    })),
    graphs: graphs.rows.map((r) => {
      const def = typeof r.definition === "string" ? JSON.parse(r.definition) : r.definition;
      return {
        graphKey: r.graph_key,
        impls: (def?.nodes ?? []).map((n) => String(n?.impl ?? "")).filter(Boolean),
      };
    }),
    registry: registry.rows.map((r) => ({
      key: r.key,
      module: r.module,
      shareable: r.shareable === true,
      emits: Array.isArray(r.emits) ? r.emits : null,
    })),
    workedQueues: new Set(WORKED_QUEUES),
    /**
     * FROM THE MODULE REGISTRY IN GIT, NOT FROM `node_registry`.
     *
     * The obvious shortcut is SELECT DISTINCT module FROM node_registry, and
     * it is wrong: that column names the module a NODE belongs to, so an
     * application with no declared nodes never appears. RELAY has none — so
     * relay did not count as an application, `relay.intake.workflow` was
     * treated as unattributable, and the one real boundary crossing in
     * production was skipped in silence. Written the wrong way here first.
     */
    modules: MODULES,
    handlingOf,
  };
}

const MARK = { pass: "  ok   ", fail: " FAIL  ", unchecked: "  --   " };

async function main() {
  // Imported as TypeScript so there is ONE implementation and the unit tests
  // cover the thing that actually runs. Requires tsx, hence `npm run
  // check:platform` rather than a bare `node`.
  const { runPlatformChecks, allPassed } = await import(
    "../apps/admin-api/src/lib/platform-checks.ts"
  );

  const pool = new pg.Pool({
    connectionString: databaseUrl(),
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  try {
    const facts = await gather(pool);
    const findings = runPlatformChecks(facts);

    console.log(
      `\nPlatform checks — ${facts.bindings.length} active bindings, ` +
        `${facts.graphs.length} active graphs, ${facts.registry.length} registered nodes\n`,
    );

    for (const f of findings) {
      console.log(`${MARK[f.status]}${f.id}`);
      console.log(`        ${f.message}`);
      for (const d of f.detail.slice(0, 20)) console.log(`          · ${d}`);
      if (f.detail.length > 20) {
        console.log(`          · … and ${f.detail.length - 20} more`);
      }
      console.log("");
    }

    const ok = allPassed(findings);
    console.log(ok ? "All checks pass.\n" : "Some checks failed.\n");
    process.exitCode = ok ? 0 : 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 2;
});
