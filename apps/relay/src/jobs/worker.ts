import PgBoss from 'pg-boss';
import dotenv from 'dotenv';
import { resolve, dirname, join } from 'node:path';
import { processEmail } from '../agent/inboxAgent';

const rootEnv = join(resolve(dirname(__dirname), '..', '..', '..'), '.env');
dotenv.config({ path: rootEnv });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is missing in environment variables');
}

const { PgBoss: PgBossConstructor } = require('pg-boss');
// Supavisor ≈15 usable slots. No CI/CD here — rolling/blue-green overlap doubles pg-boss clients.
const relayPgBossMax = Math.max(1, parseInt(process.env.DEV_PG_POOL_MAX || '1', 10));
export const boss = new PgBossConstructor({
  connectionString,
  schema: 'pgboss',
  ssl: { rejectUnauthorized: false },
  max: relayPgBossMax,
});

boss.on('error', (error: any) => console.error('pg-boss error:', error));

function emailPayloadFromJob(job: any) {
  if (!job) return null;
  if (job.data && typeof job.data === 'object') return job.data;
  if (job.fromEmail) return job;
  return null;
}

export async function initWorker() {
  await boss.start();

  console.log('pg-boss started');

  // Job to process incoming email
  try { await boss.createQueue('process-email'); } catch (e) { }
  await boss.work('process-email', { batchSize: 3, concurrency: 3 }, async (jobs: any) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of batch) {
      const emailData = emailPayloadFromJob(job);
      if (!emailData?.fromEmail) {
        console.warn(`Skipping process-email job ${job?.id ?? 'unknown'}: missing email payload`);
        continue;
      }
      console.log(
        `[INFO] [RELAY_WORKER] processing_job id=${job.id} priority=${job.priority ?? 0} subject="${(emailData.subject || '(no subject)').slice(0, 60)}"`
      );
      try {
        await processEmail(emailData);
      } catch (error) {
        console.error('Failed to process email:', error);
        throw error;
      }
    }
  });
}

export async function queueEmailForProcessing(emailData: any, options: { priority?: number } = {}) {
  const priority = options.priority ?? (emailData?.direction === 'received' ? 10 : 1);
  try {
    await boss.createQueue('process-email');
  } catch (e) { }
  await boss.send('process-email', emailData, { priority });
}

export async function scheduleJob(queueName: string, cron: string) {
  await boss.schedule(queueName, cron);
}
