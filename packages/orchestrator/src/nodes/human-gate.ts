import { v4 as uuidv4 } from 'uuid';
import { interrupt } from '@langchain/langgraph';
import { EVENT_TYPES } from '@tekisho/domain';
import type { NodeImpl } from './types.js';

/** Pause workflow for human review; resume via orchestration.resume-thread. */
export const humanGate: NodeImpl = async (state, ctx) => {
  const reason = String(ctx.config.reason ?? 'human_review');
  const trigger = state.trigger_event;

  ctx.events.emit({
    event_id: uuidv4(),
    event_type: EVENT_TYPES.APPROVAL_REQUESTED,
    aggregate_id: trigger?.aggregate_id ?? uuidv4(),
    aggregate_type: trigger?.aggregate_type ?? 'approval',
    organization_id: ctx.orgId,
    correlation_id:
      trigger?.correlation_id ?? trigger?.event_id ?? uuidv4(),
    payload: {
      reason,
      gate: 'human.gate',
      source_event_id: trigger?.event_id,
    },
  });

  const decision = interrupt({
    reason,
    gate: 'human.gate',
    orgId: ctx.orgId,
  }) as { approved?: boolean; note?: string } | string | boolean;

  let approved = false;
  if (typeof decision === 'boolean') {
    approved = decision;
  } else if (typeof decision === 'string') {
    approved = decision === 'approved' || decision === 'true';
  } else if (decision && typeof decision === 'object') {
    approved = Boolean(decision.approved);
  }

  return {
    result: `human.gate:resumed:approved=${approved}`,
    branch_key: approved ? 'pass' : 'reject',
    trigger_event: trigger
      ? {
          ...trigger,
          payload: {
            ...(trigger.payload ?? {}),
            human_decision: approved ? 'approved' : 'rejected',
            // Route gate: human approve forces actionable path.
            is_actionable: approved,
            confidence_score: approved
              ? Math.max(
                  Number(
                    (trigger.payload as Record<string, unknown> | undefined)
                      ?.confidence_score ?? 0,
                  ),
                  1,
                )
              : Number(
                  (trigger.payload as Record<string, unknown> | undefined)
                    ?.confidence_score ?? 0,
                ),
          },
        }
      : trigger,
  };
};
