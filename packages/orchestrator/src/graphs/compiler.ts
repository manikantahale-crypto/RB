import { Annotation, StateGraph, type CompiledGraph } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { Pool } from 'pg';
import type { EventInput } from '../types.js';
import { nodeRegistry, type NodeKey } from '../nodes/registry.js';
import type { SyntraGraphState } from '../nodes/types.js';
import { createNodeCtx } from '../nodes/ctx.js';
import { GraphDefinitionSchema, type GraphDefinition } from './definition.js';
import { graphSeedCatalog } from './defs/catalog.js';
import { validateDefinition } from './validate-definition.js';

export { validateDefinition } from './validate-definition.js';
export { checksumOf, defineGraph } from './define-graph.js';

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
});

type Cached = {
  checksum: string;
  version: number;
  graph: CompiledGraph<any, any, any>;
};

/**
 * Loads inert JSON topology from graph_definitions and hydrates it with
 * nodeRegistry implementations (design §7).
 *
 * Matches the live design-doc schema: org_id (text), id (text).
 */
export class GraphCompiler {
  private cache = new Map<string, Cached>();

  constructor(
    private pool: Pool,
    private checkpointer?: BaseCheckpointSaver
  ) {}

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
           ) VALUES ($1, NULL, $2, $3, $4::jsonb, $5, $6, 'def.ts', $7)`,
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
      `[GraphCompiler] graph_definitions ready (${graphSeedCatalog.length} recipe(s) from .def.ts)`
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

    for (const node of def.nodes) {
      const factory = nodeRegistry[node.impl as NodeKey];
      const impl = factory();
      const config = node.config ?? {};

      builder = builder.addNode(node.id, async (state: SyntraGraphState) => {
        const orgId = state.trigger_event?.organization_id ?? '';
        const { ctx, drainEvents } = createNodeCtx({
          orgId,
          config,
          nodeId: node.id,
          pool: this.pool,
        });
        const patch = await impl(state, ctx);
        const viaCtx = drainEvents();
        if (viaCtx.length === 0) return patch;
        return {
          ...patch,
          _emittedEvents: [...(patch._emittedEvents ?? []), ...viaCtx],
        };
      });
    }

    for (const [from, to] of def.edges) {
      builder = builder.addEdge(from, to);
    }

    return this.checkpointer
      ? builder.compile({ checkpointer: this.checkpointer })
      : builder.compile();
  }
}
