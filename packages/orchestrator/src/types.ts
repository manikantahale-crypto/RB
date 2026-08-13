export interface EventInput {
  event_id: string;
  event_type: string;
  aggregate_id: string;
  aggregate_type: string;
  organization_id: string;
  correlation_id: string;
  payload: Record<string, any>;
}

export interface WorkflowResult {
  status: 'COMPLETED' | 'FAILED' | 'PARKED';
  events: EventInput[];
  finalState: any;
  error?: string;
  errorClass?: 'transient' | 'permanent-input' | 'permanent-system';
  /** Present on COMPLETED / PARKED — orgId:eventId or orgId:bossJobId */
  threadId?: string;
}

export interface WorkflowContext {
  event: EventInput;
  workflowName: string;
  executionId: string;
  metadata?: Record<string, unknown>;
}
