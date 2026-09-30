const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { pool } = require('../node-api/src/config/db');

async function main() {
  const userId = '5baf647a-f1ad-4895-a281-cb26ef12e005';
  console.log(`Inspecting org mappings for user ${userId}:`);

  const pUsers = await pool.query('SELECT * FROM platform.users WHERE id = $1', [userId]);
  console.log('platform.users:', pUsers.rows);

  const orgMembers = await pool.query('SELECT * FROM platform.org_members WHERE user_id = $1', [userId]);
  console.log('platform.org_members:', orgMembers.rows);

  const pubUsers = await pool.query('SELECT * FROM public.users WHERE id = $1', [userId]);
  console.log('public.users:', pubUsers.rows);

  const people = await pool.query('SELECT id, full_name, created_by, org_id FROM core.people WHERE id = $1', ['c404e671-7374-4def-9de6-a129f9593aa8']);
  console.log('Candidate c404e671 org_id:', people.rows[0]?.org_id);

  const reqs = await pool.query('SELECT id, title, created_by, org_id FROM core.requirements WHERE id = $1', ['90e946fb-0542-45b7-baec-665e24566f28']);
  console.log('Requirement 90e946fb org_id:', reqs.rows[0]?.org_id);

  await pool.end();
}

main();
