import 'dotenv/config';
import pg from 'pg';
import { SimpleRunbookResolver } from '../src/resolver/runbook.js';
import { WorkflowRunner } from '../src/workflow/runner.js';
import { GraphCompiler } from '../src/graphs/compiler.js';
import { EVENT_TYPES } from '@tekisho/domain';
import type { EventInput } from '../src/types.js';

async function main() {
  if (!process.env.DATABASE_MIGRATOR_URL) {
    console.error('DATABASE_MIGRATOR_URL environment variable is required');
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_MIGRATOR_URL,
    ssl: { rejectUnauthorized: false },
  });

  const compiler = new GraphCompiler(pool);
  await compiler.ensureSchemaAndSeed();

  const resolver = new SimpleRunbookResolver({
    [EVENT_TYPES.JD_RECEIVED]: 'syntra.jd.workflow',
  });
  const runner = new WorkflowRunner(compiler, pool);

  const jobId = process.argv[2] || '123e4567-e89b-12d3-a456-426614174002';

  const event: EventInput = {
    event_id: '123e4567-e89b-12d3-a456-426614174001',
    event_type: EVENT_TYPES.JD_RECEIVED,
    aggregate_id: jobId,
    aggregate_type: 'requirement',
    organization_id: '2b8e12b3-1745-4ae9-902c-5a249c28ba94',
    correlation_id: '123e4567-e89b-12d3-a456-426614174003',
    payload: { jobId },
  };

  console.log('Resolving workflow for event...');
  const workflowName = resolver.resolve(event.event_type, {
    organization_id: event.organization_id,
    payload: event.payload,
  });

  console.log(`Executing workflow: ${workflowName} (graph from DB)...`);
  try {
    const result = await runner.executeWorkflow(workflowName, event);
    console.log('Workflow executed successfully. Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Workflow execution failed:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
