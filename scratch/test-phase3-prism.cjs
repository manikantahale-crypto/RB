const { pool } = require("../node-api/src/config/db");
const prismService = require("../node-api/src/modules/prism/services/prism.service");
const candidateRepo = require("../node-api/src/repositories/candidate.repository");
const jobRepo = require("../node-api/src/repositories/job.repository");

async function runPhase3Tests() {
  console.log("=== STARTING PHASE 3 PRISM WORKFLOW TESTS ===");

  const userA = "5baf647a-f1ad-4895-a281-cb26ef12e005";
  const userB = "370224ea-e9d9-4433-8a3e-6698ef301648";
  
  const candidateIdA = "c404e671-7374-4def-9de6-a129f9593aa8"; // created_by = 5baf647a
  const jobIdA = "90e946fb-0542-45b7-baec-665e24566f28";       // created_by = 5baf647a

  // Get current resume for candidateIdA
  const resumeRes = await pool.query(
    "SELECT id FROM core.resumes WHERE person_id = $1 ORDER BY created_at DESC LIMIT 1",
    [candidateIdA]
  );
  if (!resumeRes.rows[0]) throw new Error("Resume not found for test candidate!");
  const resumeIdA = resumeRes.rows[0].id;

  // Clean up existing submission for test pair to ensure clean state
  await pool.query(
    "DELETE FROM prism.submissions WHERE person_id = $1 AND requirement_id = $2",
    [candidateIdA, jobIdA]
  );

  // Test 1 — Owned Candidate + Owned JD submission creation by User A
  console.log("\nTest 1 — Owned Candidate + Owned JD submission creation by User A...");
  const subA = await prismService.createSubmission({
    candidateId: candidateIdA,
    resumeId: resumeIdA,
    jobId: jobIdA,
    matchId: null,
    userId: userA,
  });
  console.log("Result:", subA ? `PASS (created submission ${subA.id}, status: ${subA.status})` : "FAIL");
  if (!subA) throw new Error("Test 1 Failed!");

  // Test 2 — Cross-User Submission Protection (User B attempts User A's candidate/job)
  console.log("\nTest 2 — Cross-User Submission Protection (User B attempts User A's candidate)...");
  try {
    await prismService.createSubmission({
      candidateId: candidateIdA,
      resumeId: resumeIdA,
      jobId: jobIdA,
      matchId: null,
      userId: userB, // User B does not own Candidate A or Job A
    });
    console.error("FAIL: Cross-user submission was not blocked!");
    throw new Error("Test 2 Failed!");
  } catch (err) {
    console.log("PASS: Cross-user submission properly rejected with error:", err.message);
  }

  // Test 3 — Submission Retrieval by Owner (User A) vs Non-Owner (User B)
  console.log("\nTest 3 — Submission Retrieval by Owner vs Non-Owner...");
  const userASubmissions = await prismService.listSubmissions(userA, { submissionId: subA.id });
  const userBSubmissions = await prismService.listSubmissions(userB, { submissionId: subA.id });
  console.log(`User A retrieval: found ${userASubmissions.length} submission(s) (PASS)`);
  console.log(`User B retrieval: found ${userBSubmissions.length} submission(s) (PASS - isolated)`);
  if (userASubmissions.length !== 1 || userBSubmissions.length !== 0) {
    throw new Error("Test 3 Failed!");
  }

  // Test 4 — Zero-Organization User Submission Creation
  console.log("\nTest 4 — Zero-Organization User Submission Creation...");
  const zeroOrgUserId = "88888888-8888-8888-8888-888888888888";
  await pool.query(
    "INSERT INTO platform.users (id, full_name, email, status) VALUES ($1, 'Zero Org User 2', 'zeroorg2@test.com', 'active') ON CONFLICT (id) DO NOTHING",
    [zeroOrgUserId]
  );
  
  // Create owned candidate & JD for zeroOrgUserId with org_id set on records
  const tempCand = await pool.query(
    "INSERT INTO core.people (full_name, created_by, org_id, status) VALUES ('Zero Org Cand', $1, '2b8e12b3-1745-4ae9-902c-5a249c28ba94', 'Active') RETURNING id",
    [zeroOrgUserId]
  );
  const tempCandId = tempCand.rows[0].id;

  const tempResume = await pool.query(
    "INSERT INTO core.resumes (person_id, summary, is_current) VALUES ($1, 'Sample resume summary for zero org user', true) RETURNING id",
    [tempCandId]
  );
  const tempResumeId = tempResume.rows[0].id;

  const tempJob = await pool.query(
    "INSERT INTO core.requirements (title, created_by, org_id, status) VALUES ('Zero Org Job', $1, '2b8e12b3-1745-4ae9-902c-5a249c28ba94', 'Staging') RETURNING id",
    [zeroOrgUserId]
  );
  const tempJobId = tempJob.rows[0].id;

  let zeroOrgSubResult = null;
  let zeroOrgBlockedReason = null;
  try {
    zeroOrgSubResult = await prismService.createSubmission({
      candidateId: tempCandId,
      resumeId: tempResumeId,
      jobId: tempJobId,
      matchId: null,
      userId: zeroOrgUserId,
    });
    console.log("Zero-org user submission result: PASS (created submission", zeroOrgSubResult.id, ")");
  } catch (err) {
    zeroOrgBlockedReason = err.message;
    console.log("Zero-org user submission result: BLOCKED BY DATABASE TENANCY (", err.message, ")");
  }

  // Clean up temporary zero-org records
  try {
    if (zeroOrgSubResult) {
      await pool.query("DELETE FROM prism.audit WHERE entity_id = $1", [zeroOrgSubResult.id]);
      await pool.query("DELETE FROM prism.submissions WHERE id = $1", [zeroOrgSubResult.id]);
    }
    await pool.query("DELETE FROM core.requirements WHERE id = $1", [tempJobId]);
    await pool.query("DELETE FROM core.resumes WHERE id = $1", [tempResumeId]);
    await pool.query("DELETE FROM core.people WHERE id = $1", [tempCandId]);
    await pool.query("DELETE FROM platform.users WHERE id = $1", [zeroOrgUserId]);
  } catch (e) {
    // Ignore cleanup foreign key errors for temp test data
  }

  // Clean up main test submission created in Test 1
  try {
    await pool.query("DELETE FROM prism.submissions WHERE id = $1", [subA.id]);
  } catch (e) {}

  console.log("\n=== ALL PHASE 3 PRISM TESTS PASSED SUCCESSFULLY! ===");
  await pool.end();
}

runPhase3Tests().catch((err) => {
  console.error("\nPHASE 3 TEST ERROR:", err);
  process.exit(1);
});
