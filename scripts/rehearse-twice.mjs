/**
 * Rehearse one or more migrations TWICE in one transaction, then roll back.
 *
 *   node scripts/rehearse-twice.mjs <file> [<file> ...]
 *
 * The onboarding path asks every migration to be safe to run twice and to
 * prove it. `db:apply --dry-run` runs a file once; this runs the files in
 * order, then runs them all again on top of their own result, and rolls the
 * whole thing back. A file that is not idempotent fails on the second pass,
 * here, instead of in production. Several files are accepted so a migration
 * that depends on an earlier unapplied one can be rehearsed with it.
 *
 * Same placeholder substitution and DATABASE_URL discovery as apply-migration.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/rehearse-twice.mjs <file> [<file> ...]");
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = fs.readFileSync(path.join(root, ".env"), "utf8");
const url = process.env.DATABASE_URL
  || env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=")).slice(13).replace(/^"|"$/g, "");

const conf = fs.readFileSync(path.join(root, "packages/db/flyway.conf"), "utf8");
const placeholders = Object.fromEntries(
  [...conf.matchAll(/^flyway\.placeholders\.(\w+)=(.*)$/gm)].map((m) => [m[1], m[2].trim()]),
);

const bodies = files.map((file) => {
  let sql = fs.readFileSync(path.resolve(root, file), "utf8");
  sql = sql.replace(/\$\{(\w+)\}/g, (m, k) => (k in placeholders ? placeholders[k] : m));
  // The file's own BEGIN/COMMIT would end our transaction early.
  return [file, sql.replace(/^\s*BEGIN\s*;/m, "").replace(/^\s*COMMIT\s*;/m, "")];
});

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
client.on("notice", (n) => console.log(`   ${n.message}`));
await client.connect();
console.log(`\nREHEARSING TWICE  ${files.map((f) => path.basename(f)).join("  ")}`);
try {
  await client.query("BEGIN");
  for (const pass of [1, 2]) {
    console.log(`-- pass ${pass}${pass === 2 ? " (on top of pass 1)" : ""}`);
    for (const [file, body] of bodies) {
      console.log(`   > ${path.basename(file)}`);
      await client.query(body);
    }
  }
  await client.query("ROLLBACK");
  console.log("   both passes succeeded — rolled back, nothing changed");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`   FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
