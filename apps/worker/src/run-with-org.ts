/**
 * Design §9.2 / §11 — worker DB access under app.org_id (RLS).
 *
 * Pin resolve and outbox writes use short `withOrgConnection` transactions.
 * LangGraph invoke is intentionally outside those txs (HTTP / long work).
 * Checkpointer still uses the shared pool (D5: service-role schema).
 */

import type { Pool } from "pg";
import { withOrgConnection } from "@tekisho/orchestrator/src/db/with-org-connection.js";
import type { GraphCompiler } from "@tekisho/orchestrator/src/graphs/compiler.js";
import type { WorkflowRunner } from "@tekisho/orchestrator/src/workflow/runner.js";
import type { EventInput, WorkflowResult } from "@tekisho/orchestrator/src/types.js";
import { resolveDurablePin } from "./version-pin.js";

export async function runWorkflowWithOrgContext(args: {
  pool: Pool;
  compiler: GraphCompiler;
  runner: WorkflowRunner;
  bossJobId: string;
  workflowName: string;
  event: EventInput;
  payloadPin?: { graphKey?: string; graphVersion?: number };
}): Promise<WorkflowResult & { graphKey: string; graphVersion: number }> {
  const { pool, compiler, runner, bossJobId, workflowName, event, payloadPin } =
    args;

  const pin = await withOrgConnection(pool, event.organization_id, (client) =>
    resolveDurablePin(client, {
      bossJobId,
      graphKey: payloadPin?.graphKey ?? workflowName,
      organizationId: event.organization_id,
      payloadPin,
      resolveActiveVersion: (gk, org) => compiler.resolveActiveVersion(gk, org),
    }),
  );

  const result = await runner.executeWorkflow(
    pin.graphKey,
    event,
    bossJobId,
    pin.graphVersion,
  );

  return { ...result, graphKey: pin.graphKey, graphVersion: pin.graphVersion };
}
