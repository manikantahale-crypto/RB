const { Client } = require("pg");
const dotenv = require("dotenv");
dotenv.config();

async function checkCounts() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const people = await client.query(`
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN created_by IS NULL THEN 1 END)::int as null_created,
        COUNT(CASE WHEN created_by IS NOT NULL THEN 1 END)::int as owned
      FROM core.people
    `);

    const requirements = await client.query(`
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN created_by IS NULL THEN 1 END)::int as null_created,
        COUNT(CASE WHEN created_by IS NOT NULL THEN 1 END)::int as owned
      FROM core.requirements
    `);

    const matches = await client.query(`
      SELECT 
        COUNT(*)::int as total
      FROM core.matches
    `);

    const submissions = await client.query(`
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN created_by IS NULL THEN 1 END)::int as null_created,
        COUNT(CASE WHEN created_by IS NOT NULL THEN 1 END)::int as owned
      FROM prism.submissions
    `);

    const users = await client.query(`
      SELECT id, email, created_at FROM platform.users LIMIT 10
    `);

    const candidateByCreator = await client.query(`
      SELECT created_by, COUNT(*)::int as count 
      FROM core.people 
      GROUP BY created_by
    `);

    const reqByCreator = await client.query(`
      SELECT created_by, COUNT(*)::int as count 
      FROM core.requirements 
      GROUP BY created_by
    `);

    console.log("=== DB COUNTS ===");
    console.log("core.people:", people.rows[0]);
    console.log("core.requirements:", requirements.rows[0]);
    console.log("core.matches:", matches.rows[0]);
    console.log("prism.submissions:", submissions.rows[0]);
    console.log("\n=== USERS ===");
    console.log(users.rows);
    console.log("\n=== CANDIDATES BY CREATOR ===");
    console.log(candidateByCreator.rows);
    console.log("\n=== REQUIREMENTS BY CREATOR ===");
    console.log(reqByCreator.rows);

  } catch (err) {
    console.error("Error checking DB:", err);
  } finally {
    await client.end();
  }
}

checkCounts();
