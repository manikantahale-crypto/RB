/**
 * Agent Authoring Admin API — Stage 1–3 + LLM Generate.
 *
 * Routes:
 * - GET  /agents
 * - GET  /agents/:id
 * - PUT  /agents/:id/policy
 * - POST /agents/:id/generate   (template or LLM via `request`)
 * - POST /agents/:id/compile | publish | activate | rollback
 *
 * Writes agent_policies / agent_versions / graph store only. Never calls the worker.
 * Router remount to authored keys is held — do not flip here.
 */
import Fastify from "fastify";
import pg from "pg";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import {
  createLlmClientFromEnv,
  ensureAuthoringSchema,
  ensureEventBindingsSchema,
  devPoolOpts,
  withPgRetry,
  type LLMClient,
} from "@tekisho/authoring";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerCatalogAndCreateRoutes } from "./routes/catalog.js";
import { registerBuilderOverviewRoutes } from "./routes/builder-overview.js";
import { registerRuntimeRoutes } from "./routes/runtime.js";
import { registerWorkflowRoutes } from "./routes/workflows.js";
import { registerEditorRoutes } from "./routes/editor.js";
import { registerNodeTestRoutes } from "./routes/node-test.js";
import { registerEventCatalogRoutes } from "./routes/event-catalog.js";
import { registerProposeRoutes } from "./routes/propose.js";

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
  return devPoolOpts(connectionString, 1);
}

function tryCreateLlm(): LLMClient | undefined {
  try {
    return createLlmClientFromEnv();
  } catch (err: any) {
    console.error(
      "[admin-api] LLM config invalid — description-driven Generate returns 503 until fixed:",
      err?.message ?? err,
    );
    return undefined;
  }
}

async function main(): Promise<void> {
  const schemaUrl = migratorUrl as string;
  const sharePool = schemaUrl === dataUrl;
  const migratorPool = new pg.Pool(poolOpts(schemaUrl));
  migratorPool.on("error", (err: Error) => {
    console.error("[admin-api] pg pool error:", err.message);
  });

  await withPgRetry("admin-api schema", async () => {
    await ensureAuthoringSchema(migratorPool);
    await ensureEventBindingsSchema(migratorPool);
  });

  const pool = sharePool ? migratorPool : new pg.Pool(poolOpts(dataUrl));
  const llm = tryCreateLlm();
  if (llm) {
    console.log(
      `[admin-api] LLM client ready (provider=${process.env.LLM_PROVIDER})`,
    );
  }

  const app = Fastify({ logger: true });

  await app.register(import("@fastify/cors"), {
    origin: true,
  });

  app.get("/health", async () => ({
    ok: true,
    service: "admin-api",
    stage: "authoring-builder-v2",
    llmConfigured: Boolean(llm),
  }));

  registerCatalogAndCreateRoutes(app, pool, migratorPool);
  registerBuilderOverviewRoutes(app, pool);
  registerAgentRoutes(app, pool, { llm, privilegedPool: migratorPool });
  registerRuntimeRoutes(app, migratorPool);
  registerWorkflowRoutes(app, pool);
  registerEditorRoutes(app, pool);
  registerNodeTestRoutes(app, migratorPool);
  registerEventCatalogRoutes(app, pool);
  registerProposeRoutes(app, pool, { llm });

  const shutdown = async () => {
    await app.close();
    await migratorPool.end();
    if (!sharePool) await pool.end();
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

