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
import { anonymousAllowed, registerAdminAuth } from "./lib/admin-identity.js";
import { ADMIN_ONLY } from "./lib/admin-only.js";
import pg from "pg";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import {
  createLlmClientFromEnv,
  ensureAuthoringSchema,
  ensureEventBindingsSchema,
  canonicalPoolOpts,
  withPgRetry,
  type LLMClient,
} from "@tekisho/authoring";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerCatalogAndCreateRoutes } from "./routes/catalog.js";
import { registerBuilderOverviewRoutes } from "./routes/builder-overview.js";
import { registerRuntimeRoutes } from "./routes/runtime.js";
import { registerLiveTestRoutes } from "./routes/live-test.js";
import { registerPlatformHealthRoutes } from "./routes/platform-health.js";
import { registerWorkflowRoutes } from "./routes/workflows.js";
import { registerEditorRoutes } from "./routes/editor.js";
import { registerNodeTestRoutes } from "./routes/node-test.js";
import { registerEventCatalogRoutes } from "./routes/event-catalog.js";
import { registerPlanRoutes } from "./routes/plans.js";
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
  return canonicalPoolOpts(connectionString, "admin-api", { max: 1 });
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

  /**
   * CORS was `origin: true` — every origin. The admin tool is one page on one
   * origin; anything else asking is not the admin tool.
   */
  const adminOrigin = (process.env.ADMIN_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  await app.register(import("@fastify/cors"), {
    origin: adminOrigin,
    credentials: true,
  });

  /**
   * Every route below needs to know who is calling, and until 2026-09-22
   * nothing did. See lib/admin-identity.ts for what changed, and why the
   * two-person rule could never pass before it.
   */
  registerAdminAuth(app as never);
  if (anonymousAllowed()) {
    console.warn(
      "[admin-api] ADMIN_ALLOW_ANONYMOUS is on — anyone who can reach this " +
        "port can author and approve workflows. Development only.",
    );
  }

  app.get("/health", async () => ({
    ok: true,
    service: "admin-api",
    stage: "authoring-builder-v2",
    llmConfigured: Boolean(llm),
  }));

  /**
   * WHO THE TOOL IS TALKING TO, AND WHAT THEY MAY DO.
   *
   * The UI needs the role to decide what to show, and it must not get it by
   * unpacking the JWT itself: a token is signed, not readable-as-truth by a
   * client, and a browser that decides its own permissions is deciding
   * nothing. It asks, this answers, and the answer comes from the same
   * `identify` every other route is gated by.
   *
   * `acts` is the list the UI hides controls from, sent rather than hard-coded
   * on both sides so the policy has ONE home (`lib/admin-only.ts`).
   */
  app.get("/me", async (req: any) => ({
    id: req.admin.id,
    email: req.admin.email,
    orgId: req.admin.orgId,
    role: req.admin.role,
    source: req.admin.source,
    adminOnly: [...new Set(ADMIN_ONLY.map((r) => r.why))],
  }));

  registerCatalogAndCreateRoutes(app, pool, migratorPool);
  registerBuilderOverviewRoutes(app, pool);
  registerAgentRoutes(app, pool, { llm, privilegedPool: migratorPool });
  registerRuntimeRoutes(app, migratorPool);
  registerWorkflowRoutes(app, pool);
  registerEditorRoutes(app, pool);
  registerLiveTestRoutes(app, pool);
  registerNodeTestRoutes(app, migratorPool);
  registerPlatformHealthRoutes(app, pool);
  registerEventCatalogRoutes(app, pool);
  registerPlanRoutes(app, pool);
  registerProposeRoutes(app, pool, { llm });

  const shutdown = async () => {
    await app.close();
    await migratorPool.end();
    if (!sharePool) await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port, host: "127.0.0.1" });
  console.log(
    `Admin API identity: ${
      anonymousAllowed() ? "ANONYMOUS ALLOWED (dev)" : "signed-in users only"
    }; browser origin ${adminOrigin.join(", ")}`,
  );
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

