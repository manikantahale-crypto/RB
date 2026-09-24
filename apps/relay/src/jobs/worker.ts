import dotenv from 'dotenv';
import { resolve, dirname, join } from 'node:path';
import { processEmail } from '../agent/inboxAgent';

const rootEnv = join(resolve(dirname(__dirname), '..', '..', '..'), '.env');
dotenv.config({ path: rootEnv });

const { getBoss } = require(resolve(__dirname, '../../../../node-api/src/config/queue'));

// Single canonical PgBoss proxy - zero second PgBoss instances created
export const boss: any = new Proxy({} as any, {
  get(_target, prop) {
    const b = getBoss();
    const val = (b as any)[prop];
    return typeof val === 'function' ? val.bind(b) : val;
  },
});

function emailPayloadFromJob(job: any) {
  if (!job) return null;
  if (job.data && typeof job.data === 'object') return job.data;
  if (job.fromEmail) return job;
  return null;
}

export async function initWorker(bossInstance?: any) {
  const b = bossInstance || getBoss();
  try { await b.createQueue('process-email'); } catch (e) { }
  await b.work('process-email', { batchSize: 3, concurrency: 3 }, async (jobs: any) => {
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
  const b = getBoss();
  const priority = options.priority ?? (emailData?.direction === 'received' ? 10 : 1);
  try {
    await b.createQueue('process-email');
  } catch (e) { }
  await b.send('process-email', emailData, { priority });
}

export async function scheduleJob(queueName: string, cron: string) {
  const b = getBoss();
  await b.schedule(queueName, cron);
}

export async function registerRelayWorkers(bossInstance: any, log?: any) {
  const b = bossInstance || getBoss();

  // 1. process-email
  try { await b.createQueue('process-email'); } catch {}
  await b.work('process-email', { batchSize: 3, concurrency: 3 }, async (jobs: any) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of batch) {
      const emailData = emailPayloadFromJob(job);
      if (!emailData?.fromEmail) {
        console.warn(`Skipping process-email job ${job?.id ?? 'unknown'}: missing email payload`);
        continue;
      }
      const prefix = '[RELAY_WORKER]';
      const msg = `${prefix} processing_job id=${job.id} priority=${job.priority ?? 0} subject="${(emailData.subject || '(no subject)').slice(0, 60)}"`;
      if (log?.info) log.info(msg);
      else console.log(msg);
      try {
        await processEmail(emailData);
      } catch (error) {
        console.error('Failed to process email:', error);
        throw error;
      }
    }
  });

  // 2. sla-sweeper
  try { await b.createQueue('sla-sweeper'); } catch {}
  await b.schedule('sla-sweeper', '*/30 * * * *');
  await b.work('sla-sweeper', async (jobs: unknown) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    if (batch.length) {
      const { sweepSLA } = await import('../followups/slaSweeper');
      await sweepSLA();
    }
  });

  // 3. consent-timeout-sweeper
  try { await b.createQueue('consent-timeout-sweeper'); } catch {}
  await b.schedule('consent-timeout-sweeper', '*/15 * * * *');
  await b.work('consent-timeout-sweeper', async (jobs: unknown) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    if (batch.length) {
      const { sweepConsentTimeouts } = await import('../followups/consentTimeoutSweeper');
      await sweepConsentTimeouts();
    }
  });

  // 4. mailbox-sync
  const imapOn = String(process.env.IMAP_POLL_ENABLED || '').toLowerCase() === 'true';
  if (imapOn) {
    try { await b.createQueue('mailbox-sync'); } catch {}
    await b.schedule('mailbox-sync', '*/10 * * * *');
    await b.work('mailbox-sync', async (jobs: unknown) => {
      const batch = Array.isArray(jobs) ? jobs : [jobs];
      if (batch.length) {
        try {
          const { pullMailbox } = await import('../buildRelayApp');
          await pullMailbox(log);
        } catch (err: any) {
          if (log?.warn) log.warn({ err: err?.message || String(err) }, 'Scheduled mailbox sync failed');
          else console.warn('Scheduled mailbox sync failed', err);
        }
      }
    });
  }

  const say = log?.info ? log.info.bind(log) : console.log;
  say('[RELAY] jobs registered on canonical pg-boss: process-email, sla-sweeper, consent-timeout-sweeper' + (imapOn ? ', mailbox-sync' : ''));
}

