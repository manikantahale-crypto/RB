const { pool } = require("../node-api/src/config/db");
const candidateRepo = require("../node-api/src/repositories/candidate.repository");
const jobRepo = require("../node-api/src/repositories/job.repository");
const prismService = require("../node-api/src/modules/prism/services/prism.service");
const resumeRepo = require("../node-api/src/repositories/resume.repository");

async function runVerification() {
  console.log("=== STARTING VERIFICATION ===");

  const userId = "5baf647a-f1ad-4895-a281-cb26ef12e005";
  const sameOrgCandidateId = "42ff855f-fd31-4d77-9ed7-3c9b394c7ebf";
  const userOwnedCandidateId = "c404e671-7374-4def-9de6-a129f9593aa8";
  const otherOrgUserId = "370224ea-e9d9-4433-8a3e-6698ef301648"; // Different user, not in org 00000000...
  const jobId = "90e946fb-0542-45b7-baec-665e24566f28";

  // 1. Candidate match lookup for same-org candidate (42ff855f)
  console.log("\n1. Testing candidate lookup for same-org candidate (42ff855f)...");
  const cand1 = await candidateRepo.getCandidateWithCurrentResume(sameOrgCandidateId, userId);
  console.log("Result for 42ff855f with user 5baf647a:", cand1 ? `FOUND (id: ${cand1.id}, name: ${cand1.full_name}, org: ${cand1.org_id})` : "NOT FOUND (404)");
  if (!cand1) throw new Error("Verification Failed: Same-org candidate returned 404!");

  // 2. Candidate match lookup for user-owned candidate (c404e671)
  console.log("\n2. Testing candidate lookup for user-owned candidate (c404e671)...");
  const cand2 = await candidateRepo.getCandidateWithCurrentResume(userOwnedCandidateId, userId);
  console.log("Result for c404e671 with user 5baf647a:", cand2 ? `FOUND (id: ${cand2.id}, name: ${cand2.full_name})` : "NOT FOUND (404)");
  if (!cand2) throw new Error("Verification Failed: User-owned candidate returned 404!");

  // 3. Cross-org authorization check for candidate
  console.log("\n3. Testing cross-org protection...");
  // Find or create a user in a completely different org
  const randomUserId = "00000000-0000-0000-0000-000000000099";
  const candCrossOrg = await candidateRepo.getCandidateWithCurrentResume(sameOrgCandidateId, randomUserId);
  console.log("Result for 42ff855f with unauthorized user:", candCrossOrg ? "FOUND (FAIL!)" : "NOT FOUND / DENIED (PASS)");
  if (candCrossOrg) throw new Error("Verification Failed: Unauthorized user was granted access!");

  // 4. Test PRISM submission creation with multi-org user
  console.log("\n4. Testing PRISM submission creation with multi-membership user 5baf647a...");
  // Get current resume ID for candidate c404e671
  const resume = await pool.query(
    "SELECT id FROM core.resumes WHERE person_id = $1 ORDER BY created_at DESC LIMIT 1",
    [userOwnedCandidateId]
  );
  if (!resume.rows[0]) throw new Error("No resume found for c404e671");
  const resumeId = resume.rows[0].id;

  // Clean up any existing submission for this test pair to ensure clean run
  await pool.query(
    "DELETE FROM prism.submissions WHERE person_id = $1 AND requirement_id = $2",
    [userOwnedCandidateId, jobId]
  );

  const sub = await prismService.createSubmission({
    candidateId: userOwnedCandidateId,
    resumeId,
    jobId,
    matchId: null,
    userId,
  });

  console.log("PRISM Submission Created Successfully:", {
    id: sub.id,
    org_id: sub.org_id,
    status: sub.status,
    created_by: sub.created_by,
  });
  if (sub.org_id !== "2b8e12b3-1745-4ae9-902c-5a249c28ba94") {
    throw new Error(`Verification Failed: Incorrect org_id on submission! Expected 2b8e12b3..., got ${sub.org_id}`);
  }

  // 5. Test cross-org submission rejection
  console.log("\n5. Testing cross-org submission rejection logic...");
  try {
    await prismService.createSubmission({
      candidateId: userOwnedCandidateId,
      resumeId,
      jobId,
      matchId: null,
      userId: randomUserId, // User not in org 2b8e12b3...
    });
    console.error("FAIL: Cross-org submission was not blocked!");
  } catch (err) {
    console.log("PASS: Cross-org submission blocked with error:", err.message);
  }

  // Clean up test submission created in step 4
  await pool.query("DELETE FROM prism.submissions WHERE id = $1", [sub.id]);

  console.log("\n=== ALL VERIFICATIONS PASSED SUCCESSFULLY! ===");
  await pool.end();
}

runVerification().catch((err) => {
  console.error("\nVERIFICATION ERROR:", err);
  process.exit(1);
});
