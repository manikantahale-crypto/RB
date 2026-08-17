import { v4 as uuidv4 } from 'uuid';
import { interrupt } from '@langchain/langgraph';
import { EVENT_TYPES } from '@tekisho/domain';
import type { NodeImpl } from './types.js';

/** Pause workflow for human review; resume via orchestration.resume-thread. */
export const humanGate: NodeImpl = async (state, ctx) => {
  const reason = String(ctx.config.reason ?? 'human_review');

  ctx.events.emit({
    event_id: uuidv4(),
    event_type: EVENT_TYPES.APPROVAL_REQUESTED,
    aggregate_id: state.trigger_event?.aggregate_id ?? uuidv4(),
    aggregate_type: state.trigger_event?.aggregate_type ?? 'approval',
    organization_id: ctx.orgId,
    correlation_id:
      state.trigger_event?.correlation_id ??
      state.trigger_event?.event_id ??
      uuidv4(),
    payload: {
      reason,
      gate: 'human.gate',
      source_event_id: state.trigger_event?.event_id,
    },
  });

  const decision = interrupt({
    reason,
    gate: 'human.gate',
    orgId: ctx.orgId,
  }) as { approved?: boolean; note?: string } | string | boolean;

  return {
    result: `human.gate:resumed:${typeof decision === 'object' ? JSON.stringify(decision) : String(decision)}`,
  };
};
