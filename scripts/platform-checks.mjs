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

const MARK = { pass: "  ok   ", fail: " FAIL  ", unchecked: "  --   " };

async function main() {
  // Imported as TypeScript so there is ONE implementation and the unit tests
  // cover the thing that actually runs. Requires tsx, hence `npm run
  // check:platform` rather than a bare `node`.
  const { runPlatformChecks, allPassed } = await import(
    "../apps/admin-api/src/lib/platform-checks.ts"
  );
  // One gatherer, shared with the admin health screen, so the two cannot
  // quietly disagree about what the platform looks like.
  const { gatherPlatformFacts } = await import(
    "../apps/admin-api/src/lib/platform-facts.ts"
  );

  const pool = new pg.Pool({
    connectionString: databaseUrl(),
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  try {
    const facts = await gatherPlatformFacts(pool, (e) => planForEvent(e).kind);
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
