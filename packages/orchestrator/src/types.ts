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
  /**
   * SKIPPED is a resume's answer when nothing was parked on that thread —
   * a decision delivered twice, or one for a run already finished. Not a
   * failure: retrying it would be the duplicate it declined to be.
   */
  status: 'COMPLETED' | 'FAILED' | 'PARKED' | 'SKIPPED';
  events: EventInput[];
  finalState: any;
  error?: string;
  errorClass?: 'transient' | 'permanent-input' | 'permanent-system';
  /** Present on COMPLETED / PARKED — orgId:eventId or orgId:bossJobId */
  threadId?: string;
  /** The orch.runs row, when one was written. */
  runId?: string | null;
  /** On FAILED: the step that threw, when the error named one. */
  failedNode?: string | null;
}

export interface WorkflowContext {
  event: EventInput;
  workflowName: string;
  executionId: string;
  metadata?: Record<string, unknown>;
}
