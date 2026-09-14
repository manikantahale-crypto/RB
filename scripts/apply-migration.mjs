/**
 * Apply one migration file, without Flyway and without psql.
 *
 *   node scripts/apply-migration.mjs <file> [--dry-run]
 *
 * Reads DATABASE_URL from the environment or from .env at the repo root, the
 * same way scripts/platform-checks.mjs does.
 *
 * WHY THIS EXISTS. `packages/db/flyway.conf` describes how these files are
 * meant to be applied, and the new Supabase project has no
 * `flyway_schema_history` table — Flyway has never run against it. The files
 * so far went in through psql, which is one more thing to have installed. The
 * `pg` driver is already a dependency of this repo, so this needs nothing.
 *
 * WHAT IT DOES NOT DO: keep a record of what has been applied. There is no
 * history table in this project to write to, and inventing a second one beside
 * Flyway's would leave two half-truths instead of one gap. Every migration
 * written for this project is safe to run twice — they are guarded, and
 * `--dry-run` is here so that can be checked rather than trusted.
 *
 * TRANSACTIONS. A file carrying its own BEGIN/COMMIT governs itself. One that
 * does not — the repeatable seeds — is wrapped, so a failure half way through
 * leaves nothing behind.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(join(root, ".env"), "utf8");
  const line = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("No DATABASE_URL in the environment or in .env");
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const file = args.find((a) => !a.startsWith("--"));

if (!file) {
  console.error("usage: node scripts/apply-migration.mjs <file> [--dry-run]");
  process.exit(2);
}

const path = resolve(root, file);
const raw = readFileSync(path, "utf8");

/**
 * Flyway placeholders, substituted here because Flyway is not doing it.
 *
 * Migrations in this project write `${app_role}` and expect
 * `packages/db/flyway.conf` to fill it in — V20260909.52 grants to three roles
 * that way. Without this the literal text reaches Postgres and the migration
 * fails on a syntax error that says nothing about the cause.
 *
 * An unresolved placeholder is refused rather than passed through. A migration
 * that runs with `${app_role}` left in it would create objects nobody can use,
 * and the failure would surface days later as a permission error.
 */
function applyPlaceholders(sql) {
  const conf = readFileSync(join(root, "packages/db/flyway.conf"), "utf8");
  const values = new Map();
  for (const line of conf.split(/\r?\n/)) {
    const m = /^\s*flyway\.placeholders\.([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) values.set(m[1], m[2]);
  }

  const filled = sql.replace(/\$\{([A-Za-z0-9_]+)\}/g, (whole, name) =>
    values.has(name) ? values.get(name) : whole,
  );

  const missing = [...new Set(filled.match(/\$\{[A-Za-z0-9_]+\}/g) ?? [])];
  if (missing.length > 0) {
    throw new Error(
      `no value in flyway.conf for ${missing.join(", ")} — add it there rather ` +
        `than editing the migration`,
    );
  }
  return filled;
}

const sql = applyPlaceholders(raw);

/**
 * Does the file manage its own transaction?
 *
 * Matched at the start of a line so the word inside a comment — and these
 * files have long comments — does not count.
 */
const ownsTransaction = /^\s*BEGIN\s*;/m.test(sql);

const client = new pg.Client({
  connectionString: databaseUrl(),
  ssl: { rejectUnauthorized: false },
});

// RAISE NOTICE is how these migrations report what they found. Losing that
// would turn a migration that says "12 rows, 1 retired" into a silent one.
client.on("notice", (n) => console.log(`   ${n.message}`));

await client.connect();

console.log(`\n${dryRun ? "REHEARSING" : "APPLYING"}  ${file}`);
console.log(`   transaction: ${ownsTransaction ? "the file's own" : "wrapped here"}`);

let failed = false;
try {
  if (dryRun) {
    /*
     * A file with its own COMMIT cannot be rehearsed as written — the COMMIT
     * would make it permanent. Stripping the pair leaves the statements to run
     * inside the transaction opened here, which is then rolled back.
     */
    const body = ownsTransaction
      ? sql.replace(/^\s*BEGIN\s*;/m, "").replace(/^\s*COMMIT\s*;/m, "")
      : sql;
    await client.query("BEGIN");
    await client.query(body);
    await client.query("ROLLBACK");
    console.log("   rolled back — nothing changed");
  } else if (ownsTransaction) {
    await client.query(sql);
    console.log("   committed");
  } else {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("   committed");
  }
} catch (err) {
  failed = true;
  // The migrations raise exceptions deliberately when an invariant fails, so
  // the message is the point and a stack trace would bury it.
  console.error(`\n   FAILED: ${err.message}`);
  try {
    await client.query("ROLLBACK");
  } catch {
    // Already rolled back by the failure itself.
  }
}

await client.end();
process.exit(failed ? 1 : 0);
