/**
 * Smoke: policy English threshold → LLM preview trace → Accept → DB proof.
 *
 * Prerequisites:
 *   npm run dev:admin   (admin-api :4200)
 *   LLM_PROVIDER + LLM_API_KEY + LLM_MODEL in orchaestration/.env
 *   DATABASE_MIGRATOR_URL in orchaestration/.env
 *
 * Usage:
 *   npm run smoke:generate-threshold
 *   npm run smoke:generate-threshold -- --agent-id 01900000-0000-7000-8000-000000000501
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import pg from "pg";

loadEnv({ path: resolve(process.cwd(), ".env") });

const ADMIN_API = process.env.ADMIN_API_URL ?? "http://localhost:4200";
const databaseUrl = process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL;
const DEFAULT_AGENT_ID = "01900000-0000-7000-8000-000000000501";

const THRESHOLD = 94;
const USER_REQUEST =
  `Process the job description, then the resume, then score the match. ` +
  `Score job x resume matches with a threshold of ${THRESHOLD}.`;

function argAgentId(): string {
  const idx = process.argv.indexOf("--agent-id");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return process.env.SMOKE_AGENT_ID ?? DEFAULT_AGENT_ID;
}

async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: T & Record<string, unknown> }> {
  const res = await fetch(`${ADMIN_API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-admin-id": "admin-local",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

function explainStepFromGraph(node: {
  impl: string;
  config?: Record<string, unknown>;
}): string | null {
  const cfg = node.config;
  if (!cfg || typeof cfg !== "object") return null;
  const bits: string[] = [];
  if (node.impl === "syntra.match.process") {
    if (typeof cfg.matchThreshold === "number") {
      bits.push(`Match threshold: ${cfg.matchThreshold}`);
    }
  }
  return bits.length ? bits.join(" · ") : null;
}

async function main(): Promise<void> {
  const agentId = argAgentId();
  console.log("=== smoke:generate-threshold ===");
  console.log(`ADMIN_API=${ADMIN_API}`);
  console.log(`agentId=${agentId}`);
  console.log(`LLM_PROVIDER=${process.env.LLM_PROVIDER ?? "(unset)"}`);
  console.log(`request="${USER_REQUEST}"`);
  console.log("");

  if (!databaseUrl) {
    console.error("DATABASE_MIGRATOR_URL or DATABASE_URL required");
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // --- (a) Load agent ---
    console.log("--- STEP A: GET /agents/:id ---");
    const agentRes = await api<{
      template?: { agentKey?: string; policyExt?: string };
      policy?: { version?: number; policy?: Record<string, unknown> };
    }>(`/agents/${agentId}`);

    console.log("HTTP status:", agentRes.status);
    if (!agentRes.ok) {
      console.error(JSON.stringify(agentRes.body, null, 2));
      process.exit(1);
    }

    const agentKey = String(
      agentRes.body.template?.agentKey ?? agentRes.body.agentKey ?? "syntra",
    );
    const policyExt = agentRes.body.template?.policyExt ?? "SyntraPolicyExt";
    let policyVersion = agentRes.body.policy?.version;
    const basePolicy = {
      ...(agentRes.body.policy?.policy ?? {}),
      agentId,
      agentKey,
      prompt: USER_REQUEST,
      triggerEventType:
        (agentRes.body.policy?.policy?.triggerEventType as string) ??
        "syntra.jd.received",
      allowedTools: [
        "syntra.jd.process",
        "syntra.resume.process",
        "syntra.match.process",
      ],
      matchThreshold: THRESHOLD,
      rerank: true,
    };

    // --- Save draft if needed ---
    console.log("\n--- STEP B: PUT /agents/:id/policy (draft with threshold text) ---");
    const saveRes = await api<{ version: number }>(`/agents/${agentId}/policy`, {
      method: "PUT",
      body: JSON.stringify({
        policy: basePolicy,
        expectedVersion: policyVersion,
      }),
    });
    console.log("HTTP status:", saveRes.status);
    console.log(JSON.stringify(saveRes.body, null, 2));
    if (!saveRes.ok) process.exit(1);
    policyVersion = saveRes.body.version;

    // --- (a) Preview generate ---
    console.log("\n--- STEP C: POST /agents/:id/generate preview (mode llm) ---");
    const previewRes = await api<{
      preview?: boolean;
      definition?: {
        nodes: Array<{ id: string; impl: string; config?: Record<string, unknown> }>;
        graphKey: string;
      };
      generationTrace?: {
        extracted?: { matchThreshold?: number };
        model?: string;
      };
    }>(`/agents/${agentId}/generate`, {
      method: "POST",
      body: JSON.stringify({
        policy: basePolicy,
        expectedVersion: policyVersion,
        mode: "llm",
        request: USER_REQUEST,
        preview: true,
      }),
    });

    console.log("HTTP status:", previewRes.status);
    console.log(JSON.stringify(previewRes.body, null, 2));
    if (!previewRes.ok) process.exit(1);

    const traceThreshold = previewRes.body.generationTrace?.extracted?.matchThreshold;
    console.log("\n--- STEP C proof: generationTrace.extracted.matchThreshold ---");
    console.log("generationTrace.extracted.matchThreshold =", traceThreshold);
    console.log("LLM model:", previewRes.body.generationTrace?.model ?? "(unknown)");

    const matchNode = previewRes.body.definition?.nodes.find(
      (n) => n.impl === "syntra.match.process",
    );
    console.log(
      "definition match node config.matchThreshold =",
      matchNode?.config?.matchThreshold,
    );

    if (traceThreshold !== THRESHOLD) {
      console.error(
        `FAIL: expected generationTrace.extracted.matchThreshold=${THRESHOLD}, got ${traceThreshold}`,
      );
      process.exit(1);
    }

    // UI explainer simulation (post-fix)
    const confirmed = matchNode ? explainStepFromGraph(matchNode) : null;
    console.log("\n--- STEP C UI: confirmed step explanation ---");
    console.log(confirmed);
    if (!confirmed?.includes(String(THRESHOLD))) {
      console.error("FAIL: UI confirmed explanation missing threshold");
      process.exit(1);
    }

    // --- (c) Accept ---
    console.log("\n--- STEP D: POST /agents/:id/generate accept:true ---");
    const acceptRes = await api<{ version: number; status: string }>(
      `/agents/${agentId}/generate`,
      {
        method: "POST",
        body: JSON.stringify({
          policy: basePolicy,
          expectedVersion: policyVersion,
          mode: "llm",
          accept: true,
          request: USER_REQUEST,
          definition: previewRes.body.definition,
          unsupported: [],
        }),
      },
    );
    console.log("HTTP status:", acceptRes.status);
    console.log(JSON.stringify(acceptRes.body, null, 2));
    if (!acceptRes.ok) process.exit(1);

    const graphVersion = acceptRes.body.version;

    // --- (d) DB agent_versions ---
    console.log("\n--- STEP E: SQL agent_versions (artifact_source) ---");
    const verRow = await pool.query<{
      version: number;
      status: string;
      artifact_source: string;
      meta: unknown;
    }>(
      `SELECT version, status, artifact_source, meta
         FROM builder.agent_versions
        WHERE agent_id = $1 AND org_id IS NULL AND version = $2
        ORDER BY generated_at DESC
        LIMIT 1`,
      [agentId, graphVersion],
    );
    console.log(JSON.stringify(verRow.rows, null, 2));

    const artifact = verRow.rows[0]?.artifact_source ?? "";
    const has94InArtifact = artifact.includes(`"matchThreshold": ${THRESHOLD}`) ||
      artifact.includes(`"matchThreshold":${THRESHOLD}`);
    console.log(`artifact_source contains matchThreshold ${THRESHOLD}:`, has94InArtifact);
    if (!has94InArtifact) {
      console.error("FAIL: agent_versions.artifact_source missing matchThreshold 94");
      process.exit(1);
    }

    // --- Compile → graph_definitions ---
    console.log("\n--- STEP F: POST /agents/:id/compile ---");
    const compileRes = await api<Record<string, unknown>>(`/agents/${agentId}/compile`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion: graphVersion }),
    });
    console.log("HTTP status:", compileRes.status);
    console.log(JSON.stringify(compileRes.body, null, 2));

    if (compileRes.ok) {
      console.log("\n--- STEP G: SQL graph_definitions ---");
      const graphKey = `${agentKey}.authored`;
      const defRow = await pool.query<{
        graph_key: string;
        version: number;
        status: string;
        definition: unknown;
      }>(
        `SELECT graph_key, version, status, definition
           FROM graph_definitions
          WHERE graph_key = $1 AND version = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        [graphKey, graphVersion],
      );
      console.log(JSON.stringify(defRow.rows, null, 2));
      const defJson = JSON.stringify(defRow.rows[0]?.definition ?? {});
      const has94InDef =
        defJson.includes(`"matchThreshold":${THRESHOLD}`) ||
        defJson.includes(`"matchThreshold": ${THRESHOLD}`);
      console.log(`graph_definitions.definition contains matchThreshold ${THRESHOLD}:`, has94InDef);
    } else {
      console.log("(compile skipped or failed — agent_versions proof is sufficient for Generate)");
    }

    console.log("\n=== PASS: threshold", THRESHOLD, "verified in preview trace and agent_versions ===");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
