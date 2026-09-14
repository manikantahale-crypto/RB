/**
 * Run one workflow by hand, exactly the way the worker runs it.
 *
 * WHY THIS LIVES IN THE WORKER AND NOT IN THE ENGINE.
 *
 * It used to sit in `packages/orchestrator/scripts/`, where it built its
 * compiler with `new GraphCompiler(pool)` — no node registry. That falls back
 * to the engine's built-in nodes, so debugging through it exercised the OLD
 * implementations while the worker in production ran the contract ones. A
 * debugging tool that quietly runs different code than production is worse than
 * no debugging tool: it produces confident, wrong conclusions.
 *
 * The node registry is composed, and the composition root is here in the
 * worker — it is the only place allowed to import both the engine and the
 * module adapters. So anything that wants to run the real system has to be
 * composed here too. Moving the script was the fix; passing the registry from
 * the engine's own folder would have meant the engine importing adapters.
 *
 * It prints the same `[Nodes]` line the worker prints at boot, so you can see
 * which implementation you are about to exercise before it runs.
 *
 * Usage:
 *   npm run manual:run -w @tekisho/worker            # default job id
 *   npm run manual:run -w @tekisho/worker -- <jobId>
 *
 * NOTE: this executes a REAL workflow against whatever database
 * DATABASE_MIGRATOR_URL points at, including any HTTP calls and AI spend the
 * nodes make. It is not a dry run — no such mode exists, by design.
 */
import { sslFor } from "@tekisho/authoring";
import "dotenv/config";
import pg from "pg";
import { SimpleRunbookResolver } from "@tekisho/orchestrator/src/resolver/runbook.js";
import { WorkflowRunner } from "@tekisho/orchestrator/src/workflow/runner.js";
import { GraphCompiler } from "@tekisho/orchestrator/src/graphs/compiler.js";
import { EVENT_TYPES } from "@tekisho/domain";
import type { EventInput } from "@tekisho/orchestrator/src/types.js";
import { composeNodeRegistry, describeNodeRegistry } from "../src/node-registry.js";

async function main() {
  if (!process.env.DATABASE_MIGRATOR_URL) {
    console.error("DATABASE_MIGRATOR_URL environment variable is required");
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_MIGRATOR_URL,
    ssl: sslFor(process.env.DATABASE_MIGRATOR_URL),
  });

  // The same registry the worker runs. Without this the script would silently
  // fall back to the engine's built-in nodes — see the header.
  const compiler = new GraphCompiler(
    pool,
    undefined, // checkpointer — a manual run does not resume
    undefined, // policy — default
    composeNodeRegistry(),
  );
  console.log(`[Nodes] ${describeNodeRegistry()}`);
  await compiler.ensureSchemaAndSeed();

  const resolver = new SimpleRunbookResolver({
    [EVENT_TYPES.JD_RECEIVED]: "syntra.authored",
  });
  const runner = new WorkflowRunner(compiler, pool);

  const jobId = process.argv[2] || "123e4567-e89b-12d3-a456-426614174002";

  const event: EventInput = {
    event_id: "123e4567-e89b-12d3-a456-426614174001",
    event_type: EVENT_TYPES.JD_RECEIVED,
    aggregate_id: jobId,
    aggregate_type: "requirement",
    organization_id: "2b8e12b3-1745-4ae9-902c-5a249c28ba94",
    correlation_id: "123e4567-e89b-12d3-a456-426614174003",
    payload: { jobId },
  };

  console.log("Resolving workflow for event...");
  const workflowName = resolver.resolve(event.event_type, {
    organization_id: event.organization_id,
    payload: event.payload,
  });

  console.log(`Executing workflow: ${workflowName} (graph from DB)...`);
  try {
    const result = await runner.executeWorkflow(workflowName, event);
    console.log(
      "Workflow executed successfully. Result:",
      JSON.stringify(result, null, 2),
    );
  } catch (error) {
    console.error("Workflow execution failed:", error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
