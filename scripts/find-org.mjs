import pg from "pg";
import { config } from "dotenv";
config();
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  const r = await p.query(`SELECT id::text, name FROM organizations LIMIT 5`);
  console.log(r.rows);
} catch (e) {
  console.log("organizations error:", e.message);
  const t = await p.query(
    `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='event_outbox' AND column_name='organization_id'`,
  );
  console.log(t.rows);
}
await p.end();
