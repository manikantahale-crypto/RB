/**
 * Full SYNTRA + ASTRA demo driver (mirrors UI actions at localhost:3000).
 *
 * Prerequisites (3 terminals):
 *   npm run dev:worker
 *   npm run dev:orch-api
 *   npm run dev:syntra-api
 *
 * Usage:
 *   node scripts/demo-syntra-astra.mjs
 *   node scripts/demo-syntra-astra.mjs --email-only
 *   node scripts/demo-syntra-astra.mjs --skip-upload
 *
 * Env: DEMO_EMAIL, DEMO_PASSWORD (defaults demo@syntra.ai / demo1234)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

config({ path: path.resolve(process.cwd(), ".env") });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNTRA = (process.env.SYNTRA_API_URL || "http://localhost:4000").replace(/\/$/, "");
const ORCH = (process.env.ORCH_API_URL || "http://localhost:4100").replace(/\/$/, "");
const UI = process.env.SYNTRA_UI_URL || "http://localhost:3000";
const DEMO_EMAIL = process.env.DEMO_EMAIL || "demo@syntra.ai";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "demo1234";

const args = new Set(process.argv.slice(2));
const emailOnly = args.has("--email-only");
const skipUpload = args.has("--skip-upload");
const syntraOnly = args.has("--syntra-only");

function log(section, msg) {
  console.log(`\n[${section}] ${msg}`);
}

async function health(name, url) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      log("OK", `${name} ${url}`);
      return true;
    }
    log("FAIL", `${name} ${url} → HTTP ${res.status}`);
    return false;
  } catch (e) {
    log("FAIL", `${name} ${url} → ${e.message}`);
    return false;
  }
}

async function login() {
  let res = await fetch(`${SYNTRA}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  if (res.status === 401 || res.status === 404) {
    log("AUTH", "Creating demo user…");
    await fetch(`${SYNTRA}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        fullName: "Demo Recruiter",
        role: "Recruiter",
      }),
    });
    res = await fetch(`${SYNTRA}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    });
  }
  if (!res.ok) throw new Error(`Login failed: ${await res.text()}`);
  const data = await res.json();
  const token = data.token || data.accessToken;
  if (!token) throw new Error("No token in login response");
  log("AUTH", `Logged in as ${DEMO_EMAIL}`);
  return token;
}

async function uploadFile(token, endpoint, fields, filePath, fileField = "file") {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append(
    fileField,
    new Blob([buf], { type: "text/plain" }),
    path.basename(filePath),
  );
  const res = await fetch(`${SYNTRA}${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok && res.status !== 202) {
    throw new Error(`Upload ${endpoint} failed ${res.status}: ${text}`);
  }
  return { status: res.status, ...json };
}

async function pollJob(token, jobId, maxSec = 120) {
  const deadline = Date.now() + maxSec * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(`${SYNTRA}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { job } = await res.json();
    const st = job?.processingStatus || job?.processing_status;
    if (st === "processed") return job;
    if (st === "failed") throw new Error(`Job failed: ${job?.processingError || job?.processing_error}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Job processing timeout");
}

async function pollCandidate(token, candidateId, maxSec = 120) {
  const deadline = Date.now() + maxSec * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(`${SYNTRA}/candidates/${candidateId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) await new Promise((r) => setTimeout(r, 2000));
    else {
      const data = await res.json();
      const c = data.candidate || data;
      const st = c.processingStatus || c.processing_status;
      if (st === "processed" || st === "completed") return c;
      if (st === "failed") throw new Error("Resume processing failed");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Resume processing timeout");
}

async function astraEmailIntake(token) {
  const body = {
    subject: "Demo ASTRA — Senior Java Developer",
    body: fs.readFileSync(path.join(__dirname, "fixtures/sample-jd.txt"), "utf8"),
    from: "client@example.com",
    sourceSubject: "Fwd: Java Developer Requirement",
  };
  const res = await fetch(`${SYNTRA}/api/astra/intake/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  log("ASTRA", `Email intake → HTTP ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

async function printRecentOutbox(limit = 12) {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const events = await pool.query(
      `SELECT event_type, producer, occurred_at::text,
              published_at IS NOT NULL AS published
         FROM event_outbox
        ORDER BY occurred_at DESC
        LIMIT $1`,
      [limit],
    );
    log("DB", "Recent event_outbox:");
    for (const r of events.rows) {
      console.log(
        `    ${r.event_type}  producer=${r.producer}  published=${r.published}  at=${r.occurred_at}`,
      );
    }
    const bindings = await pool.query(
      `SELECT event_type, graph_key, agent_id::text, source
         FROM graph_event_bindings
        WHERE status = 'active' AND event_type LIKE ANY(ARRAY['syntra.%','astra.%'])
        ORDER BY event_type`,
    );
    log("DB", "Active ASTRA/SYNTRA bindings:");
    for (const b of bindings.rows) {
      console.log(
        `    ${b.event_type} → ${b.graph_key}  agent=${b.agent_id}  (${b.source})`,
      );
    }
  } finally {
    await pool.end();
  }
}

function printLogCheatSheet() {
  console.log(`
═══════════════════════════════════════════════════════════════
 WATCH WORKER TERMINAL — expected log sequence
═══════════════════════════════════════════════════════════════

SYNTRA JD upload (after AI completes):
  node-api:  [platformEvents] EMIT syntra.jd.parsed …
  worker:    [Relay] PUBLISH syntra.jd.parsed → orchestration.ingress
  worker:    [Router] ROUTE syntra.jd.parsed → graph=syntra.continuous.match agent=501
  worker:    [Module] START … syntra.continuous.match
  worker:    [WorkflowRunner] invoke syntra.continuous.match …
  node-api:  [internal] continuous-match job=…
  worker:    [WorkflowRunner] EMIT … → syntra.match.requested (per pair)
  worker:    [Router] ROUTE syntra.match.requested → graph=syntra.match.workflow agent=501

SYNTRA resume upload:
  node-api:  [platformEvents] EMIT syntra.profile.prepared …
  worker:    [Router] ROUTE … → syntra.duplicate.detect
  node-api:  [funnel] resume … tier2_finalists=…

ASTRA email intake:
  node-api:  [ASTRA] … requirement received
  worker:    [Router] ROUTE astra.requirement.received → astra.requirement.workflow agent=504
  worker:    [WorkflowRunner] EMIT … → astra.requirement.normalized / syntra.jd.normalized

UI: http://localhost:3000 — amber banner if human review queued
═══════════════════════════════════════════════════════════════
`);
}

async function main() {
  console.log("══════════════════════════════════════════════════");
  console.log(" SYNTRA + ASTRA + Orchestration — live demo driver");
  console.log(" UI:", UI);
  console.log("══════════════════════════════════════════════════");

  const okSyntra = await health("Syntra API", SYNTRA);
  const okOrch = await health("Orch API", ORCH);
  if (!okSyntra) {
    console.error("Start: npm run dev:syntra-api");
    process.exit(1);
  }
  if (!okOrch && !syntraOnly) {
    console.error("Start: npm run dev:orch-api  AND  npm run dev:worker");
    console.error("Or pass --syntra-only to test uploads without orchestrator.");
    process.exit(1);
  }
  if (!okOrch) {
    log("WARN", "Orch API down — uploads will run but worker logs will not appear");
  }

  printLogCheatSheet();

  const token = await login();

  if (!emailOnly && !skipUpload) {
    const jdPath = path.join(__dirname, "fixtures/sample-jd.txt");
    const resumePath = path.join(__dirname, "fixtures/sample-resume.txt");

    log("SYNTRA", "Upload JD (same as UI → Upload & Analyze → JD tab)");
    const jd = await uploadFile(token, "/jobs", { title: "Software Engineer Demo" }, jdPath);
    log("SYNTRA", `JD accepted jobId=${jd.jobId} — watch node-api for [jd.uploaded]`);

    log("SYNTRA", "Upload resume (UI → Resume tab)");
    const resume = await uploadFile(
      token,
      "/resumes",
      {
        fullName: "Shreya Demo",
        email: "shreya.demo@example.com",
        phone: "5551234567",
      },
      resumePath,
    );
    log("SYNTRA", `Resume accepted candidateId=${resume.candidateId}`);

    log("SYNTRA", "Polling until AI completes (UI spinner)…");
    try {
      const job = await pollJob(token, jd.jobId);
      log("SYNTRA", `JD processed: ${job.title}`);
    } catch (e) {
      log("WARN", `JD poll: ${e.message}`);
    }
    try {
      await pollCandidate(token, resume.candidateId);
      log("SYNTRA", "Resume processed");
    } catch (e) {
      log("WARN", `Resume poll: ${e.message}`);
    }

    log("SYNTRA", "Save to library (bulk-save)");
    await fetch(`${SYNTRA}/jobs/bulk-save`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jobIds: [jd.jobId] }),
    });
    await fetch(`${SYNTRA}/resumes/bulk-save`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ candidateIds: [resume.candidateId] }),
    });
    log("SYNTRA", "Saved — open Match Hub in UI for this job");
  }

  if (!skipUpload || emailOnly) {
    log("ASTRA", "Email JD intake (ORBIT Jobs workspace → email path)");
    await astraEmailIntake(token);
  }

  await new Promise((r) => setTimeout(r, 5000));
  await printRecentOutbox();

  console.log("\nNext: npm run demo:flow -- --all   (orch-only smoke)");
  console.log("      node scripts/backfill-jd-parsed.mjs   (older jobs)");
  console.log("Open UI:", UI, "→ Upload & Analyze / AI Workspace / ORBIT Jobs\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
