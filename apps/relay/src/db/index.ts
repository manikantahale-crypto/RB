import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { resolve } from 'node:path';
import * as schema from './schema';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(__dirname, '../../../../.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is missing in environment variables');
}

/** Inbox list must not wait behind IMAP persist. Keep pg-boss at DEV_PG_POOL_MAX=1. */
const poolMax = Math.max(1, parseInt(process.env.RELAY_SQL_POOL_MAX || '2', 10));

export const sql = postgres(connectionString, {
  max: poolMax,
  idle_timeout: 8,
  connect_timeout: 20,
  prepare: false,
  ssl: { rejectUnauthorized: false },
});

export const db = drizzle(sql, { schema });
