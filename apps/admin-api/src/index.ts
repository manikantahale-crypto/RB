/**
 * Agent Authoring Admin API — Stage 1.
 *
 * Routes (design §5.3 / §8):
 * - GET  /agents
 * - GET  /agents/:id
 * - PUT  /agents/:id/policy     (Save → draft)
 * - POST /agents/:id/generate   (Validate → graph.json → generated)
 * - POST /agents/:id/compile    (generated → compiled)
 * - POST /agents/:id/publish    (compiled → published)
 * - POST /agents/:id/activate   (published → active; authored key only)
 * - POST /agents/:id/rollback   (prior published → active; authored key only)
 *
 * Writes agent_policies / agent_versions only. Never calls the runtime worker.
 *
 * DB roles: migrator creates authoring tables; syntra_relay reads
 * agent_definitions (owned by postgres) and DML on authoring tables.
 */
import Fastify from "fastify";
import pg from "pg";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { ensureAuthoringSchema } from "@tekisho/authoring";
import { registerAgentRoutes } from "./routes/agents.js";

loadEnv({ path: resolve(process.cwd(), "../../.env") });
loadEnv();

const migratorUrl =
  process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL;
if (!migratorUrl) {
  throw new Error("DATABASE_MIGRATOR_URL (or DATABASE_URL) is required");
}

/** Prefer relay — can SELECT agent_definitions; migrator cannot on this DB. */
const dataUrl = process.env.DATABASE_RELAY_URL?.trim() || migratorUrl;

const port = Number(process.env.ADMIN_API_PORT ?? 4200);

function poolOpts(connectionString: string) {
  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 4,
  };
}

async function main(): Promise<void> {
  const schemaUrl = migratorUrl as string;
  const migratorPool = new pg.Pool(poolOpts(schemaUrl));
  await ensureAuthoringSchema(migratorPool);
  await migratorPool.end();

  const pool = new pg.Pool(poolOpts(dataUrl));

  const app = Fastify({ logger: true });

  await app.register(import("@fastify/cors"), {
    origin: true,
  });

  app.get("/health", async () => ({
    ok: true,
    service: "admin-api",
    stage: "authoring-stage-1",
  }));

  registerAgentRoutes(app, pool);

  const shutdown = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port, host: "0.0.0.0" });
  console.log(
    `Admin API listening on :${port} (Stage 1 authoring; data role via ${
      process.env.DATABASE_RELAY_URL ? "DATABASE_RELAY_URL" : "migrator"
    })`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
