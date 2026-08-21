const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

function loadEnvUrl() {
  const raw = fs.readFileSync(path.join(__dirname, "../.env"), "utf8");
  const line = raw.split(/\r?\n/).find((l) => l.startsWith("DATABASE_MIGRATOR_URL="));
  if (!line) throw new Error("DATABASE_MIGRATOR_URL missing");
  return line.slice("DATABASE_MIGRATOR_URL=".length).trim();
}

async function main() {
  const url = loadEnvUrl();
  const sql = fs.readFileSync(
    path.join(__dirname, "../packages/db/migrations/V26__orbit_event_schemas_and_bindings.sql"),
    "utf8",
  );
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(sql);
  const r = await c.query(
    `SELECT event_type FROM event_schemas WHERE event_type LIKE 'orbit.%' ORDER BY 1`,
  );
  console.log("orbit schemas:", r.rows.map((x) => x.event_type).join(", ") || "(none)");
  const b = await c.query(
    `SELECT event_type, graph_key FROM graph_event_bindings
     WHERE event_type LIKE 'orbit.%' AND status = 'active' ORDER BY 1`,
  );
  console.log(
    "orbit bindings:",
    b.rows.map((x) => `${x.event_type}→${x.graph_key}`).join(", ") || "(none)",
  );
  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
