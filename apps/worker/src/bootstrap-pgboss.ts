import * as PgBossModule from "pg-boss";
import { env } from "./env.js";
import pg from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { WorkflowRunner } from "@tekisho/orchestrator/src/workflow/runner.js";
import { GraphCompiler } from "@tekisho/orchestrator/src/graphs/compiler.js";
import type { EventEnvelope } from "@tekisho/domain";
import type { EventInput } from "@tekisho/orchestrator/src/types.js";
import {
  DISPATCH_QUEUE,
  planForEvent,
} from "@tekisho/orchestrator/src/routing/table.js";
import {
  ensureEventBindingsSchema,
  resolveActiveEventBinding,
  withPgRetry,
  devPoolOpts,
  sslFor,
  type DbQueryable,
} from "@tekisho/authoring";
import { startOutboxRelay } from "./workers/outbox-relay.worker.js";
import { loadEventHandling } from "@tekisho/orchestrator/src/routing/handling-cache.js";
import { loadRoutingTableCache } from "./routing-table-cache.js";
import { startIngressRouter } from "./workers/ingress-router.worker.js";
import { startModuleWorkers } from "./workers/module-execute.worker.js";
import { startResumeThreadWorker } from "./workers/resume-thread.worker.js";
import { handlePlatformDispatchEvent } from "./workers/dispatch-handlers.js";
import { ensureJobPinTable } from "./version-pin.js";
import { ensureIngressEventSchemas } from "./ensure-event-schemas.js";
import { ensureFailedWorkflowsTable } from "@tekisho/orchestrator/src/workflow/failed-workflows.js";
import {
  staleRunSettings,
  startStaleRunSweeper,
} from "@tekisho/orchestrator/src/workflow/stale-runs.js";
import { orchStory } from "@tekisho/orchestrator/src/observability/story-log.js";
import { announceRunFailed } from "@tekisho/orchestrator/src/workflow/announce-failure.js";
import { runWorkflowWithOrgContext } from "./run-with-org.js";
import { composeNodeRegistry, describeNodeRegistry } from "./node-registry.js";

const databaseUrl = new URL(env.DATABASE_MIGRATOR_URL);

console.log("Database connection target:", {
  username: decodeURIComponent(databaseUrl.username),
  passwordLength: decodeURIComponent(databaseUrl.password).length,
  hostname: databaseUrl.hostname,
  port: databaseUrl.port,
  database: databaseUrl.pathname,
});

