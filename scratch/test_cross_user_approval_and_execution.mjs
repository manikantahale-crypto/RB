import jwt from "jsonwebtoken";
import pg from "pg";
import fs from "fs";

const env = fs.readFileSync(".env", "utf8");
const line = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
const dbUrl = line.slice("DATABASE_URL=".length).trim();
const secretLine = env.split(/\r?\n/).find((l) => l.startsWith("AUTH_JWT_SECRET="));
const secret = secretLine ? secretLine.slice("AUTH_JWT_SECRET=".length).trim() : "test-secret";

const BASE = "http://127.0.0.1:4200";

const tokenA = jwt.sign(
  {
    userId: "aaaa1111-1111-1111-1111-111111111111",
    email: "alice@example.com",
    role: "operator",
  },
  secret,
  { expiresIn: "5m" }
);

const tokenB = jwt.sign(
  {
    userId: "bbbb2222-2222-2222-2222-222222222222",
    email: "bob@example.com",
    role: "admin",
  },
  secret,
  { expiresIn: "5m" }
);

async function test() {
  const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  const graphKey = "syntra.test.approval";

  console.log("=== STEP 0: Register event in event_catalog ===");
  await pool.query(`
    INSERT INTO authoring.event_catalog (event_type, schema_version, application, description, payload_schema, envelope_fields, produced_when, primary_consumer, visibility, handling, status)
    VALUES ('syntra.test.trigger', '1.0', 'syntra', 'Test trigger for approval verification', '{}'::jsonb, '{}'::jsonb, 'Test runner', 'syntra.test.approval', 'public', 'graph', 'active')
    ON CONFLICT (event_type, schema_version) DO NOTHING
  `);

  console.log("=== STEP 1: User A (Alice - Operator) creates workflow via /workflows/accept ===");
  const acceptRes = await fetch(`${BASE}/workflows/accept`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenA}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      graphKey,
      triggerEventType: "syntra.test.trigger",
      nodes: [
        {
          id: "step_1",
          impl: "syntra.duplicate.detect",
          config: {},
        },
      ],
    }),
  });
  console.log("Accept response status:", acceptRes.status);
  const acceptData = await acceptRes.json();
  console.log("Accept response:", acceptData);

  console.log("\n=== STEP 2: User A (Alice) compiles & requests go-live via /send-for-approval ===");
  const reqRes = await fetch(`${BASE}/workflows/${graphKey}/send-for-approval`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenA}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      note: "Alice requesting go-live review",
    }),
  });
  console.log("Request go-live status:", reqRes.status);
  const reqData = await reqRes.json();
  console.log("Request go-live response:", reqData);

  console.log("\n=== STEP 3: User A (Alice) attempts to self-approve ===");
  // Operator role will get 403 (operator forbidden to approve).
  // Even if Alice had admin role, isSamePerson checks userId/label! Let's test both!
  const selfApproveRes = await fetch(`${BASE}/workflows/${graphKey}/approve-go-live`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenA}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  console.log("Alice self-approve status (as operator):", selfApproveRes.status);
  console.log("Alice self-approve response:", await selfApproveRes.json());

  // Also test if Alice had an admin token with Alice's identity:
  const tokenAliceAdmin = jwt.sign(
    {
      userId: "aaaa1111-1111-1111-1111-111111111111",
      email: "alice@example.com",
      role: "admin",
    },
    secret,
    { expiresIn: "5m" }
  );
  const aliceAdminApprove = await fetch(`${BASE}/workflows/${graphKey}/approve-go-live`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenAliceAdmin}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  console.log("Alice self-approve status (even if admin):", aliceAdminApprove.status);
  console.log("Alice self-approve response:", await aliceAdminApprove.json());

  console.log("\n=== STEP 4: User B (Bob - Admin) reviews and approves ===");
  const bobApprove = await fetch(`${BASE}/workflows/${graphKey}/approve-go-live`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenB}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  console.log("Bob approve status:", bobApprove.status);
  const bobData = await bobApprove.json();
  console.log("Bob approve response:", bobData);

  console.log("\n=== STEP 5: Verify DB state ===");
  const check = await pool.query(`
    SELECT g.graph_key, g.status as graph_status, v.version, v.status as version_status,
           v.requested_by, v.approved_by, b.event_type, b.status as binding_status
    FROM authoring.graphs g
    JOIN authoring.graph_versions v ON g.id = v.graph_id AND v.status = 'live'
    LEFT JOIN authoring.event_bindings b ON g.id = b.graph_id AND b.status = 'active'
    WHERE g.graph_key = $1
  `, [graphKey]);
  console.table(check.rows);

  console.log("\n=== STEP 6: Clean up test workflow ===");
  await fetch(`${BASE}/workflows/${graphKey}/take-offline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenB}`,
      "Content-Type": "application/json",
    },
  });

  await pool.query("DELETE FROM authoring.event_bindings WHERE graph_id IN (SELECT id FROM authoring.graphs WHERE graph_key = $1)", [graphKey]);
  await pool.query("DELETE FROM authoring.graph_versions WHERE graph_id IN (SELECT id FROM authoring.graphs WHERE graph_key = $1)", [graphKey]);
  await pool.query("DELETE FROM authoring.graph_drafts WHERE graph_id IN (SELECT id FROM authoring.graphs WHERE graph_key = $1)", [graphKey]);
  await pool.query("DELETE FROM authoring.graphs WHERE graph_key = $1", [graphKey]);
  await pool.query("DELETE FROM authoring.event_catalog WHERE event_type = 'syntra.test.trigger'");
  console.log("Cleaned up successfully.");

  await pool.end();
}

test().catch(console.error);
