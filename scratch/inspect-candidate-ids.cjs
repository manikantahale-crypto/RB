const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { pool } = require('../node-api/src/config/db');

async function main() {
  const ids = [
    '42ff855f-fd31-4d77-9ed7-3c9b394c7ebf',
    '15adeec9-be8a-4dde-a794-f139c75f1cba',
    'c404e671-7374-4def-9de6-a129f9593aa8'
  ];

  console.log('Querying core.people for candidate IDs:');
  for (const id of ids) {
    const res = await pool.query('SELECT id, full_name, created_by, org_id, status FROM core.people WHERE id = $1', [id]);
    if (res.rows.length === 0) {
      console.log(`Candidate ${id}: DOES NOT EXIST IN DB`);
    } else {
      console.log(`Candidate ${id}:`, res.rows[0]);
    }
  }

  await pool.end();
}

main();
