import { Annotation, StateGraph, type CompiledGraph, isGraphInterrupt } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { Pool } from 'pg';
import type { EventInput } from '../types.js';
import { nodeRegistry, type NodeRegistry } from '../nodes/registry.js';
import type { SyntraGraphState } from '../nodes/types.js';
import { createNodeCtx } from '../nodes/ctx.js';
import {
  GraphDefinitionSchema,
  type GraphDefinition,
  validateDefinition,
  checksumOf,
  defineGraph,
} from './recipe.js';
import { ROUTER_REGISTRY } from './routers.js';

import { enrichError, type ErrorClass } from '../workflow/errors.js';
import {
  PolicyEngine,
  applyPolicyGate,
  DEFAULT_IMPL_ACTION_CLASS,
  type ActionClass,
} from '../policy/engine.js';
import { recordNodeMetric } from '../observability/metrics.js';
import {
  formatNextPaths,
  formatNodeOut,
  orchStory,
  orchStoryDetail,
} from '../observability/story-log.js';
import { recordAgentStep } from '../workflow/agent-runs.js';
import { withResolvedInputs } from './resolve-inputs.js';

export { validateDefinition, checksumOf, defineGraph } from './recipe.js';

const SyntraState = Annotation.Root({
  result: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => '' }),
  _emittedEvents: Annotation<EventInput[]>({
    reducer: (x, y) => x.concat(y ?? []),
    default: () => [],
  }),
  trigger_event: Annotation<EventInput | null>({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),
  profile: Annotation<import('../nodes/types.js').CandidateProfile | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  matches: Annotation<import('../nodes/types.js').MatchHit[]>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => [],
  }),
  errorsSoft: Annotation<Array<{ nodeId: string; class: ErrorClass; message: string }>>({
    reducer: (x, y) => x.concat(y ?? []),
    default: () => [],
  }),
  /** Audit spine — set by WorkflowRunner when agent_runs insert succeeds. */
  agent_run_id: Annotation<string | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  branch_key: Annotation<string | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  /**
   * THE RUN CONTEXT — what each step produced, filed under its step id.
   *
   * Until now a node's output was thrown away: the contract bridge returned a
   * `result` breadcrumb and nothing else, so step 2 could not use what step 1
   * produced. Three legacy files worked around it by rewriting the trigger
   * payload as they went, which is undeclared and unavailable to contract
   * nodes.
   *
   * Merged rather than replaced, so the context accumulates down the run and a
   * step can read from any earlier one by name: `process.jobId`.
   *
   * WHAT MAY GO IN HERE. A node's DECLARED output, which is disciplined to be
   * keys and small derived values — ids, a status, a score. Never a payload:
   * this channel is checkpointed, and a resume blob in here would sit in
   * checkpoint rows outside the redaction rules each node declares.
   */
  steps: Annotation<Record<string, unknown>>({
    reducer: (x, y) => ({ ...x, ...(y ?? {}) }),
    default: () => ({}),
  }),
});

type Cached = {
  checksum: string;
  version: number;
  graph: CompiledGraph<any, any, any>;
};

function resolveActionClass(
  impl: string,
  config: Record<string, unknown>,
): ActionClass {
  const fromConfig = config.actionClass;
  if (
    fromConfig === 'READ' ||
    fromConfig === 'INTERNAL_WRITE' ||
    fromConfig === 'DATA_SHAPING' ||
    fromConfig === 'CONTROL' ||
    fromConfig === 'EXTERNAL_COMM'
  ) {
    return fromConfig;
  }
  return DEFAULT_IMPL_ACTION_CLASS[impl] ?? 'INTERNAL_WRITE';
}

/**
 * Loads inert JSON topology from authoring.graph_versions and hydrates it with
 * nodeRegistry implementations (design §7).
 *
 * Matches the live design-doc schema: org_id (text), id (text).
 */
