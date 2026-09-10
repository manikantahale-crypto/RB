/**
 * Gathering what the platform checks need, in one place.
 *
 * The checks themselves are pure — see `platform-checks.ts` — so the queries
 * live here and both callers use them: `npm run check:platform` on somebody's
 * terminal, and the health screen in the admin. One implementation, so the
 * screen cannot quietly disagree with the script.
 *
 * Every query is a read.
 */
import { MODULES } from "@tekisho/node-contract";
import type { PlatformFacts } from "./platform-checks.js";

import { EVENT_SCHEMAS, GRAPH_DEFINITIONS, GRAPH_EVENT_BINDINGS } from "./authoring-views.js";
type Queryable = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: any[] }>;
};

export async function gatherPlatformFacts(
  pool: Queryable,
  /**
   * How the engine would handle an event with no binding, INJECTED rather than
   * imported.
   *
   * `planForEvent` lives in `@tekisho/orchestrator`, and importing it here
   * would pull the engine's eleven known-debt type errors into admin-api's
   * typecheck — which is a blocking CI step, while the engine's is deliberately
   * not. Five of those errors are duplicate object keys that are there ON
   * PURPOSE, as documented defence against a stale `@tekisho/domain`, so they
   * are not going away.
   *
   * The script at `scripts/platform-checks.mjs` passes it. The admin route does
   * not, and the routing-hazards check then reports "not checked" rather than
   * guessing — which is the same rule every other check here follows.
   */
  planKindOf?: (eventType: string) => string,
): Promise<PlatformFacts> {
  const [bindings, graphs, registry, queues] = await Promise.all([
    pool.query(
      `SELECT event_type, graph_key, module_queue
         FROM ${GRAPH_EVENT_BINDINGS} WHERE status = 'active'`,
    ),
    pool.query(
      `SELECT graph_key, definition FROM ${GRAPH_DEFINITIONS} WHERE status = 'active'`,
    ),
    pool.query(`SELECT key, module, shareable, emits FROM node_registry`),
    /**
     * What each queue is DOING, not what a constant says it should be.
     *
     * The first version compared bindings against a hardcoded list of five
     * queue names copied out of the engine, and called five live bindings dead.
     * All five were false — `module.relay` had completed a job sixteen seconds
     * earlier. A list only says what somebody remembered to type, and it cannot
     * know about a consumer living in another repository.
     */
    pool.query(`
      SELECT name,
             count(*) FILTER (WHERE state = 'created') AS waiting,
             count(*) FILTER (WHERE state = 'active')  AS running,
             EXTRACT(EPOCH FROM (now() - max(completed_on))) AS seconds_since
        FROM pgboss.job
       WHERE name LIKE 'module.%'
       GROUP BY name`),
  ]);

  /**
   * How each event is handled.
   *
   * `event_schemas` has no `handling` column yet, so this falls back to the
   * hardcoded `PLATFORM_EVENT_PLAN` — not as a stand-in for the column, but
   * because it is what the relay and router actually consult when an event has
   * no binding.
   */
  let handlingOf: Map<string, string> | null = null;
  try {
    const h = await pool.query(
      `SELECT event_type, handling FROM ${EVENT_SCHEMAS} WHERE handling IS NOT NULL`,
    );
    handlingOf = new Map(h.rows.map((r: any) => [r.event_type, r.handling]));
  } catch {
    handlingOf = null;
  }
  if ((!handlingOf || handlingOf.size === 0) && planKindOf) {
    handlingOf = new Map(
      bindings.rows.map((r: any) => [r.event_type, planKindOf(r.event_type)]),
    );
  } else if (handlingOf && handlingOf.size === 0) {
    handlingOf = null;
  }

  return {
    bindings: bindings.rows.map((r: any) => ({
      eventType: r.event_type,
      graphKey: r.graph_key,
      moduleQueue: r.module_queue ?? null,
    })),
    graphs: graphs.rows.map((r: any) => {
      const def =
        typeof r.definition === "string" ? JSON.parse(r.definition) : r.definition;
      return {
        graphKey: r.graph_key,
        impls: ((def?.nodes ?? []) as Array<{ impl?: string }>)
          .map((n) => String(n?.impl ?? ""))
          .filter(Boolean),
      };
    }),
    registry: registry.rows.map((r: any) => ({
      key: r.key,
      module: r.module,
      shareable: r.shareable === true,
      emits: Array.isArray(r.emits) ? r.emits : null,
    })),
    queueActivity: new Map(
      queues.rows.map((r: any) => [
        r.name,
        {
          waiting: Number(r.waiting ?? 0),
          running: Number(r.running ?? 0),
          secondsSinceCompletion:
            r.seconds_since === null || r.seconds_since === undefined
              ? null
              : Number(r.seconds_since),
        },
      ]),
    ),
    /**
     * FROM THE MODULE REGISTRY IN GIT, NOT `SELECT DISTINCT module FROM
     * node_registry`. That column names the module a NODE belongs to, so an
     * application with no declared nodes never appears — RELAY has none, so it
     * did not count as an application and its one real boundary crossing was
     * skipped in silence. Written the wrong way first.
     */
    modules: MODULES,
    handlingOf,
  };
}
