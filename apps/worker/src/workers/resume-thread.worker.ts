import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import type { WorkflowRunner } from '@tekisho/orchestrator/src/workflow/runner.js';
import { RESUME_THREAD_QUEUE } from '@tekisho/orchestrator/src/routing/table.js';

export type ResumeThreadJob = {
  thread_id: string;
  graph_key: string;
  graph_version?: number;
  organization_id: string;
  decision: unknown;
};

/** Design §9.2 — resume parked human.gate threads. */
export async function startResumeThreadWorker(args: {
  boss: PgBoss;
  runner: WorkflowRunner;
}): Promise<void> {
  const { boss, runner } = args;
  await boss.createQueue(RESUME_THREAD_QUEUE);

  await boss.work(RESUME_THREAD_QUEUE, async (jobs: any[]) => {
    for (const job of jobs) {
      const data = job.data as ResumeThreadJob;
      console.log(
        `[ResumeThread] ${data.thread_id} graph=${data.graph_key}`,
      );
      const result = await runner.resumeThread({
        graphKey: data.graph_key,
        organizationId: data.organization_id,
        threadId: data.thread_id,
        decision: data.decision,
        graphVersion: data.graph_version,
      });
      if (result.status === 'FAILED') {
        throw new Error(result.error);
      }
      console.log(
        `[ResumeThread] → ${result.status} thread=${result.threadId}`,
      );
    }
  });

  console.log(`Resume-thread worker listening on ${RESUME_THREAD_QUEUE}`);
}

export async function enqueueResumeThread(
  boss: PgBoss,
  job: ResumeThreadJob,
): Promise<void> {
  await boss.createQueue(RESUME_THREAD_QUEUE);
  await boss.send(RESUME_THREAD_QUEUE, job);
}

// pool kept for future RLS probes
export type _Pool = Pool;
