const { checkDuplicateResume } = require("./src/validation/duplicateValidation");
const { pool } = require("./src/config/db");

async function runTests() {
  console.log("Starting tests for user-scoped duplicate validation...\n");
  const user1 = "00000000-0000-0000-0000-000000000001";
  const user2 = "00000000-0000-0000-0000-000000000002";
  const text1 = "RESUME_A_TEXT_" + Date.now();
  const text2 = "RESUME_B_TEXT_" + Date.now();

  try {
    // We will directly manipulate DB for test isolation
    await pool.query("BEGIN");

    // Insert dummy users
    await pool.query(`INSERT INTO syntra.users (id, full_name, email, password_hash, role) VALUES ($1, 'User 1', 'u1@test.com', 'hash', 'Recruiter') ON CONFLICT DO NOTHING`, [user1]);
    await pool.query(`INSERT INTO syntra.users (id, full_name, email, password_hash, role) VALUES ($1, 'User 2', 'u2@test.com', 'hash', 'Recruiter') ON CONFLICT DO NOTHING`, [user2]);

    // Insert dummy candidate for user 1
    const cand1 = await pool.query(`INSERT INTO syntra.candidates (full_name, created_by) VALUES ('Cand 1', $1) RETURNING id`, [user1]);
    const cid1 = cand1.rows[0].id;
    // Insert resume for user 1
    await pool.query(`INSERT INTO syntra.resumes (candidate_id, file_path, raw_text, version_number, is_current) VALUES ($1, 'test.pdf', $2, 1, true)`, [cid1, text1]);

    // Insert dummy candidate for user 2
    const cand2 = await pool.query(`INSERT INTO syntra.candidates (full_name, created_by) VALUES ('Cand 2', $1) RETURNING id`, [user2]);
    const cid2 = cand2.rows[0].id;
    // Insert resume for user 2
    await pool.query(`INSERT INTO syntra.resumes (candidate_id, file_path, raw_text, version_number, is_current) VALUES ($1, 'test.pdf', $2, 1, true)`, [cid2, text2]);


    console.log("Test 1: User 1 + new resume -> success");
    const res1 = await checkDuplicateResume("NEW_RESUME_TEXT", user1);
    console.assert(res1.isDuplicate === false, "Failed Test 1");
    console.log("✅ Passed");

    console.log("Test 2: User 1 + same resume again -> duplicate");
    const res2 = await checkDuplicateResume(text1, user1);
    console.assert(res2.isDuplicate === true, "Failed Test 2");
    console.log("✅ Passed");

    console.log("Test 3: User 2 + same resume that belongs to User 1 -> success");
    const res3 = await checkDuplicateResume(text1, user2);
    console.assert(res3.isDuplicate === false, "Failed Test 3");
    console.log("✅ Passed");

    console.log("Test 4: User 2 + same resume again -> duplicate");
    const res4 = await checkDuplicateResume(text2, user2);
    console.assert(res4.isDuplicate === true, "Failed Test 4");
    console.log("✅ Passed");

    console.log("Test 5: Different resume for either user -> success");
    const res5 = await checkDuplicateResume("DIFFERENT_TEXT", user1);
    const res6 = await checkDuplicateResume("DIFFERENT_TEXT", user2);
    console.assert(res5.isDuplicate === false, "Failed Test 5.1");
    console.assert(res6.isDuplicate === false, "Failed Test 5.2");
    console.log("✅ Passed");

  } catch (err) {
    console.error("Test error:", err);
  } finally {
    await pool.query("ROLLBACK");
    console.log("\nRolled back test data.");
    process.exit(0);
  }
}

runTests();
