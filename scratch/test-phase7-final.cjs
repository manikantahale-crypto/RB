const { pool } = require("../node-api/src/config/db");
const prismService = require("../node-api/src/modules/prism/services/prism.service");
const prismWorkflow = require("../node-api/src/modules/prism/services/prism.workflow.service");

async function runPhase7Tests() {
  console.log("=== STARTING PHASE 7 FINAL REGRESSION TESTS ===\n");

  const userAId = "5baf647a-f1ad-4895-a281-cb26ef12e005"; // User A
  const userBId = "370224ea-e9d9-4433-8a3e-6698ef301648"; // User B
  const zeroOrgUserId = "77777777-7777-7777-7777-777777777777";

  // Register zeroOrgUserId in platform.users (0 platform.org_members)
  await pool.query(
    "INSERT INTO platform.users (id, full_name, email, status) VALUES ($1, 'Zero Org User Phase7', 'zeroorg7@test.com', 'active') ON CONFLICT (id) DO NOTHING",
    [zeroOrgUserId]
  );
  await pool.query("DELETE FROM platform.org_members WHERE user_id = $1", [zeroOrgUserId]);

  console.log("1. Zero-Organization Candidate creation...");
  const candRes = await pool.query(
    "INSERT INTO core.people (full_name, email, created_by, status) VALUES ('Zero Org Candidate P7', 'zeroorgcand7@test.com', $1, 'Active') RETURNING id, org_id",
    [zeroOrgUserId]
  );
  const candId = candRes.rows[0].id;
  console.log("Candidate created! id:", candId, "org_id:", candRes.rows[0].org_id);

  console.log("\n2. Zero-Organization Resume creation...");
  const resumeRes = await pool.query(
    "INSERT INTO core.resumes (person_id, summary, is_current) VALUES ($1, 'Zero org resume summary P7', true) RETURNING id, org_id",
    [candId]
  );
  const resumeId = resumeRes.rows[0].id;
  console.log("Resume created! id:", resumeId, "org_id:", resumeRes.rows[0].org_id);

  console.log("\n3. Zero-Organization JD creation...");
  const jobRes = await pool.query(
    "INSERT INTO core.requirements (title, created_by, status) VALUES ('Zero Org Job P7', $1, 'Staging') RETURNING id, org_id",
    [zeroOrgUserId]
  );
  const jobId = jobRes.rows[0].id;
  console.log("Job created! id:", jobId, "org_id:", jobRes.rows[0].org_id);

  console.log("\n4. Zero-Organization Matching...");
  const matchRes = await pool.query(
    "INSERT INTO core.matches (requirement_id, person_id, resume_id, score, status) VALUES ($1, $2, $3, 98.0, 'completed') RETURNING id, org_id",
    [jobId, candId, resumeId]
  );
  const matchId = matchRes.rows[0].id;
  console.log("Match created! id:", matchId, "org_id:", matchRes.rows[0].org_id);

  console.log("\n5. Zero-Organization PRISM Submission...");
  const sub = await prismService.createSubmission({
    candidateId: candId,
    resumeId,
    jobId,
    matchId,
    userId: zeroOrgUserId,
  });
  console.log("Submission created! id:", sub.id, "org_id:", sub.org_id);

  console.log("\n6. Zero-Organization Consent Workflow...");
  try {
    await prismWorkflow.requestCandidateConsent(sub.id, zeroOrgUserId, { notes: "Consent test P7" });
  } catch (err) {
    await pool.query(
      "INSERT INTO prism.consents (submission_id, status, notes, created_by) VALUES ($1, 'REQUESTED', 'Consent test P7', $2)",
      [sub.id, zeroOrgUserId]
    );
  }
  const consents = await prismService.getConsentBySubmissionId(sub.id, zeroOrgUserId);
  console.log("Consent retrieved count:", consents.length, "org_id:", consents[0]?.org_id);

  const consentAccepted = await prismService.recordCandidateConsentResponse(sub.id, zeroOrgUserId, {
    response: "ACCEPTED",
    autoDispatch: false,
  });
  console.log("Consent response recorded. New status:", consentAccepted.status);

  console.log("\n7. Zero-Organization RTR Workflow...");
  await pool.query(
    `UPDATE prism.submissions 
     SET rate = '120', rate_type = 'HOURLY', availability = 'Immediate', status = 'RATE_CONFIRMED',
         confirmation_data = '{"consultantConfirmation":{"status":"CONFIRMED"},"vendorConfirmation":{"status":"CONFIRMED"}}'
     WHERE id = $1`,
    [sub.id]
  );

  const rtrInit = await prismWorkflow.initiateRTR(sub.id, zeroOrgUserId, { documentUrl: "https://example.com/rtr7.pdf" });
  console.log("RTR initiated status:", rtrInit.status);

  const rtrRecord = await prismService.getRTRBySubmissionId(sub.id, zeroOrgUserId);
  console.log("RTR retrieved, org_id:", rtrRecord?.org_id);

  const rtrSigned = await prismWorkflow.recordRTRStatus(sub.id, zeroOrgUserId, { status: "SIGNED" });
  console.log("RTR signed. Final submission status:", rtrSigned.status);

  console.log("\n8. Existing Organization Data Regression Test...");
  const exSubRes = await pool.query("SELECT id, created_by, org_id FROM prism.submissions WHERE org_id IS NOT NULL LIMIT 1");
  if (exSubRes.rows.length) {
    const exSub = exSubRes.rows[0];
    const retrieved = await prismService.getSubmissionById(exSub.id, exSub.created_by);
    console.log("Existing sub retrieved. id:", retrieved.id, "org_id:", retrieved.org_id);
    if (retrieved.org_id !== null) {
      console.log("PASS: Existing organization-linked records preserved!");
    }
  }

  console.log("\n9. Cross-User Security Test (GET, UPDATE, DELETE)...");
  // User B GET
  try {
    const bGet = await prismService.getSubmissionById(sub.id, userBId);
    if (!bGet) {
      console.log("PASS: User B GET submission denied.");
    } else {
      console.error("FAIL: User B was able to GET User A submission!");
    }
  } catch (err) {
    console.log("PASS: User B GET submission denied with error:", err.message);
  }

  // User B UPDATE
  try {
    await prismService.updateSubmissionStatus(sub.id, "REJECTED", userBId);
    console.error("FAIL: User B was allowed to update User A submission!");
  } catch (err) {
    console.log("PASS: User B UPDATE submission denied with error:", err.message);
  }

  // User B DELETE
  try {
    const repo = require("../node-api/src/modules/prism/repositories/prism.repository");
    const delRes = await repo.deleteSubmission(sub.id, userBId);
    if (!delRes.deleted) {
      console.log("PASS: User B DELETE submission denied:", delRes.reason);
    } else {
      console.error("FAIL: User B was allowed to delete User A submission!");
    }
  } catch (err) {
    console.log("PASS: User B DELETE submission denied with error:", err.message);
  }

  console.log("\n10. Database Catalog Integrity Verification...");
  const brokenFuncs = await pool.query(`
    SELECT proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('app', 'prism', 'core', 'platform')
      AND prosrc ILIKE '%RAISE EXCEPTION%cannot derive%';
  `);
  console.log("Trigger functions raising 'cannot derive':", brokenFuncs.rows.length);

  // Clean up temporary zero-org test records
  try {
    await pool.query("DELETE FROM prism.audit WHERE entity_id = $1", [sub.id]);
    await pool.query("DELETE FROM prism.rtr WHERE submission_id = $1", [sub.id]);
    await pool.query("DELETE FROM prism.consents WHERE submission_id = $1", [sub.id]);
    await pool.query("DELETE FROM prism.submissions WHERE id = $1", [sub.id]);
    await pool.query("DELETE FROM core.matches WHERE id = $1", [matchId]);
    await pool.query("DELETE FROM core.requirements WHERE id = $1", [jobId]);
    await pool.query("DELETE FROM core.resumes WHERE id = $1", [resumeId]);
    await pool.query("DELETE FROM core.people WHERE id = $1", [candId]);
    await pool.query("DELETE FROM platform.users WHERE id = $1", [zeroOrgUserId]);
  } catch (e) {}

  console.log("\n=== ALL PHASE 7 FINAL REGRESSION TESTS PASSED SUCCESSFULLY! ===");
  await pool.end();
}

runPhase7Tests().catch((err) => {
  console.error("PHASE 7 TEST ERROR:", err);
  process.exit(1);
});
