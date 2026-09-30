const { pool } = require("../node-api/src/config/db");

async function inspectSchema() {
  try {
    console.log("=== INSPECTING RELAY TABLES AND CONSTRAINTS ===");

    // 1. Table structure for relay.email_classifications
    const classCols = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'relay' AND table_name = 'email_classifications'
      ORDER BY ordinal_position
    `);
    console.log("\nrelay.email_classifications Columns:", classCols.rows);

    // 2. Table structure for relay.email_messages
    const msgCols = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'relay' AND table_name = 'email_messages'
      ORDER BY ordinal_position
    `);
    console.log("\nrelay.email_messages Columns:", msgCols.rows);

    // 3. Foreign Keys referencing relay.email_messages
    const fkQuery = await pool.query(`
      SELECT
        tc.table_schema, tc.table_name, kcu.column_name,
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
      WHERE ccu.table_schema = 'relay' AND ccu.table_name = 'email_messages';
    `);
    console.log("\nForeign Keys referencing relay.email_messages:", fkQuery.rows);

    // 4. Foreign Keys from relay.email_classifications
    const fkClassQuery = await pool.query(`
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
      WHERE tc.table_schema = 'relay' AND tc.table_name = 'email_classifications';
    `);
    console.log("\nForeign Keys on relay.email_classifications:", fkClassQuery.rows);

    // 5. Inspect existing email_classifications and email_messages data
    const sampleClass = await pool.query(`
      SELECT id, message_id, candidate_id, created_at FROM relay.email_classifications LIMIT 10
    `);
    console.log("\nSample relay.email_classifications data:", sampleClass.rows);

    process.exit(0);
  } catch (err) {
    console.error("Error inspecting schema:", err);
    process.exit(1);
  }
}

inspectSchema();
