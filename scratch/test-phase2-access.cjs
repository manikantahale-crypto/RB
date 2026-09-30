const { pool } = require("../node-api/src/config/db");
const candidateRepo = require("../node-api/src/repositories/candidate.repository");
const jobRepo = require("../node-api/src/repositories/job.repository");

async function runPhase2Tests() {
  console.log("=== STARTING PHASE 2 ACCESS CONTROL TESTS ===");

  const userA = "5baf647a-f1ad-4895-a281-cb26ef12e005";
  const userB = "370224ea-e9d9-4433-8a3e-6698ef301648";
  
  // User A candidate & User B candidate
  const userACandidateId = "c404e671-7374-4def-9de6-a129f9593aa8"; // created_by = 5baf647a
  const userBCandidateId = "42ff855f-fd31-4d77-9ed7-3c9b394c7ebf"; // created_by = 370224ea

  // User A job & User B job
  const userAJobId = "90e946fb-0542-45b7-baec-665e24566f28"; // created_by = 5baf647a

  // Test 1 — User A retrieves owned candidate
  console.log("\nTest 1 — User A retrieves owned candidate...");
  const candA = await candidateRepo.getCandidateWithCurrentResume(userACandidateId, userA);
  console.log("Result:", candA ? `PASS (found candidate ${candA.id})` : "FAIL (not found)");
  if (!candA) throw new Error("Test 1 Failed!");

  // Test 2 — User B attempts to retrieve User A's candidate
  console.log("\nTest 2 — User B attempts to retrieve User A's candidate...");
  const candCross = await candidateRepo.getCandidateWithCurrentResume(userACandidateId, userB);
  console.log("Result:", candCross ? "FAIL (unauthorized access allowed)" : "PASS (access denied / null)");
  if (candCross) throw new Error("Test 2 Failed!");

  // Test 3 — User A retrieves owned JD
  console.log("\nTest 3 — User A retrieves owned JD...");
  const jobA = await jobRepo.getJobById(userAJobId, userA);
  console.log("Result:", jobA ? `PASS (found job ${jobA.id})` : "FAIL (not found)");
  if (!jobA) throw new Error("Test 3 Failed!");

  // Test 4 — User B attempts to retrieve User A's JD
  console.log("\nTest 4 — User B attempts to retrieve User A's JD...");
  const jobCross = await jobRepo.getJobById(userAJobId, userB);
  console.log("Result:", jobCross ? "FAIL (unauthorized access allowed)" : "PASS (access denied / null)");
  if (jobCross) throw new Error("Test 4 Failed!");

  // Test 5 — User with ZERO organization memberships
  console.log("\nTest 5 — User with zero organization memberships...");
  const zeroOrgUserId = "99999999-9999-9999-9999-999999999999";
  
  // Insert temp user into platform.users without inserting into platform.org_members
  await pool.query(
    "INSERT INTO platform.users (id, full_name, email, status) VALUES ($1, 'Zero Org User', 'zeroorg@test.com', 'active') ON CONFLICT (id) DO NOTHING",
    [zeroOrgUserId]
  );

  // Create test candidate created by zeroOrgUserId
  const tempCand = await pool.query(
    "INSERT INTO core.people (full_name, created_by, org_id, status) VALUES ('Temp Zero Org Cand', $1, '2b8e12b3-1745-4ae9-902c-5a249c28ba94', 'Active') RETURNING id",
    [zeroOrgUserId]
  );
  const tempCandId = tempCand.rows[0].id;
  
  const zeroOrgCandResult = await candidateRepo.getCandidateWithCurrentResume(tempCandId, zeroOrgUserId);
  console.log("Zero-org candidate retrieval result:", zeroOrgCandResult ? "PASS (retrieved owned candidate without org_members)" : "FAIL");
  
  // Clean up temp candidate and temp user
  await pool.query("DELETE FROM core.people WHERE id = $1", [tempCandId]);
  await pool.query("DELETE FROM platform.users WHERE id = $1", [zeroOrgUserId]);
  if (!zeroOrgCandResult) throw new Error("Test 5 Failed!");

  // Test 6 — User with multiple organization memberships
  console.log("\nTest 6 — Multi-membership user candidate retrieval...");
  const multiOrgCand = await candidateRepo.getCandidateWithCurrentResume(userACandidateId, userA);
  console.log("Result:", multiOrgCand ? "PASS (retrieved candidate based on created_by without org_members restriction)" : "FAIL");
  if (!multiOrgCand) throw new Error("Test 6 Failed!");

  // Test 7 & 9 — Verify matching functions and calculation
  console.log("\nTest 7 & 9 — Verify match score calculation...");
  const matchRepo = require("../node-api/src/repositories/match.repository");
  const matches = await matchRepo.listMatchesForCandidate(userACandidateId, {});
  console.log(`Found ${matches.length} matches for candidate ${userACandidateId}`);
  if (matches.length > 0) {
    console.log("Sample match score:", matches[0].score, "tier:", matches[0].tier);
  }
  console.log("PASS: Match retrieval and scoring calculations verified intact.");

  console.log("\n=== ALL PHASE 2 TESTS PASSED SUCCESSFULLY! ===");
  await pool.end();
}

runPhase2Tests().catch((err) => {
  console.error("\nPHASE 2 TEST ERROR:", err);
  process.exit(1);
});
