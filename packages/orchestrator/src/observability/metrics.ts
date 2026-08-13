/**
 * Lightweight structured metrics for orchestration hot path.
 * Emits JSON lines to stdout (scrapable by CloudWatch / Datadog / etc.).
 * Design §12 — "node duration / class metrics".
 */

export type MetricStatus = 'ok' | 'error' | 'soft_error' | 'interrupted' | 'policy_denied';

export type NodeMetric = {
  type: 'orch.node';
  graphKey: string;
  nodeId: string;
  impl?: string;
  status: MetricStatus;
  durationMs: number;
  errorClass?: string;
  threadId?: string;
  ts: string;
};

export type WorkflowMetric = {
  type: 'orch.workflow';
  graphKey: string;
  status: 'completed' | 'failed' | 'interrupted' | 'parked';
  durationMs: number;
  threadId?: string;
  errorClass?: string;
  ts: string;
};

export type TerminalEventMetric = {
  type: 'orch.terminal_event';
  eventType: string;
  organizationId?: string;
  correlationId?: string;
  ts: string;
};

export type OrchMetric = NodeMetric | WorkflowMetric | TerminalEventMetric;

/** Override in tests to capture metrics without console noise. */
let sink: (m: OrchMetric) => void = (m) => {
  console.log(JSON.stringify(m));
};

export function setMetricsSink(fn: ((m: OrchMetric) => void) | null): void {
  sink = fn ?? ((m) => console.log(JSON.stringify(m)));
}

export function recordMetric(m: OrchMetric): void {
  sink(m);
}

export function recordNodeMetric(
  partial: Omit<NodeMetric, 'type' | 'ts'> & { ts?: string },
): void {
  recordMetric({
    type: 'orch.node',
    ts: partial.ts ?? new Date().toISOString(),
    ...partial,
  });
}

export function recordWorkflowMetric(
  partial: Omit<WorkflowMetric, 'type' | 'ts'> & { ts?: string },
): void {
  recordMetric({
    type: 'orch.workflow',
    ts: partial.ts ?? new Date().toISOString(),
    ...partial,
  });
}

export function recordTerminalEvent(
  partial: Omit<TerminalEventMetric, 'type' | 'ts'> & { ts?: string },
): void {
  recordMetric({
    type: 'orch.terminal_event',
    ts: partial.ts ?? new Date().toISOString(),
    ...partial,
  });
}
