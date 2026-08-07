import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SimpleRunbookResolver } from '../src/resolver/runbook.js';
import { WorkflowRunner } from '../src/workflow/runner.js';
import { jdGraph } from '../src/workflow/graphs/syntra.js';
import type { EventInput } from '../src/types.js';
import { EVENT_TYPES } from '@tekisho/domain';

describe('Orchestrator Flow Integration Test', () => {
  let resolver: SimpleRunbookResolver;
  let runner: WorkflowRunner;

  beforeEach(() => {
    resolver = new SimpleRunbookResolver({
      [EVENT_TYPES.JD_RECEIVED]: 'syntra.jd.workflow',
    });

    const mockCompiler = {
      get: async () => jdGraph,
    };

    runner = new WorkflowRunner(mockCompiler as any);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: 'processed' }),
        text: async () => '',
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should process jd.received via compiler graph and emit jd.parsed', async () => {
    const event: EventInput = {
      event_id: '123e4567-e89b-12d3-a456-426614174000',
      event_type: EVENT_TYPES.JD_RECEIVED,
      aggregate_id: '123e4567-e89b-12d3-a456-426614174001',
      aggregate_type: 'requirement',
      organization_id: '123e4567-e89b-12d3-a456-426614174002',
      correlation_id: '123e4567-e89b-12d3-a456-426614174003',
      payload: { jobId: '123e4567-e89b-12d3-a456-426614174001' },
    };

    const workflowName = resolver.resolve(event.event_type, {
      organization_id: event.organization_id,
      payload: event.payload,
    });
    const result = await runner.executeWorkflow(workflowName, event);

    expect(result.status).toBe('COMPLETED');
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.event_type).toBe(EVENT_TYPES.JD_PARSED);
    expect(result.finalState.result).toContain('processed');
  });

  it('should persist generated events to event_outbox when DB pool is provided', async () => {
    const queries: { text: string; values?: any[] }[] = [];
    const mockClient = {
      query: async (text: string, values?: any[]) => {
        queries.push({ text, values });
      },
      release: () => {},
    };
    const mockPool = {
      connect: async () => mockClient,
    } as any;

    const mockCompiler = { get: async () => jdGraph };
    const runnerWithDb = new WorkflowRunner(mockCompiler as any, mockPool);

    const event: EventInput = {
      event_id: '123e4567-e89b-12d3-a456-426614174000',
      event_type: EVENT_TYPES.JD_RECEIVED,
      aggregate_id: '123e4567-e89b-12d3-a456-426614174001',
      aggregate_type: 'requirement',
      organization_id: '123e4567-e89b-12d3-a456-426614174002',
      correlation_id: '123e4567-e89b-12d3-a456-426614174003',
      payload: { jobId: '123e4567-e89b-12d3-a456-426614174001' },
    };

    const workflowName = resolver.resolve(event.event_type, {
      organization_id: event.organization_id,
      payload: event.payload,
    });
    const result = await runnerWithDb.executeWorkflow(workflowName, event);

    expect(result.status).toBe('COMPLETED');
    expect(queries).toHaveLength(3);
    expect(queries[0]!.text).toBe('BEGIN');
    expect(queries[1]!.text).toContain('INSERT INTO event_outbox');
    expect(queries[1]!.values![1]).toBe(EVENT_TYPES.JD_PARSED);
    expect(queries[2]!.text).toBe('COMMIT');
  });
});
