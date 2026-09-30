const { pool } = require("../node-api/src/config/db");

async function checkActualData() {
  try {
    const threads = await pool.query(`SELECT thread_id, candidate_id FROM relay.email_threads LIMIT 10`);
    console.log("\nEmail Threads:", threads.rows);

    const msgs = await pool.query(`SELECT id, thread_id FROM relay.email_messages LIMIT 10`);
    console.log("\nEmail Messages:", msgs.rows);

    const classes = await pool.query(`SELECT message_id, thread_id, candidate_id FROM relay.email_classifications LIMIT 10`);
    console.log("\nEmail Classifications:", classes.rows);

    const followups = await pool.query(`SELECT id, message_id, candidate_id FROM relay.followups LIMIT 10`);
    console.log("\nFollowups:", followups.rows);

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

checkActualData();
