/**
 * Design D3 — pin the graph version for the life of a pg-boss job.
 *
 * A job that retries must run the version it started on. If somebody activates
 * a new version between attempt one and attempt two, the retry has to be the
 * same workflow it was the first time, or a run means two different things
 * depending on when you look at it.
 *
 * THE PIN IS THE RUN NOW, NOT A TABLE ABOUT THE RUN
 *
 * `public.orchestration_job_pins` existed only because a run could not name
 * the version it was running. It can: `orch.runs.graph_version` is stamped
 * when the run starts, and `langgraph_thread_id` is `<org>:<bossJobId>` — the
 * same job identity the pin table keyed on.
 *
 * Checked against production before switching: for all 1,800 rows where both
 * the pin table and the run carry a version, they agree on the version AND the
 * graph key, 1,800 out of 1,800. The table was a second copy of a fact the run
 * already held.
 *
 * It is no longer written or read. It is not dropped — other people may still
 * be reading it, and its 11,604 rows key on boss_job_id, which is exactly why
 * they could never be joined back to a run and migrated.
 *
 * ONE NARROW DIFFERENCE, WRITTEN DOWN RATHER THAN GLOSSED
 *
 * The old pin row was inserted before the run existed, so a retry found it
 * even if attempt one died before creating its run. Reading the run instead
 * means that case re-resolves the active version. It needs a failure between
 * pin and run creation AND an activation before the retry — and the payload
 * stamp, which the relay sets and which is preferred over everything here,
 * covers the path this is most likely on.
 */

import type { DbQueryable } from "@tekisho/orchestrator/src/db/with-org-connection.js";

export type GraphPin = {
  graphKey: string;
  graphVersion: number;
};

/**
 * Check the runs table is there. It is built by packages/db/migrations.
 *
 * Named for what it now guards. The worker used to assert a pin table here;
 * it asserts the thing that replaced it.
 */
export async function ensureJobPinTable(db: DbQueryable): Promise<void> {
  const { rows } = await db.query<{ present: boolean }>(
    `SELECT to_regclass('orch.runs') IS NOT NULL AS present`,
  );
  if (!rows[0]?.present) {
    throw new Error(
      "[worker] orch.runs is missing. Apply packages/db/migrations before " +
        "starting the worker.",
    );
  }
}

/**
 * Resolve the pin for a job: payload stamp → the version a previous attempt
 * ran → the version that is live now.
 */
export async function resolveDurablePin(
  db: DbQueryable,
  args: {
    bossJobId: string;
    graphKey: string;
    organizationId: string;
    payloadPin?: { graphKey?: string; graphVersion?: number };
    resolveActiveVersion: (graphKey: string, orgId: string) => Promise<number>;
  },
): Promise<GraphPin> {
  const fromPayload = args.payloadPin?.graphVersion;
  const payloadKey = args.payloadPin?.graphKey ?? args.graphKey;

  // The relay stamped it at enqueue. Nothing later gets to disagree.
  if (typeof fromPayload === "number" && Number.isFinite(fromPayload)) {
    return { graphKey: payloadKey, graphVersion: fromPayload };
  }

  /**
   * Did an earlier attempt of this same job already decide?
   *
   * `langgraph_thread_id` is composed as `<org>:<bossJobId>` by the runner, so
   * every attempt of one job shares it. Newest first, because a job that has
   * run more than once should be pinned to what it ran, and the most recent
   * attempt is the one whose version the retry is continuing.
   */
  const prior = await db.query<{ graph_key: string; graph_version: number }>(
    `SELECT graph_key, graph_version
       FROM orch.runs
      WHERE langgraph_thread_id = $1
        AND graph_version IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [`${args.organizationId}:${args.bossJobId}`],
  );
  if (prior.rows[0]) {
    return {
      graphKey: prior.rows[0].graph_key,
      graphVersion: Number(prior.rows[0].graph_version),
    };
  }

  // First attempt. Whatever is live now is what this job is pinned to, and the
  // run about to be created records it.
  const graphVersion = await args.resolveActiveVersion(
    args.graphKey,
    args.organizationId,
  );
  return { graphKey: args.graphKey, graphVersion };
}
