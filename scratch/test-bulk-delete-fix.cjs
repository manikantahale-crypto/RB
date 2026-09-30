const { pool } = require("../node-api/src/config/db");
const candidateRepo = require("../node-api/src/repositories/candidate.repository");

async function runBulkDeleteTests() {
  console.log("=== STARTING CANDIDATE BULK DELETION BUG FIX VERIFICATION ===");

  const userAId = "5baf647a-f1ad-4895-a281-cb26ef12e005"; // User A
  const userBId = "66666666-6666-6666-6666-666666666666"; // User B

  const client = await pool.connect();

  try {
    // -------------------------------------------------------------------------
    // SETUP TEST DATA
    // -------------------------------------------------------------------------
    console.log("\n1. Setting up test candidates and email records...");

    // Candidate 1: With email thread, email message, classification with candidate_id = NULL
    const cand1Res = await client.query(
      "INSERT INTO core.people (full_name, email, created_by, status) VALUES ('Test Cand 1', 'cand1@test.com', $1, 'Active') RETURNING id",
      [userAId]
    );
    const cand1Id = cand1Res.rows[0].id;

    const thread1Id = `thread-test-1-${Date.now()}`;
    await client.query(
      "INSERT INTO relay.email_threads (thread_id, candidate_id, subject) VALUES ($1, $2, 'Subject 1')",
      [thread1Id, cand1Id]
    );

    const msg1Id = `msg-test-1-${Date.now()}`;
    await client.query(
      "INSERT INTO relay.email_messages (id, thread_id, subject, raw_body) VALUES ($1, $2, 'Msg 1', 'Body 1')",
      [msg1Id, thread1Id]
    );

    // Note: candidate_id is intentionally NULL to reproduce the exact FK bug!
    await client.query(
      "INSERT INTO relay.email_classifications (message_id, thread_id, candidate_id, main_bucket) VALUES ($1, $2, NULL, 'Job Application')",
      [msg1Id, thread1Id]
    );

    await client.query(
      "INSERT INTO relay.followups (id, message_id, thread_id, candidate_id, followup_reason) VALUES (gen_random_uuid(), $1, $2, NULL, 'Followup 1')",
      [msg1Id, thread1Id]
    );

    // Candidate 2: With email thread, email message, classification with candidate_id populated
    const cand2Res = await client.query(
      "INSERT INTO core.people (full_name, email, created_by, status) VALUES ('Test Cand 2', 'cand2@test.com', $1, 'Active') RETURNING id",
      [userAId]
    );
    const cand2Id = cand2Res.rows[0].id;

    const thread2Id = `thread-test-2-${Date.now()}`;
    await client.query(
      "INSERT INTO relay.email_threads (thread_id, candidate_id, subject) VALUES ($1, $2, 'Subject 2')",
      [thread2Id, cand2Id]
    );

    const msg2Id = `msg-test-2-${Date.now()}`;
    await client.query(
      "INSERT INTO relay.email_messages (id, thread_id, subject, raw_body) VALUES ($1, $2, 'Msg 2', 'Body 2')",
      [msg2Id, thread2Id]
    );

    await client.query(
      "INSERT INTO relay.email_classifications (message_id, thread_id, candidate_id, main_bucket) VALUES ($1, $2, $3, 'Inquiry')",
      [msg2Id, thread2Id, cand2Id]
    );

    // Candidate 3: Without email records
    const cand3Res = await client.query(
      "INSERT INTO core.people (full_name, email, created_by, status) VALUES ('Test Cand 3', 'cand3@test.com', $1, 'Active') RETURNING id",
      [userAId]
    );
    const cand3Id = cand3Res.rows[0].id;

    // Candidate 4: Owned by User B (Cross-user security check)
    const cand4Res = await client.query(
      "INSERT INTO core.people (full_name, email, created_by, status) VALUES ('Test Cand 4 User B', 'cand4@test.com', $1, 'Active') RETURNING id",
      [userBId]
    );
    const cand4Id = cand4Res.rows[0].id;

    console.log(`Created candidates: Cand1=${cand1Id} (with null candidate_id classification), Cand2=${cand2Id}, Cand3=${cand3Id}, Cand4(User B)=${cand4Id}`);

    // -------------------------------------------------------------------------
    // TEST 1: SINGLE CANDIDATE DELETION WITH NULL CANDIDATE_ID CLASSIFICATION
    // -------------------------------------------------------------------------
    console.log("\n2. Testing Single Candidate Deletion (Cand 1)...");
    const singleDelOk = await candidateRepo.deleteCandidate(cand1Id, userAId);
    console.log("Single Candidate Delete result:", singleDelOk);

    // Check orphaned records for Cand 1
    const checkThread1 = await client.query("SELECT * FROM relay.email_threads WHERE thread_id = $1", [thread1Id]);
    const checkMsg1 = await client.query("SELECT * FROM relay.email_messages WHERE id = $1", [msg1Id]);
    const checkClass1 = await client.query("SELECT * FROM relay.email_classifications WHERE message_id = $1", [msg1Id]);

    console.log(`Orphan check Cand 1: threads=${checkThread1.rows.length}, msgs=${checkMsg1.rows.length}, classifications=${checkClass1.rows.length}`);
    if (singleDelOk && checkThread1.rows.length === 0 && checkMsg1.rows.length === 0 && checkClass1.rows.length === 0) {
      console.log("PASS: Single candidate deletion succeeded without orphan records or FK errors!");
    } else {
      console.error("FAIL: Single candidate deletion failed or left orphaned records.");
    }

    // -------------------------------------------------------------------------
    // TEST 2: BULK CANDIDATE DELETION (MIXED CANDIDATES: CAND 2 & CAND 3)
    // -------------------------------------------------------------------------
    console.log("\n3. Testing Bulk Candidate Deletion (Cand 2 with emails + Cand 3 without emails)...");
    const bulkResult = await candidateRepo.deleteCandidates([cand2Id, cand3Id], userAId);
    console.log("Bulk Candidate Delete result:", bulkResult);

    const checkThread2 = await client.query("SELECT * FROM relay.email_threads WHERE thread_id = $1", [thread2Id]);
    const checkMsg2 = await client.query("SELECT * FROM relay.email_messages WHERE id = $1", [msg2Id]);
    const checkClass2 = await client.query("SELECT * FROM relay.email_classifications WHERE message_id = $1", [msg2Id]);

    console.log(`Orphan check Cand 2: threads=${checkThread2.rows.length}, msgs=${checkMsg2.rows.length}, classifications=${checkClass2.rows.length}`);
    if (bulkResult.deleted === 2 && checkThread2.rows.length === 0 && checkMsg2.rows.length === 0 && checkClass2.rows.length === 0) {
      console.log("PASS: Bulk candidate deletion succeeded with mixed email/non-email records!");
    } else {
      console.error("FAIL: Bulk candidate deletion failed.");
    }

    // -------------------------------------------------------------------------
    // TEST 3: CROSS-USER SECURITY CHECK
    // -------------------------------------------------------------------------
    console.log("\n4. Testing Cross-User Security (User A trying to delete User B's candidate)...");
    const secResult = await candidateRepo.deleteCandidates([cand4Id], userAId);
    console.log("Cross-user delete result:", secResult);

    const checkCand4 = await client.query("SELECT * FROM core.people WHERE id = $1", [cand4Id]);
    if (secResult.deleted === 0 && checkCand4.rows.length === 1) {
      console.log("PASS: User A was strictly denied deleting User B's candidate!");
    } else {
      console.error("FAIL: Cross-user security breached!");
    }

    // Clean up test cand 4
    await candidateRepo.deleteCandidate(cand4Id, userBId);

    console.log("\n=== ALL BULK DELETE FIX VERIFICATION TESTS COMPLETE ===");
  } catch (err) {
    console.error("\nTEST ERROR EXCEPTION:", err);
  } finally {
    client.release();
    process.exit(0);
  }
}

runBulkDeleteTests();
