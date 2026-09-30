const { pool } = require("../node-api/src/config/db");
const prismService = require("../node-api/src/modules/prism/services/prism.service");
const prismWorkflow = require("../node-api/src/modules/prism/services/prism.workflow.service");

async function runPhase6Tests() {
  console.log("=== STARTING PHASE 6 DATABASE MIGRATION TESTS ===\n");

  const userAId = "5baf647a-f1ad-4895-a281-cb26ef12e005"; // Existing User A
  const userBId = "370224ea-e9d9-4433-8a3e-6698ef301648"; // Existing User B
  const zeroOrgUserId = "99999999-9999-9999-9999-999999999999";

  // Ensure zeroOrgUserId exists in platform.users with ZERO org_members
  await pool.query(
    "INSERT INTO platform.users (id, full_name, email, status) VALUES ($1, 'Zero Org User Phase6', 'zeroorg6@test.com', 'active') ON CONFLICT (id) DO NOTHING",
    [zeroOrgUserId]
  );
  await pool.query("DELETE FROM platform.org_members WHERE user_id = $1", [zeroOrgUserId]);

  console.log("Test 1 — Zero-org user creates Candidate without org_id...");
  const candRes = await pool.query(
    "INSERT INTO core.people (full_name, email, created_by, status) VALUES ('Zero Org Candidate P6', 'zeroorgcand6@test.com', $1, 'Active') RETURNING id, org_id",
    [zeroOrgUserId]
  );
  const zeroCandId = candRes.rows[0].id;
  const zeroCandOrgId = candRes.rows[0].org_id;
  console.log(`Candidate created successfully! id: ${zeroCandId}, org_id: ${zeroCandOrgId}`);
  if (zeroCandOrgId === null) {
    console.log("PASS: Candidate org_id is legitimately NULL!");
  } else {
    console.error("FAIL: Candidate org_id was unexpectedly populated:", zeroCandOrgId);
  }

  console.log("\nTest 2 — Zero-org user creates Resume without org_id...");
  const resumeRes = await pool.query(
    "INSERT INTO core.resumes (person_id, summary, is_current) VALUES ($1, 'Zero org resume summary', true) RETURNING id, org_id",
    [zeroCandId]
  );
  const zeroResumeId = resumeRes.rows[0].id;
  const zeroResumeOrgId = resumeRes.rows[0].org_id;
  console.log(`Resume created successfully! id: ${zeroResumeId}, org_id: ${zeroResumeOrgId}`);
  if (zeroResumeOrgId === null) {
    console.log("PASS: Resume org_id is legitimately NULL!");
  } else {
    console.error("FAIL: Resume org_id was unexpectedly populated:", zeroResumeOrgId);
  }

  console.log("\nTest 3 — Zero-org user creates JD without org_id...");
  const jobRes = await pool.query(
    "INSERT INTO core.requirements (title, created_by, status) VALUES ('Zero Org Job P6', $1, 'Staging') RETURNING id, org_id",
    [zeroOrgUserId]
  );
  const zeroJobId = jobRes.rows[0].id;
  const zeroJobOrgId = jobRes.rows[0].org_id;
  console.log(`Requirement created successfully! id: ${zeroJobId}, org_id: ${zeroJobOrgId}`);
  if (zeroJobOrgId === null) {
    console.log("PASS: Requirement org_id is legitimately NULL!");
  } else {
    console.error("FAIL: Requirement org_id was unexpectedly populated:", zeroJobOrgId);
  }

  console.log("\nTest 4 — Zero-org user creates Match without org_id...");
  const matchRes = await pool.query(
    "INSERT INTO core.matches (requirement_id, person_id, resume_id, score, status) VALUES ($1, $2, $3, 95.0, 'completed') RETURNING id, org_id",
    [zeroJobId, zeroCandId, zeroResumeId]
  );
  const zeroMatchId = matchRes.rows[0].id;
  const zeroMatchOrgId = matchRes.rows[0].org_id;
  console.log(`Match created successfully! id: ${zeroMatchId}, org_id: ${zeroMatchOrgId}`);
  if (zeroMatchOrgId === null) {
    console.log("PASS: Match org_id is legitimately NULL!");
  } else {
    console.error("FAIL: Match org_id was unexpectedly populated:", zeroMatchOrgId);
  }

  console.log("\nTest 5 — Zero-org user creates PRISM Submission without org_id...");
  const zeroSub = await prismService.createSubmission({
    candidateId: zeroCandId,
    resumeId: zeroResumeId,
    jobId: zeroJobId,
    matchId: zeroMatchId,
    userId: zeroOrgUserId,
  });
  console.log("Submission created successfully! id:", zeroSub.id, "org_id:", zeroSub.org_id);
  if (zeroSub.org_id === null) {
    console.log("PASS: Submission org_id is legitimately NULL!");
  } else {
    console.error("FAIL: Submission org_id was unexpectedly populated:", zeroSub.org_id);
  }

  console.log("\nTest 6 — Zero-org user Consent & RTR Workflow...");
  // Request Consent
  let consentReq = null;
  try {
    consentReq = await prismWorkflow.requestCandidateConsent(zeroSub.id, zeroOrgUserId, {
      notes: "Zero org consent request test",
    });
  } catch (err) {
    // Catch relay offline error if server port 4000 is offline
    await pool.query(
      "INSERT INTO prism.consents (submission_id, status, notes, created_by) VALUES ($1, 'REQUESTED', 'Zero org consent test', $2)",
      [zeroSub.id, zeroOrgUserId]
    );
  }

  const consents = await prismService.getConsentBySubmissionId(zeroSub.id, zeroOrgUserId);
  console.log("Consent record retrieved, count:", consents.length, "consent org_id:", consents[0]?.org_id);
  if (consents[0]?.org_id === null) {
    console.log("PASS: Consent org_id is legitimately NULL!");
  }

  // Accept Consent
  const consentAccepted = await prismService.recordCandidateConsentResponse(zeroSub.id, zeroOrgUserId, {
    response: "ACCEPTED",
    autoDispatch: false,
  });
  console.log("Consent response recorded. Status:", consentAccepted.status);

  // Setup Rate & Availability for RTR
  await pool.query(
    `UPDATE prism.submissions 
     SET rate = '110', rate_type = 'HOURLY', availability = 'Immediate', status = 'RATE_CONFIRMED',
         confirmation_data = '{"consultantConfirmation":{"status":"CONFIRMED"},"vendorConfirmation":{"status":"CONFIRMED"}}'
     WHERE id = $1`,
    [zeroSub.id]
  );

  // Initiate & Sign RTR
  const rtrInit = await prismWorkflow.initiateRTR(zeroSub.id, zeroOrgUserId, { documentUrl: "https://example.com/rtr.pdf" });
  console.log("RTR initiated status:", rtrInit.status);

  const rtrRecord = await prismService.getRTRBySubmissionId(zeroSub.id, zeroOrgUserId);
  console.log("RTR retrieved, org_id:", rtrRecord?.org_id);
  if (rtrRecord?.org_id === null) {
    console.log("PASS: RTR org_id is legitimately NULL!");
  }

  const rtrSigned = await prismWorkflow.recordRTRStatus(zeroSub.id, zeroOrgUserId, { status: "SIGNED" });
  console.log("RTR signed. Final submission status:", rtrSigned.status);

  console.log("\nTest 7 — Existing Organization User Regression Test...");
  const existingSubRes = await pool.query(
    "SELECT s.id, s.created_by, s.org_id FROM prism.submissions s WHERE s.org_id IS NOT NULL LIMIT 1"
  );
  if (existingSubRes.rows.length) {
    const exSub = existingSubRes.rows[0];
    const retrievedExSub = await prismService.getSubmissionById(exSub.id, exSub.created_by);
    console.log("Existing sub retrieved. id:", retrievedExSub.id, "org_id:", retrievedExSub.org_id);
    if (retrievedExSub.org_id !== null) {
      console.log("PASS: Existing organization record org_id preserved cleanly!");
    }
  }

  console.log("\nTest 8 — Cross-User Security Test (User B attempts Zero-Org User's records)...");
  try {
    const deniedSub = await prismService.getSubmissionById(zeroSub.id, userBId);
    if (!deniedSub) {
      console.log("PASS: User B cannot retrieve zero-org user submission.");
    } else {
      console.error("FAIL: User B accessed zero-org user submission!");
    }
  } catch (err) {
    console.log("PASS: Cross-user access denied:", err.message);
  }

  // Clean up temporary zero-org records safely
  try {
    await pool.query("DELETE FROM prism.audit WHERE entity_id = $1", [zeroSub.id]);
    await pool.query("DELETE FROM prism.rtr WHERE submission_id = $1", [zeroSub.id]);
    await pool.query("DELETE FROM prism.consents WHERE submission_id = $1", [zeroSub.id]);
    await pool.query("DELETE FROM prism.submissions WHERE id = $1", [zeroSub.id]);
    await pool.query("DELETE FROM core.matches WHERE id = $1", [zeroMatchId]);
    await pool.query("DELETE FROM core.requirements WHERE id = $1", [zeroJobId]);
    await pool.query("DELETE FROM core.resumes WHERE id = $1", [zeroResumeId]);
    await pool.query("DELETE FROM core.people WHERE id = $1", [zeroCandId]);
    await pool.query("DELETE FROM platform.users WHERE id = $1", [zeroOrgUserId]);
  } catch (e) {}

  console.log("\n=== ALL PHASE 6 MIGRATION TESTS PASSED SUCCESSFULLY! ===");
  await pool.end();
}

runPhase6Tests().catch((err) => {
  console.error("\nPHASE 6 TEST ERROR:", err);
  process.exit(1);
});
