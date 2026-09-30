const { pool } = require("../node-api/src/config/db");

async function test() {
  const cand1 = await pool.query(
    "SELECT id, full_name, created_by, org_id FROM core.people WHERE id = $1",
    ["42ff855f-fd31-4d77-9ed7-3c9b394c7ebf"]
  );
  const cand2 = await pool.query(
    "SELECT id, full_name, created_by, org_id FROM core.people WHERE id = $1",
    ["c404e671-7374-4def-9de6-a129f9593aa8"]
  );
  const job = await pool.query(
    "SELECT id, title, created_by, org_id FROM core.requirements WHERE id = $1",
    ["90e946fb-0542-45b7-baec-665e24566f28"]
  );
  const userOrgs = await pool.query(
    "SELECT user_id, org_id, role, status FROM platform.org_members WHERE user_id = $1",
    ["5baf647a-f1ad-4895-a281-cb26ef12e005"]
  );

  console.log("Candidate 1 (42ff855f):", cand1.rows[0]);
  console.log("Candidate 2 (c404e671):", cand2.rows[0]);
  console.log("Job (90e946fb):", job.rows[0]);
  console.log("User orgs (5baf647a):", userOrgs.rows);

  await pool.end();
}

test().catch(console.error);
