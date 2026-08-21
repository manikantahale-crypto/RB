const { pool } = require("../src/config/db");

async function run() {
  try {
    const resumes = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'syntra' AND table_name = 'resumes';
    `);
    console.log("syntra.resumes columns:");
    console.table(resumes.rows);

    const jobs = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'syntra' AND table_name = 'jobs';
    `);
    console.log("\nsyntra.jobs columns:");
    console.table(jobs.rows);
    
    const jds = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'syntra' AND table_name = 'job_descriptions';
    `);
    console.log("\nsyntra.job_descriptions columns:");
    console.table(jds.rows);

  } catch (err) {
    console.error("Error", err);
  } finally {
    await pool.end();
  }
}

run();
