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
import { graphSeedCatalog } from './catalog.js';
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
 * Loads inert JSON topology from graph_definitions and hydrates it with
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
   * Ensure table exists and seed recipes from git-authored `.def.ts` catalog
   * (design §8 — git is authoring source; DB is runtime store).
   */
  async ensureSchemaAndSeed(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS graph_definitions (
        id            text PRIMARY KEY,
        org_id        text,
        graph_key     text NOT NULL,
        version       int  NOT NULL,
        definition    jsonb NOT NULL,
        checksum      text NOT NULL,
        status        text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'active', 'retired')),
        created_by    text NOT NULL DEFAULT 'seed',
        created_at    timestamptz NOT NULL DEFAULT now(),
        activated_at  timestamptz
      )
    `);

    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS graph_definitions_key_version_scope
        ON graph_definitions (graph_key, version, COALESCE(org_id, '~global~'));
      CREATE UNIQUE INDEX IF NOT EXISTS graph_definitions_one_active
        ON graph_definitions (graph_key, COALESCE(org_id, '~global~'))
        WHERE status = 'active';
    `);

    for (const s of graphSeedCatalog) {
      const key = s.definition.graphKey;
      const defJson = JSON.stringify(s.definition);

      const updated = await this.pool.query(
        `UPDATE graph_definitions
         SET definition = $1::jsonb,
             checksum = $2,
             status = $3,
             activated_at = CASE
               WHEN $3 = 'active' THEN COALESCE(activated_at, now())
               ELSE activated_at
             END
         WHERE graph_key = $4 AND version = $5 AND org_id IS NULL`,
        [defJson, s.checksum, s.status, key, s.version]
      );

      if ((updated.rowCount ?? 0) === 0) {
        await this.pool.query(
          `INSERT INTO graph_definitions (
             id, org_id, graph_key, version, definition, checksum, status, created_by, activated_at
           ) VALUES ($1, NULL, $2, $3, $4::jsonb, $5, $6, 'catalog.ts', $7)`,
          [
            s.id,
            key,
            s.version,
            defJson,
            s.checksum,
            s.status,
            s.status === 'active' ? new Date() : null,
          ]
        );
      }
    }

    console.log(
      `[GraphCompiler] graph_definitions ready (${graphSeedCatalog.length} recipe(s) from catalog.ts)`
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
          ? `DEFINITION_INVALID: no graph_definitions for ${graphKey} version ${pinnedVersion}`
          : `DEFINITION_INVALID: no active graph_definitions for ${graphKey}`
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
      throw new Error(`DEFINITION_INVALID: no active graph_definitions for ${graphKey}`);
    }
    return row.version;
  }

  /** True when an active graph_definitions row exists for this key (+ org). */
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
        `DEFINITION_INVALID: no graph_definitions for ${graphKey}`,
      );
    }
    const def = GraphDefinitionSchema.parse(row.definition);
    validateDefinition(def);
    return def;
  }

  private async loadActive(
    graphKey: string,
    organizationId: string | null
  ): Promise<{ version: number; checksum: string; definition: unknown } | null> {
    const { rows } = await this.pool.query(
      `SELECT version, checksum, definition
       FROM graph_definitions
       WHERE graph_key = $1
         AND status = 'active'
         AND (org_id = $2 OR org_id IS NULL)
       ORDER BY org_id NULLS LAST
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
    const { rows } = await this.pool.query(
      `SELECT version, checksum, definition
       FROM graph_definitions
       WHERE graph_key = $1
         AND version = $3
         AND (org_id = $2 OR org_id IS NULL)
       ORDER BY org_id NULLS LAST
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

          const patch = await impl(state, ctx);
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