export class GraphCompiler {
  private cache = new Map<string, Cached>();
  private policy: PolicyEngine;

  private nodes: NodeRegistry;

  constructor(
    private pool: Pool,
    private checkpointer?: BaseCheckpointSaver,
    policy?: PolicyEngine,
    /**
     * Supplied by the composition root (`apps/worker`), which is the only
     * place allowed to import module adapters. Defaults to the engine's
     * built-in nodes so scripts and tests keep working unchanged.
     */
    nodes?: NodeRegistry,
  ) {
    this.policy = policy ?? new PolicyEngine(pool);
    this.nodes = nodes ?? nodeRegistry;
  }

  /**
   * Check the runtime store is there. Do NOT build it.
   *
   * This used to CREATE TABLE IF NOT EXISTS on every boot, which made the
   * engine a second author of the schema alongside the migrations — and they
   * disagreed. `graph_definitions.id` is text here and was uuid in one of the
   * two files that both claimed V11; whichever ran first won, and nothing
   * reported the difference.
   *
   * The migrations now build the database from empty, checked on every push.
   * A CREATE TABLE IF NOT EXISTS would quietly accept a table it did not
   * create and quietly invent one no migration knows about, which is exactly
   * how a column ends up in production and in no file.
   *
   * The seeding that used to live here is already gone, for a related reason
   * kept below because it is worth not repeating:
   *
   *   The loop wrote the git catalog into graph_definitions on every boot and
   *   forced its own idea of which version was active. That was right when git
   *   was the only author and the database started empty. It stopped being
   *   right: the admin app has written hundreds of versions, migrations
   *   advanced several workflows past the catalog, and the loop tried to
   *   re-activate `duplicate.review` v1 while v2 held the pointer. The
   *   one-active index refused and the worker would not start at all — a
   *   disagreement about one row took down every workflow.
   *
   * Seeding belongs in a migration: applied deliberately, in order, still in
   * git. `R__seed_syntra_graphs.sql` is generated from the same catalog and
   * creates only what is absent. `graphSeedCatalog` stays exported because the
   * generator reads it.
   */
  async ensureSchemaAndSeed(): Promise<void> {
    const { rows } = await this.pool.query<{ missing: string | null }>(
      `SELECT CASE
                WHEN to_regclass('authoring.graphs') IS NULL
                  THEN 'authoring.graphs'
                WHEN to_regclass('authoring.graph_versions') IS NULL
                  THEN 'authoring.graph_versions'
                WHEN NOT EXISTS (
                  SELECT 1 FROM pg_indexes
                   WHERE schemaname = 'authoring'
                     AND indexname = 'graph_versions_one_live_idx')
                  THEN 'graph_versions_one_live_idx'
                ELSE NULL
              END AS missing`,
    );

    const missing = rows[0]?.missing;
    if (missing) {
      throw new Error(
        `[GraphCompiler] ${missing} is missing. The schema comes from ` +
          `packages/db/migrations — apply them before starting the worker, ` +
          `and verify with scripts/rebuild-check.sh.`,
      );
    }

    console.log(
      "[GraphCompiler] authoring.graph_versions ready (built by migration, not at boot)",
    );
  }

  async get(
    graphKey: string,
    organizationId?: string | null,
    pinnedVersion?: number
  ): Promise<CompiledGraph<any, any, any>> {
    const row = pinnedVersion != null
      ? await this.loadVersion(graphKey, organizationId ?? null, pinnedVersion)
      : await this.loadActive(graphKey, organizationId ?? null);
    if (!row) {
      throw new Error(
        pinnedVersion != null
          ? `DEFINITION_INVALID: no version ${pinnedVersion} of ${graphKey}`
          : `DEFINITION_INVALID: no live version of ${graphKey}`
      );
    }

    const cacheKey = `${graphKey}@${row.version}:${row.checksum}`;
    const hit = this.cache.get(cacheKey);
    if (hit) return hit.graph;

    const def = GraphDefinitionSchema.parse(row.definition);
    const graph = this.compile(def);
    this.cache.set(cacheKey, { checksum: row.checksum, version: row.version, graph });
    console.log(`[GraphCompiler] compiled ${graphKey}@${row.version} (${row.checksum})`);
    return graph;
  }

