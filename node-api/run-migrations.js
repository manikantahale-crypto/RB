const { pool } = require("./src/config/db");
const log = require("./src/utils/logger");

async function runMigrations() {
  log.info("Starting schema migrations for Jobs and Resumes tables...");

  const queries = [
    // Ensure syntra.jobs has the correct columns
    `ALTER TABLE syntra.jobs
     ADD COLUMN IF NOT EXISTS processing_status VARCHAR(50) DEFAULT 'uploaded',
     ADD COLUMN IF NOT EXISTS processing_error TEXT,
     ADD COLUMN IF NOT EXISTS processing_failed_at TIMESTAMP WITH TIME ZONE,
     ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Active',
     ADD COLUMN IF NOT EXISTS min_experience INT,
     ADD COLUMN IF NOT EXISTS max_experience INT;`,

    // Ensure syntra.resumes has the correct columns
    `ALTER TABLE syntra.resumes
     ADD COLUMN IF NOT EXISTS processing_status VARCHAR(50) DEFAULT 'uploaded',
     ADD COLUMN IF NOT EXISTS processing_error TEXT,
     ADD COLUMN IF NOT EXISTS processing_failed_at TIMESTAMP WITH TIME ZONE,
     ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Active';`
  ];

  try {
    for (const sql of queries) {
      await pool.query(sql);
    }
    log.info("Migrations completed successfully!");
  } catch (error) {
    log.error("Migration failed:", error.message);
  } finally {
    process.exit(0);
  }
}

runMigrations();
