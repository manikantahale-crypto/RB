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
import { planForEvent } from "../packages/orchestrator/src/routing/table.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

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
  const [bindings, graphs, registry, queues] = await Promise.all([
    pool.query(
      `SELECT event_type, graph_key, module_queue
         FROM graph_event_bindings WHERE status = 'active'`,
    ),
    pool.query(
      `SELECT graph_key, definition FROM graph_definitions WHERE status = 'active'`,
    ),
    pool.query(`SELECT key, module, shareable, emits FROM node_registry`),
    /**
     * What each queue is DOING, not what a constant says it should be.
     *
     * The first version of this compared bindings against a hardcoded list of
     * five queue names copied out of the engine, and called five live bindings
     * dead. All five were false — module.relay had completed a job sixteen
     * seconds earlier. A list only ever says what somebody remembered to type,
     * and it cannot know about a consumer living in another repository.
     */
    pool.query(`
      SELECT name,
             count(*) FILTER (WHERE state = 'created') AS waiting,
             count(*) FILTER (WHERE state = 'active')  AS running,
             EXTRACT(EPOCH FROM (now() - max(completed_on))) AS seconds_since
        FROM pgboss.job
       WHERE name LIKE 'module.%'
       GROUP BY name`),
  ]);

  /**
   * How each event is handled.
   *
   * `event_schemas` has no `handling` column yet, so this reads the hardcoded
   * `PLATFORM_EVENT_PLAN` — which is not a stand-in for the column, it is the
   * thing the router actually consults. `planForEvent` runs in the ingress
   * router BEFORE the binding is looked up, and anything it does not return
   * `graph` for is acknowledged and dropped, active binding or not.
   *
   * So this check is answerable today, and it is the one that catches a
   * workflow which is bound, valid, and can never run.
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
  if (!handlingOf || handlingOf.size === 0) {
    handlingOf = new Map(
      bindings.rows.map((r) => [r.event_type, planForEvent(r.event_type).kind]),
    );
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
    queueActivity: new Map(
      queues.rows.map((r) => [
        r.name,
        {
          waiting: Number(r.waiting ?? 0),
          running: Number(r.running ?? 0),
          secondsSinceCompletion:
            r.seconds_since === null ? null : Number(r.seconds_since),
        },
      ]),
    ),
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