  /** Active version number for pin-at-enqueue / durable pin (design D3). */
  async resolveActiveVersion(
    graphKey: string,
    organizationId?: string | null
  ): Promise<number> {
    const row = await this.loadActive(graphKey, organizationId ?? null);
    if (!row) {
      throw new Error(`DEFINITION_INVALID: no live version of ${graphKey}`);
    }
    return row.version;
  }

  /** True when a live version exists for this key (+ org). */
  async hasActiveDefinition(
    graphKey: string,
    organizationId?: string | null,
  ): Promise<boolean> {
    const row = await this.loadActive(graphKey, organizationId ?? null);
    return row != null;
  }

  /** Parsed recipe for entryInput / stateSchema checks at invoke time. */
  async loadDefinition(
    graphKey: string,
    organizationId?: string | null,
    pinnedVersion?: number,
  ): Promise<GraphDefinition> {
    const row =
      pinnedVersion != null
        ? await this.loadVersion(graphKey, organizationId ?? null, pinnedVersion)
        : await this.loadActive(graphKey, organizationId ?? null);
    if (!row) {
      throw new Error(
        `DEFINITION_INVALID: no definition for ${graphKey}`,
      );
    }
    const def = GraphDefinitionSchema.parse(row.definition);
    validateDefinition(def);
    return def;
  }

  /**
   * The two reads on the run path, against authoring.
   *
   * A workflow's identity and its versions are separate rows now, so both go
   * through the same join. The org rule is unchanged: prefer the tenant's own
   * workflow, fall back to the global one, which is what `ORDER BY org_id
   * NULLS LAST` has always meant here.
   */
  private async loadActive(
    graphKey: string,
    organizationId: string | null
  ): Promise<{ version: number; checksum: string; definition: unknown } | null> {
    const { rows } = await this.pool.query(
      `SELECT v.version, v.checksum, v.definition
       FROM authoring.graph_versions v
       JOIN authoring.graphs g ON g.id = v.graph_id
       WHERE g.graph_key = $1
         AND v.status = 'live'
         AND (g.org_id = $2 OR g.org_id IS NULL)
       ORDER BY g.org_id NULLS LAST
       LIMIT 1`,
      [graphKey, organizationId]
    );
    return rows[0] ?? null;
  }

  private async loadVersion(
    graphKey: string,
    organizationId: string | null,
    version: number
  ): Promise<{ version: number; checksum: string; definition: unknown } | null> {
    // No status filter, deliberately. A run pinned to a version must be able
    // to read it back after that version has been retired — that is the whole
    // point of pinning, and of versions being immutable.
    const { rows } = await this.pool.query(
      `SELECT v.version, v.checksum, v.definition
       FROM authoring.graph_versions v
       JOIN authoring.graphs g ON g.id = v.graph_id
       WHERE g.graph_key = $1
         AND v.version = $3
         AND (g.org_id = $2 OR g.org_id IS NULL)
       ORDER BY g.org_id NULLS LAST
       LIMIT 1`,
      [graphKey, organizationId, version]
    );
    return rows[0] ?? null;
  }

