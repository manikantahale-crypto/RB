/**
 * Boot-apply agent_templates schema + seed (dev).
 * Usage: npx tsx packages/authoring/scripts/seed-templates.ts
 */
import pg from "pg";
import { config } from "dotenv";
import { resolve } from "node:path";
import {
  ensureAuthoringSchema,
  listActiveTemplates,
} from "../src/index.js";

config({ path: resolve(process.cwd(), ".env") });

const url = process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_MIGRATOR_URL required");

const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

await ensureAuthoringSchema(pool);

const relayUrl = process.env.DATABASE_RELAY_URL?.trim();
if (relayUrl) {
  const relay = new pg.Pool({
    connectionString: relayUrl,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const templates = await listActiveTemplates(relay);
    console.log(
      "relay can read templates:",
      templates.map((t) => `${t.agentKey}@v${t.version}`),
    );
  } catch (e: any) {
    console.warn("relay list failed:", e.message);
  }
  await relay.end();
}

await pool.end();
