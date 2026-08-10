import { describe, it, expect, vi } from 'vitest';
import { DBRunbookResolver } from '../src/resolver/db-resolver.js';
import { GraphCompiler } from '../src/workflow/compiler.js';
import { WorkflowRegistry } from '../src/workflow/registry.js';
import { WorkflowRunner } from '../src/workflow/runner.js';
import type { EventInput } from '../src/types.js';
import { NodeRegistry } from '../src/workflow/node-registry.js';

describe('DBRunbookResolver', () => {
  it('should resolve global workflow if no org specific found', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: '1', org_id: null, graph_key: 'syntra.jd.workflow', version: 1, definition: {}, checksum: 'abc', status: 'active' }]
      })
    } as any;

    const resolver = new DBRunbookResolver(mockPool);
    const result = await resolver.resolve('jd.uploaded', 'org1');
    expect(result.graph_key).toBe('syntra.jd.workflow');
    expect(result.org_id).toBeNull();
  });
});

describe('GraphCompiler', () => {
  it('should compile valid definition', () => {
    // Add mock node to registry
    (NodeRegistry as any).implementations.set('test.impl', async (state: any) => ({ _emittedEvents: [] }));

    const def = {
      id: '1', org_id: null, graph_key: 'test', version: 1, checksum: '123', status: 'active',
      definition: {
        nodes: [{ id: 'n1', impl: 'test.impl' }],
        edges: [['__start__', 'n1'], ['n1', '__end__']]
      }
    };

    const graph = GraphCompiler.compile(def);
    expect(graph).toBeDefined();
  });
});

describe('WorkflowRunner', () => {
  it('should compile, cache, and execute', async () => {
    const mockPool = {
      connect: vi.fn().mockResolvedValue({
        query: vi.fn(),
        release: vi.fn()
      })
    } as any;

    const mockResolver = {
      resolve: vi.fn().mockResolvedValue({
        id: '1', org_id: null, graph_key: 'test', version: 1, checksum: '123', status: 'active',
        definition: {
          nodes: [{ id: 'n1', impl: 'test.impl' }],
          edges: [['__start__', 'n1'], ['n1', '__end__']]
        }
      })
    } as any;

    const registry = new WorkflowRegistry();
    const runner = new WorkflowRunner(mockResolver, registry, mockPool);

    const event: EventInput = {
      event_id: 'e1',
      event_type: 'jd.uploaded',
      aggregate_id: 'a1',
      payload: { jobId: 'job1' }
    };

    const res = await runner.executeWorkflow(event);
    expect(res.status).toBe('COMPLETED');
    expect(registry.getGraph('global::test::123')).toBeDefined();
  });
});