  private compile(def: GraphDefinition): CompiledGraph<any, any, any> {
    validateDefinition(def);

    let builder: any = new StateGraph(SyntraState);
    const graphAgent = def.agentName;
    const pool = this.pool;

    const writeStep = async (
      state: SyntraGraphState,
      nodeId: string,
      implKey: string,
      status: 'OK' | 'FAILED' | 'SKIPPED' | 'RETRIED',
      latencyMs: number,
      outputRef?: Record<string, unknown>,
    ) => {
      const runId = state.agent_run_id;
      const orgId = state.trigger_event?.organization_id;
      if (!runId || !orgId) return;
      await recordAgentStep({
        pool,
        organizationId: orgId,
        runId,
        node: nodeId,
        toolName: implKey,
        status,
        latencyMs,
        outputRef,
      });
    };

    for (const node of def.nodes) {
      const factory = this.nodes[node.impl];
      if (!factory) {
        throw new Error(
          `DEFINITION_INVALID: unknown impl "${node.impl}" — not in the registry ` +
            `supplied to GraphCompiler. If this node was just converted to a ` +
            `contract, add it to the worker's composition.`,
        );
      }
      const impl = factory();
      const config = node.config ?? {};
      const actionClass = resolveActionClass(node.impl, config);
      const agentName =
        (typeof config.agentName === 'string' ? config.agentName : undefined) ??
        graphAgent;

      builder = builder.addNode(node.id, async (state: SyntraGraphState) => {
        const orgId = state.trigger_event?.organization_id ?? '';
        const threadId = state.trigger_event
          ? `${state.trigger_event.organization_id}:${state.trigger_event.event_id}`
          : undefined;
        const started = Date.now();
        const { ctx, drainEvents } = createNodeCtx({
          orgId,
          config,
          nodeId: node.id,
          pool,
        });
        try {
          const decision = await this.policy.evaluate(agentName, actionClass);
          const gate = applyPolicyGate({
            decision,
            state,
            nodeId: node.id,
            impl: node.impl,
          });
          if (!gate.proceed) {
            const durationMs = Date.now() - started;
            recordNodeMetric({
              graphKey: def.graphKey,
              nodeId: node.id,
              impl: node.impl,
              status: 'policy_denied',
              durationMs,
              threadId,
            });
            orchStory(
              'SKIP',
              `agent=${agentName}  node=${node.id}  tool=${node.impl}  policy denied`,
            );
            await writeStep(state, node.id, node.impl, 'SKIPPED', durationMs);
            return gate.patch;
          }

          orchStory(
            'TOOL',
            `agent=${agentName}  node=${node.id}  tool=${node.impl}  graph=${def.graphKey}`,
          );

          /**
           * RESOLVED HERE, NOT IN THE CONTRACT BRIDGE.
           *
           * The bridge only wraps contract nodes, and eleven of the twenty-two
           * are still raw engine functions reading the trigger payload for
           * fields nothing declares. Doing it here means input maps work for
           * every node from the first day, rather than for the half that have
           * been converted.
           *
           * A step with no map gets the state untouched, which is every
           * definition stored before this existed.
           */
          const { state: runState, unresolved } = withResolvedInputs(
            state,
            node.inputs,
          );
          if (unresolved.length > 0) {
            // Not a failure: an optional field whose source did not run is
            // allowed to be absent. A required one fails its own input schema
            // a moment later, with a better message than this could give.
            orchStory(
              'TOOL',
              `node=${node.id}  unresolved input${unresolved.length === 1 ? '' : 's'}: ${unresolved.join(', ')}`,
            );
          }

          const patch = await impl(runState, ctx);
          const viaCtx = drainEvents();
          const durationMs = Date.now() - started;
          const payload = patch.trigger_event?.payload as
            | Record<string, unknown>
            | undefined;
          const branchKey =
            typeof patch.branch_key === 'string' ? patch.branch_key : undefined;
          const outLine = formatNodeOut({
            result: patch.result,
            branchKey,
            confidence: payload?.confidence_score ?? payload?.branch_score,
            isActionable: payload?.is_actionable,
            emitted: viaCtx.map((e) => e.event_type),
          });
          const nextLine = formatNextPaths({
            nodeId: node.id,
            edges: def.edges as Array<[string, string]>,
            conditionalEdges: def.conditionalEdges as
              | Array<{ from: string; map: Record<string, string> }>
              | undefined,
            branchKey,
          });
          recordNodeMetric({
            graphKey: def.graphKey,
            nodeId: node.id,
            impl: node.impl,
            status: 'ok',
            durationMs,
            threadId,
          });
          if (outLine) orchStoryDetail(`out: ${outLine}`);
          if (nextLine) orchStoryDetail(`next: ${nextLine}`);
          await writeStep(state, node.id, node.impl, 'OK', durationMs, {
            emitted: viaCtx.map((e) => e.event_type),
            result: typeof patch.result === 'string' ? patch.result : undefined,
            branch_key: branchKey,
            confidence_score:
              payload?.confidence_score ?? payload?.branch_score,
            is_actionable: payload?.is_actionable,
          });
          if (viaCtx.length === 0) return patch;
          return {
            ...patch,
            _emittedEvents: [...(patch._emittedEvents ?? []), ...viaCtx],
          };
        } catch (err) {
          if (isGraphInterrupt(err)) {
            const viaCtx = drainEvents();
            (err as { __orchEmitted?: typeof viaCtx }).__orchEmitted = viaCtx;
            const durationMs = Date.now() - started;
            recordNodeMetric({
              graphKey: def.graphKey,
              nodeId: node.id,
              impl: node.impl,
              status: 'interrupted',
              durationMs,
              threadId,
            });
            await writeStep(state, node.id, node.impl, 'OK', durationMs, {
              interrupted: true,
            });
            throw err;
          }
          const enriched = enrichError(err, {
            nodeId: node.id,
            graphKey: def.graphKey,
          });
          if (enriched.errorClass === 'permanent-input') {
            const durationMs = Date.now() - started;
            recordNodeMetric({
              graphKey: def.graphKey,
              nodeId: node.id,
              impl: node.impl,
              status: 'soft_error',
              durationMs,
              errorClass: enriched.errorClass,
              threadId,
            });
            await writeStep(state, node.id, node.impl, 'FAILED', durationMs, {
              errorClass: enriched.errorClass,
            });
            orchStoryDetail(`out: error=${enriched.message}`);
            return {
              errorsSoft: [
                {
                  nodeId: node.id,
                  class: enriched.errorClass,
                  message: enriched.message,
                },
              ],
            };
          }
          const durationMs = Date.now() - started;
          recordNodeMetric({
            graphKey: def.graphKey,
            nodeId: node.id,
            impl: node.impl,
            status: 'error',
            durationMs,
            errorClass: enriched.errorClass,
            threadId,
          });
          await writeStep(state, node.id, node.impl, 'FAILED', durationMs, {
            errorClass: enriched.errorClass,
          });
          throw enriched;
        }
      });
    }

    for (const [from, to] of def.edges) {
      builder = builder.addEdge(from, to);
    }

    // Conditional branches — prefer named routers from ROUTER_REGISTRY;
    // keep branch_key fallback for ASTRA Option-B graphs.
    for (const ce of def.conditionalEdges ?? []) {
      const map = { ...ce.map } as Record<string, string>;
      const named = ROUTER_REGISTRY[ce.router];
      const routerFn = named
        ? named
        : (state: { branch_key?: string | null; result?: string }) => {
            // Legacy / ASTRA: router string is the state field (usually branch_key).
            if (ce.router === 'branch_key' || !ce.router) {
              const key = state.branch_key ?? 'reject';
              if (map[key]) return key;
              if (map.default) return 'default';
              if (map.reject) return 'reject';
              return Object.keys(map)[0] ?? 'reject';
            }
            throw new Error(
              `DEFINITION_INVALID: unknown conditional router "${ce.router}"`,
            );
          };
      builder = builder.addConditionalEdges(ce.from, routerFn, map);
    }

    return this.checkpointer
      ? builder.compile({ checkpointer: this.checkpointer })
      : builder.compile();
  }
}
