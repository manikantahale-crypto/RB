const { pool } = require("../node-api/src/config/db");

async function checkLiveDb() {
  try {
    console.log("=== CHECKING LIVE DATABASE CONNECTION AND CONSTRAINTS ===");

    const dbInfo = await pool.query(`
      SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), current_schema()
    `);
    console.log("DB Info:", dbInfo.rows[0]);

    const fkConstraint = await pool.query(`
      SELECT
        tc.constraint_name, tc.table_schema, tc.table_name, kcu.column_name,
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
      WHERE tc.constraint_name IN ('email_classifications_message_id_fkey', 'followups_message_id_fkey');
    `);
    console.log("FK Constraints definition in live DB:", fkConstraint.rows);

    process.exit(0);
  } catch (err) {
    console.error("Error checking live DB:", err);
    process.exit(1);
  }
}

checkLiveDb();
