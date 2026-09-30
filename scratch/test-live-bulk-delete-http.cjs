const { pool } = require("../node-api/src/config/db");
const jwt = require("jsonwebtoken");
const env = require("../node-api/src/config/env");

async function testHttpBulkDelete() {
  try {
    console.log("=== TESTING LIVE HTTP CANDIDATE BULK DELETE ===");

    const userAId = "5baf647a-f1ad-4895-a281-cb26ef12e005"; // Sarah Chen
    const token = jwt.sign({ userId: userAId, email: "sarah.chen@tekisho.com" }, env.AUTH_JWT_SECRET || env.JWT_SECRET);

    // Create a candidate with email message and classification
    const client = await pool.connect();
    const candRes = await client.query(
      "INSERT INTO core.people (full_name, email, created_by, status) VALUES ('Http Test Cand', 'httptest@test.com', $1, 'Active') RETURNING id",
      [userAId]
    );
    const candId = candRes.rows[0].id;

    const threadId = `thread-http-${Date.now()}`;
    await client.query("INSERT INTO relay.email_threads (thread_id, candidate_id, subject) VALUES ($1, $2, 'Http Subject')", [threadId, candId]);

    const msgId = `msg-http-${Date.now()}`;
    await client.query("INSERT INTO relay.email_messages (id, thread_id, subject, raw_body) VALUES ($1, $2, 'Msg', 'Body')", [msgId, threadId]);

    await client.query("INSERT INTO relay.email_classifications (message_id, thread_id, candidate_id, main_bucket) VALUES ($1, $2, NULL, 'Inquiry')", [msgId, threadId]);

    client.release();

    console.log(`Created test candidate: ${candId}`);

    // Call HTTP API POST http://localhost:4000/candidates/bulk-delete
    const res = await fetch("http://localhost:4000/candidates/bulk-delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ ids: [candId] })
    });

    const status = res.status;
    const body = await res.json();

    console.log(`HTTP POST /candidates/bulk-delete Status: ${status}`, body);

    if (status === 200 && body.deleted === 1) {
      console.log("PASS: Candidate bulk delete over HTTP succeeded with 200 OK!");
    } else {
      console.error("FAIL: Candidate bulk delete failed!");
    }

    process.exit(0);
  } catch (err) {
    console.error("Error testing HTTP bulk delete:", err);
    process.exit(1);
  }
}

testHttpBulkDelete();
