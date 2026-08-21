const { pool } = require("./src/config/db");

async function run() {
  try {
    const res1 = await pool.query(`SELECT pg_get_constraintdef(c.oid) as def FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid WHERE t.relname = 'matches' AND c.conname = 'matches_tier_check';`);
    console.log("Constraint Definition:");
    console.log(res1.rows);

    const res2 = await pool.query(`SELECT DISTINCT tier FROM matches;`);
    console.log("Distinct Tiers in matches table:");
    console.log(res2.rows);

    const res3 = await pool.query(`SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_name = 'matches' AND column_name IN ('tier', 'score', 'reasoning');`);
    console.log("Column Data Types:");
    console.log(res3.rows);

    process.exit(0);
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

run();
