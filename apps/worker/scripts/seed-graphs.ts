import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { env } from '../src/env.js';
import { resolve } from 'path';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function seed() {
  const pool = new Pool({
    connectionString: env.DATABASE_MIGRATOR_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const createTable = readFileSync(resolve(__dirname, '../../../packages/db/migrations/V11__graph_definitions_table.sql'), 'utf-8');
    const seedRows = readFileSync(resolve(__dirname, '../../../packages/db/migrations/R__seed_graph_definitions.sql'), 'utf-8');

    console.log("Running V11__graph_definitions_table.sql...");
    await pool.query(createTable);
    
    console.log("Running R__seed_graph_definitions.sql...");
    await pool.query(seedRows);
    
    console.log("Graph seeding completed successfully.");
  } catch (error) {
    console.error("Failed to seed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seed();
