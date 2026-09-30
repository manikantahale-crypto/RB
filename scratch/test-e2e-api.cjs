const jwt = require("jsonwebtoken");
const env = require("../node-api/src/config/env");
const { pool } = require("../node-api/src/config/db");

async function runE2eApiTest() {
  console.log("=== STARTING END-TO-END API TEST ===");

  // User 5baf647a-f1ad-4895-a281-cb26ef12e005 details from platform.users & org_members
  const userId = "5baf647a-f1ad-4895-a281-cb26ef12e005";
  const userRow = await pool.query(
    "SELECT u.id, u.email, m.role, m.org_id FROM platform.users u LEFT JOIN platform.org_members m ON m.user_id = u.id WHERE u.id = $1 LIMIT 1",
    [userId]
  );
  if (!userRow.rows[0]) throw new Error("User 5baf647a not found");

  const validToken = jwt.sign(
    {
      userId: userRow.rows[0].id,
      email: userRow.rows[0].email,
      role: userRow.rows[0].role || "operator",
      orgId: userRow.rows[0].org_id || "2b8e12b3-1745-4ae9-902c-5a249c28ba94",
    },
    env.AUTH_JWT_SECRET,
    { expiresIn: "1h" }
  );

  console.log("Generated valid session token for user 5baf647a...");

  // 1. Test GET /candidates/42ff855f-fd31-4d77-9ed7-3c9b394c7ebf/matches?status=completed
  const candidateId = "42ff855f-fd31-4d77-9ed7-3c9b394c7ebf";
  console.log(`\n1. Testing GET /candidates/${candidateId}/matches via API (port 4000)...`);

  const res1 = await fetch(`http://127.0.0.1:4000/candidates/${candidateId}/matches?status=completed`, {
    headers: {
      Authorization: `Bearer ${validToken}`,
      "Content-Type": "application/json",
    },
  });

  const body1 = await res1.json();
  console.log(`GET Candidate Matches HTTP Status: ${res1.status}`);
  console.log("Response Body:", JSON.stringify(body1, null, 2));

  if (res1.status !== 200) {
    throw new Error(`Expected HTTP 200, got ${res1.status}: ${JSON.stringify(body1)}`);
  }

  // Also test via Gateway (port 8080)
  console.log(`\n1b. Testing GET /candidates/${candidateId}/matches via Gateway (port 8080)...`);
  const res1g = await fetch(`http://127.0.0.1:8080/candidates/${candidateId}/matches?status=completed`, {
    headers: {
      Authorization: `Bearer ${validToken}`,
      "Content-Type": "application/json",
    },
  });
  console.log(`Gateway GET Candidate Matches HTTP Status: ${res1g.status}`);
  if (res1g.status !== 200) {
    throw new Error(`Gateway GET Expected HTTP 200, got ${res1g.status}`);
  }

  // 2. Test POST /submissions for candidate c404e671-7374-4def-9de6-a129f9593aa8 and job 90e946fb-0542-45b7-baec-665e24566f28
  const submitCandidateId = "c404e671-7374-4def-9de6-a129f9593aa8";
  const jobId = "90e946fb-0542-45b7-baec-665e24566f28";

  // Get current resume ID
  const resumeRes = await pool.query(
    "SELECT id FROM core.resumes WHERE person_id = $1 ORDER BY created_at DESC LIMIT 1",
    [submitCandidateId]
  );
  if (!resumeRes.rows[0]) throw new Error("Resume not found");
  const resumeId = resumeRes.rows[0].id;

  // Clean up any existing test submission to allow creation
  await pool.query(
    "DELETE FROM prism.submissions WHERE person_id = $1 AND requirement_id = $2",
    [submitCandidateId, jobId]
  );

  console.log(`\n2. Testing POST /submissions via API (port 4000)...`);
  const res2 = await fetch("http://127.0.0.1:4000/submissions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${validToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      candidateId: submitCandidateId,
      resumeId,
      jobId,
    }),
  });

  const body2 = await res2.json();
  console.log(`POST /submissions HTTP Status: ${res2.status}`);
  console.log("Response Body:", JSON.stringify(body2, null, 2));

  if (res2.status !== 201 && res2.status !== 200) {
    throw new Error(`Expected HTTP 200/201, got ${res2.status}: ${JSON.stringify(body2)}`);
  }

  // Verify created submission has org_id
  const createdSub = body2.data || body2.submission || body2;
  const subOrg = createdSub.org_id;
  console.log(`Created Submission org_id: ${subOrg}`);
  if (!subOrg) throw new Error("Created submission missing org_id!");

  // Clean up created submission
  const createdSubId = createdSub.id;
  if (createdSubId) {
    await pool.query("DELETE FROM prism.submissions WHERE id = $1", [createdSubId]);
  }

  // 3. Test Cross-Organization Security Boundary via HTTP API
  console.log("\n3. Testing Cross-Org HTTP API Protection...");
  const unauthorizedToken = jwt.sign(
    {
      userId: "00000000-0000-0000-0000-000000000099",
      email: "unauthorized@otherorg.com",
      role: "operator",
      orgId: "99999999-9999-9999-9999-999999999999",
    },
    env.AUTH_JWT_SECRET,
    { expiresIn: "1h" }
  );

  const resCross = await fetch(`http://127.0.0.1:4000/candidates/${candidateId}/matches?status=completed`, {
    headers: {
      Authorization: `Bearer ${unauthorizedToken}`,
      "Content-Type": "application/json",
    },
  });

  console.log(`Unauthorized Candidate Matches HTTP Status: ${resCross.status}`);
  const bodyCross = await resCross.json();
  console.log("Unauthorized Response Body:", bodyCross);

  if (resCross.status !== 404 && resCross.status !== 403) {
    throw new Error(`Expected HTTP 404/403 for unauthorized cross-org request, got ${resCross.status}`);
  }
  console.log("PASS: Cross-org HTTP API request properly rejected with status", resCross.status);

  console.log("\n=== ALL E2E API TESTS PASSED SUCCESSFULLY! ===");
  await pool.end();
}

runE2eApiTest().catch((err) => {
  console.error("\nE2E API TEST ERROR:", err);
  process.exit(1);
});