async function bootstrapPgBoss(): Promise<void> {
  console.log("Starting pg-boss bootstrap (ingress + router + modules)...");

  const boss = new PgBossModule.PgBoss({
    connectionString: env.DATABASE_MIGRATOR_URL,
    schema: "pgboss",
    ssl: sslFor(env.DATABASE_MIGRATOR_URL),
    max: 1,
  });

  boss.on("error", (error: unknown) => {
    console.error("[Dispatcher] pg-boss error:", error);
  });

  await withPgRetry("worker pg-boss", () => boss.start());
  console.log("pg-boss started (schema ready)");

  const pool = new pg.Pool(devPoolOpts(env.DATABASE_MIGRATOR_URL, 1));
  // Idle/dropped clients emit 'error' on Client; without this Node exits.
  pool.on("error", (error: Error) => {
    console.error("[Dispatcher] pg pool error:", error.message);
  });
  pool.on("connect", (client) => {
    client.on("error", (error: Error) => {
      console.error("[Dispatcher] pg client error:", error.message);
    });
  });

  const checkpointer = new PostgresSaver(pool, undefined, {
    schema: "langgraph",
  });
  await withPgRetry("worker checkpointer", () => checkpointer.setup());

  // The composition root supplies the nodes; the engine only defines the shape.
  const compiler = new GraphCompiler(
    pool,
    checkpointer,
    undefined, // policy — default
    composeNodeRegistry(),
  );
  console.log(`[Nodes] ${describeNodeRegistry()}`);
  await withPgRetry("worker graph seed", () => compiler.ensureSchemaAndSeed());
  await withPgRetry("worker run_failures", () =>
    ensureFailedWorkflowsTable(pool),
  );

  // What the platform does with each event — from authoring.event_catalog
  // rather than the map compiled into the engine. Without this the worker
  // still runs, on the hardcoded 26 entries, which is what it did before.
  //
  // Refreshed on a timer so an event registered through the authoring screens
  // starts routing without a restart. Five minutes is a compromise: shorter is
  // a pointless query, longer makes "I registered it and nothing happened" a
  // support conversation.
  const knownEvents = await loadEventHandling(pool);
  console.log(
    knownEvents > 0
      ? `[Routing] ${knownEvents} events from authoring.event_catalog`
      : "[Routing] catalogue unavailable — falling back to the compiled event map",
  );
  const handlingRefresh = setInterval(() => {
    void loadEventHandling(pool);
  }, 5 * 60 * 1000);
  handlingRefresh.unref();

  // Which workflows answer each event. Until this loads the router uses the
  // single-binding lookup it always did, so a slow or unreachable database
  // delays fan-out rather than stopping routing.
  const routing = await loadRoutingTableCache(pool);
  console.log(
    `[Routing] ${routing.entries} active bindings` +
      (routing.dropped > 0 ? ` (${routing.dropped} ignored — no workflow)` : ""),
  );
  const routingRefresh = setInterval(() => {
    void loadRoutingTableCache(pool);
  }, 5 * 60 * 1000);
  routingRefresh.unref();
  await withPgRetry("worker job_pin", () => ensureJobPinTable(pool));
  await withPgRetry("worker ingress schemas", () =>
    ensureIngressEventSchemas(pool),
  );
  await withPgRetry("worker event bindings", () =>
    ensureEventBindingsSchema(pool),
  );
  const runner = new WorkflowRunner(compiler, pool);

  // Runs whose worker died stop beating (orch.runs.heartbeat_at, written by
  // the compiler while a node runs). This fails them after a silence, so the
  // runs screen says "abandoned" rather than "in progress" for ever. First
  // sweep is immediate: a restart after a crash is when there is one to find.
  const stale = staleRunSettings(process.env);
  const staleSweeper = startStaleRunSweeper({
    db: pool,
    ...stale,
    onSwept: (runs) => {
      for (const r of runs) {
        orchStory(
          "SWEEP",
          `${r.graph_key}  run=${r.id}  silent since ${r.silent_since} — FAILED (stale)`,
        );
        // A swept run is a lost run: announce it like any other, so the
        // retry workflow can decide. Needs the trigger and the correlation;
        // a row without them (a manual run) is failed and left there.
        if (r.trigger_event_id && r.correlation_id) {
          void announceRunFailed(pool, {
            runId: r.id,
            organizationId: r.organization_id,
            graphKey: r.graph_key,
            correlationId: r.correlation_id,
            triggerEventId: r.trigger_event_id,
            errorClass: "transient",
            errorMessage: `STALE_RUN: no heartbeat since ${r.silent_since}`,
            failedNode: null,
          }).catch((err) =>
            console.warn(
              `[Sweeper] could not announce swept run ${r.id}:`,
              err instanceof Error ? err.message : err,
            ),
          );
        }
      }
    },
    onError: (err) =>
      console.warn(
        "[Sweeper] stale-run sweep failed:",
        err instanceof Error ? err.message : err,
      ),
  });
  console.log(
    `[Sweeper] stale runs failed after ${stale.staleAfterMs}ms of silence, checked every ${stale.sweepEveryMs}ms`,
  );

  await startIngressRouter({ boss, compiler, pool });
  await startModuleWorkers({ boss, pool, compiler, runner });
  await startResumeThreadWorker({ boss, runner });

  const resolveGraphKey = async (
    eventType: string,
    organizationId?: string,
    db: DbQueryable = pool,
  ) => {
    const binding = await resolveActiveEventBinding(
      db,
      eventType,
      organizationId,
    );
    return binding?.graph_key ?? null;
  };

  const stopOutboxRelay = await startOutboxRelay({
    boss,
    pool,
    resolvePin: async (eventType, organizationId, db) => {
      // The binding already answers half of this. A pinned binding names the
      // version it wants; an unpinned one follows whichever version is live,
      // and only then is a second query needed.
      const binding = await resolveActiveEventBinding(
        db,
        eventType,
        organizationId,
      );
      if (!binding) return null;
      const graphKey = binding.graph_key;

      if (Number.isFinite(Number(binding.version))) {
        return { graphKey, graphVersion: Number(binding.version) };
      }

      // Query on the same TX client — pool.max is 1, so compiler.resolveActiveVersion
      // would block waiting for this connection to be released.
      //
      // Reads authoring directly. This said `public.graph_definitions` with
      // `status = 'active'`, which is a compatibility VIEW that exists only in
      // the old database — in a project built from the new baseline there is
      // nothing in `public` at all, so every pin resolved to null and every
      // relayed event ran unpinned.
      const { rows } = await db.query(
        `SELECT v.version
           FROM authoring.graph_versions v
           JOIN authoring.graphs g ON g.id = v.graph_id
          WHERE g.graph_key = $1
            AND v.status = 'live'
            AND (v.org_id = $2 OR v.org_id IS NULL)
          ORDER BY v.org_id NULLS LAST, v.version DESC
          LIMIT 1`,
        [graphKey, organizationId],
      );
      const graphVersion = Number(
        (rows[0] as { version?: number } | undefined)?.version,
      );
      if (!Number.isFinite(graphVersion)) return null;
      return { graphKey, graphVersion };
    },
  });

  console.log(`Listening for ${DISPATCH_QUEUE} events...`);
  await boss.createQueue(DISPATCH_QUEUE);

  await boss.work(DISPATCH_QUEUE, async (jobs: any) => {
    for (const job of jobs) {
      const envelope = job.data as EventEnvelope & {
        __graphKey?: string;
        __graphVersion?: number;
      };

      console.log(
        `[Dispatcher] Received event: ${envelope.event_type} (ID: ${envelope.event_id})`,
      );

      try {
        const plan = planForEvent(envelope.event_type);

        if (plan.kind !== "graph") {
          await handlePlatformDispatchEvent({ boss, pool, envelope });
          continue;
        }

        const workflowName =
          envelope.__graphKey ??
          (await resolveGraphKey(
            envelope.event_type,
            envelope.organization_id,
          ));
        if (!workflowName) {
          console.log(
            `[Dispatcher] no graph for ${envelope.event_type} — acking`,
          );
          continue;
        }

        const eventInput: EventInput = {
          event_id: envelope.event_id,
          event_type: envelope.event_type,
          aggregate_id: envelope.aggregate.id,
          aggregate_type: envelope.aggregate.type,
          organization_id: envelope.organization_id,
          correlation_id: envelope.correlation_id,
          payload: envelope.payload_ref as Record<string, unknown>,
        };

        const result = await runWorkflowWithOrgContext({
          pool,
          compiler,
          runner,
          bossJobId: String(job.id),
          workflowName,
          event: eventInput,
          payloadPin: {
            graphKey: envelope.__graphKey,
            graphVersion: envelope.__graphVersion,
          },
        });

        if (result.status === "FAILED") {
          console.error(`[Dispatcher] Workflow failed: ${result.error}`);
          throw new Error(result.error);
        }

        console.log(
          `[Dispatcher] Workflow ${result.graphKey}@${result.graphVersion} → ${result.status}`,
        );
      } catch (error) {
        console.error(`[Dispatcher] Error processing job ${job.id}:`, error);
        throw error;
      }
    }
  });

  if (process.env.ENABLE_SYNTRA_BRIDGE === "1") {
    console.error(
      "[Bootstrap] ENABLE_SYNTRA_BRIDGE is removed. Point Syntra at ORCH_API_URL → POST /v1/events.",
    );
  } else {
    console.log(
      "[Bootstrap] Front door only — Syntra must set ORCH_API_URL → POST /v1/events (no jd.uploaded bridge).",
    );
  }
  console.log("");
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  ORCHESTRATION LOGS — watch this terminal on UI actions");
  console.log("  Flow: [Orch] RELAY → EVENT → ROUTE → RUN → TOOL → NODE → DONE");
  console.log("  Upload JD/resume or Quick Match to trigger events.");
  console.log("══════════════════════════════════════════════════════════════");
  console.log("");

  /**
   * STOPPING WITHOUT LEAVING WORK IN LIMBO.
   *
   * `boss.stop()` is already the careful part: pg-boss waits up to 30s for
   * handlers in flight and then calls `failWip()`, which fails whatever is
   * still active with "pg-boss shut down while active" so the next start
   * retries it rather than finding it stuck. None of that happens if this
   * function is never reached, or never finishes, and there were three ways
   * it was not:
   *
   *   1. ONLY SIGINT AND SIGTERM WERE HANDLED. On Windows, closing the console
   *      window raises SIGHUP and Ctrl+Break raises SIGBREAK; neither was
   *      listened for, so the process died with jobs held. Two are sitting in
   *      `active` right now from exactly that, waiting for a supervisor that
   *      only runs while a worker is up.
   *   2. A SECOND Ctrl-C STARTED A SECOND SHUTDOWN, racing the first through
   *      `boss.stop()` and `pool.end()`.
   *   3. ANYTHING THROWING SKIPPED `process.exit`. `pool.end()` on a dropped
   *      connection rejects; the handler rejected with it, the process stayed
   *      up with its workers already stopped, and the next Ctrl-C was the one
   *      that killed it — ungracefully.
   *
   * So: once only, every signal, always exits, never hangs. The hard timeout
   * is longer than pg-boss's own 30s grace, so it is a backstop for a wedged
   * shutdown rather than a shorter deadline competing with it.
   */
  const HARD_EXIT_MS = 45_000;
  let stopping = false;

  const shutdown = async (signal: string) => {
    if (stopping) {
      console.log(`\n${signal} again — exiting now.`);
      process.exit(1);
    }
    stopping = true;
    console.log(`\nShutting down dispatcher (${signal})…`);

    const hardExit = setTimeout(() => {
      console.error(
        `Shutdown took longer than ${HARD_EXIT_MS / 1000}s — exiting anyway. ` +
          `Anything still active is reclaimed by the next worker's supervisor.`,
      );
      process.exit(1);
    }, HARD_EXIT_MS);
    // Not itself a reason to stay alive if everything else finishes first.
    hardExit.unref();

    /** Reported and survived, so one failure cannot skip the steps after it. */
    const step = async (what: string, fn: () => Promise<unknown> | unknown) => {
      try {
        await fn();
      } catch (error) {
        console.error(`  ${what} failed during shutdown:`, error);
      }
    };

    clearInterval(handlingRefresh);
    clearInterval(routingRefresh);
    await step("stale-run sweeper", () => staleSweeper.stop());
    await step("outbox relay", () => stopOutboxRelay());
    // The one that matters: finishes or fails whatever is mid-flight.
    await step("pg-boss", () => boss.stop());
    await step("database pool", () => pool.end());

    console.log("Stopped cleanly.");
    process.exit(0);
  };

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
    // SIGBREAK exists only on Windows and SIGHUP only where there is a console
    // to hang up; registering one the platform lacks throws.
    try {
      process.on(signal, () => void shutdown(signal));
    } catch {
      /* not available on this platform */
    }
  }

  /**
   * A worker meant to be left running must not die quietly.
   *
   * Without these an unhandled rejection takes the process down with a bare
   * stack trace and no shutdown at all — jobs held, nothing said. Logged, and
   * for a genuinely broken process, shut down properly, so the next start
   * finds a queue it can reclaim rather than one it has to wait out.
   */
  process.on("unhandledRejection", (reason) => {
    console.error("[Dispatcher] unhandled rejection:", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("[Dispatcher] uncaught exception:", error);
    void shutdown("uncaughtException");
  });
}

bootstrapPgBoss().catch((error: unknown) => {
  console.error("pg-boss bootstrap failed:", error);
  process.exitCode = 1;
});
