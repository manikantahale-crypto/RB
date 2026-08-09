import { createHash } from 'node:crypto';
import { Annotation, StateGraph, type CompiledGraph } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { Pool } from 'pg';
import type { EventInput } from '../types.js';
import { nodeRegistry, type NodeKey } from '../nodes/registry.js';
import type { NodeCtx, SyntraGraphState } from '../nodes/types.js';
import { GraphDefinitionSchema, type GraphDefinition } from './definition.js';

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

  /** Ensure table exists (design §5.2 shape) and seed Syntra defs. */
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

    // Indexes — ignore if already present under another name.
    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS graph_definitions_key_version_scope
        ON graph_definitions (graph_key, version, COALESCE(org_id, '~global~'));
      CREATE UNIQUE INDEX IF NOT EXISTS graph_definitions_one_active
        ON graph_definitions (graph_key, COALESCE(org_id, '~global~'))
        WHERE status = 'active';
    `);

    const seeds: Array<{ id: string; key: string; def: GraphDefinition; checksum: string }> = [
      {
        id: 'graph_syntra_jd_v1',
        key: 'syntra.jd.workflow',
        checksum: 'seed-syntra-jd-v1',
        def: {
          graphKey: 'syntra.jd.workflow',
          nodes: [{ id: 'process', impl: 'syntra.jd.process' }],
          edges: [
            ['__start__', 'process'],
            ['process', '__end__'],
          ],
        },
      },
      {
        id: 'graph_syntra_resume_v1',
        key: 'syntra.resume.workflow',
        checksum: 'seed-syntra-resume-v1',
        def: {
          graphKey: 'syntra.resume.workflow',
          nodes: [{ id: 'process', impl: 'syntra.resume.process' }],
          edges: [
            ['__start__', 'process'],
            ['process', '__end__'],
          ],
        },
      },
      {
        id: 'graph_syntra_match_v1',
        key: 'syntra.match.workflow',
        checksum: 'seed-syntra-match-v1',
        def: {
          graphKey: 'syntra.match.workflow',
          nodes: [{ id: 'process', impl: 'syntra.match.process' }],
          edges: [
            ['__start__', 'process'],
            ['process', '__end__'],
          ],
        },
      },
    ];

    for (const s of seeds) {
      // Prefer update by natural key — rows may already exist under a different id
      // (constraint: graph_definitions_unique_version).
      const updated = await this.pool.query(
        `UPDATE graph_definitions
         SET definition = $1::jsonb,
             checksum = $2,
             status = 'active',
             activated_at = COALESCE(activated_at, now())
         WHERE graph_key = $3 AND version = 1 AND org_id IS NULL`,
        [JSON.stringify(s.def), s.checksum, s.key]
      );

      if ((updated.rowCount ?? 0) === 0) {
        await this.pool.query(
          `INSERT INTO graph_definitions (
             id, org_id, graph_key, version, definition, checksum, status, created_by, activated_at
           ) VALUES ($1, NULL, $2, 1, $3::jsonb, $4, 'active', 'seed', now())`,
          [s.id, s.key, JSON.stringify(s.def), s.checksum]
        );
      }
    }

    console.log('[GraphCompiler] graph_definitions ready (Syntra JD/resume/match seeded)');
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

  /** Active version number for pin-at-consume (design D3). */
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
        const ctx: NodeCtx = {
          orgId: state.trigger_event?.organization_id ?? '',
          config,
          logger: {
            info: (...args: unknown[]) => console.log(`[node:${node.id}]`, ...args),
            error: (...args: unknown[]) => console.error(`[node:${node.id}]`, ...args),
          },
        };
        return impl(state, ctx);
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

/**
 * Static definition checks (design §7) — fail before any node runs.
 * Exported for unit tests without DB/checkpointer.
 */
export function validateDefinition(def: GraphDefinition): void {
  // 1. Duplicate node ids
  const seenIds = new Set<string>();
  for (const node of def.nodes) {
    if (seenIds.has(node.id)) {
      throw new Error(`DEFINITION_INVALID: duplicate node id "${node.id}"`);
    }
    seenIds.add(node.id);
  }
  const nodeIds = new Set(def.nodes.map((n) => n.id));

  // Existing: every edge endpoint is a declared node (or reserved)
  for (const [from, to] of def.edges) {
    for (const end of [from, to]) {
      if (end === '__start__' || end === '__end__') continue;
      if (!nodeIds.has(end)) {
        throw new Error(`DEFINITION_INVALID: edge endpoint "${end}" not in nodes`);
      }
    }
  }

  // Existing: every impl is in the node registry
  for (const node of def.nodes) {
    if (!(node.impl in nodeRegistry)) {
      throw new Error(`DEFINITION_INVALID: unknown impl "${node.impl}"`);
    }
  }

  // 2. At least one edge from __start__
  if (!def.edges.some(([from]) => from === '__start__')) {
    throw new Error('DEFINITION_INVALID: no edge from __start__');
  }

  // 3. At least one edge into __end__
  if (!def.edges.some(([, to]) => to === '__end__')) {
    throw new Error('DEFINITION_INVALID: nothing reaches __end__');
  }

  // 4. No orphan nodes (must appear on at least one edge)
  const onEdge = new Set<string>();
  for (const [from, to] of def.edges) {
    if (from !== '__start__' && from !== '__end__') onEdge.add(from);
    if (to !== '__start__' && to !== '__end__') onEdge.add(to);
  }
  for (const id of nodeIds) {
    if (!onEdge.has(id)) {
      throw new Error(`DEFINITION_INVALID: orphan node "${id}"`);
    }
  }

  // 5. Every node reachable from __start__
  const adj = new Map<string, string[]>();
  for (const [from, to] of def.edges) {
    const list = adj.get(from) ?? [];
    list.push(to);
    adj.set(from, list);
  }
  const reachable = new Set<string>();
  const queue: string[] = ['__start__'];
  reachable.add('__start__');
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  for (const id of nodeIds) {
    if (!reachable.has(id)) {
      throw new Error(`DEFINITION_INVALID: node ${id} unreachable from __start__`);
    }
  }
}

export function checksumOf(definition: unknown): string {
  return createHash('sha256').update(JSON.stringify(definition)).digest('hex');
}
