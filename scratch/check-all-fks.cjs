const { pool } = require("../node-api/src/config/db");

async function checkAllFks() {
  try {
    const res = await pool.query(`
      SELECT
        tc.table_schema, tc.table_name, kcu.column_name, tc.constraint_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints AS rc
        ON tc.constraint_name = rc.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE ccu.table_schema = 'relay' OR tc.table_schema = 'relay';
    `);
    console.log("All Relay FK relationships:\n", JSON.stringify(res.rows, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

checkAllFks();
