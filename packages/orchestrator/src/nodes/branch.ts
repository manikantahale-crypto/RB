/**
 * Conditional branch planner — sets state.branch_key for LangGraph
 * conditionalEdges so graphs can diverge (pass / human_review / reject).
 *
 * Config:
 * - field: payload field to read (default confidence_score)
 * - passMin: number — >= → "pass" (default 0.6)
 * - humanMin: number — >= → "human_review", else "reject" (default 0.35)
 * - actionableField: payload boolean (default is_actionable); false → reject
 *   unless forceHumanWhenAmbiguous
 * - map aliases via graph conditionalEdges.map
 * - requireHuman: boolean — always human_review when true
 * - onRejectEvent: optional event type to emit when rejecting here
 */
import { v4 as uuidv4 } from 'uuid';
import { ClassifiedError } from '../workflow/errors.js';
import type { NodeImpl } from './types.js';

export type BranchKey = 'pass' | 'human_review' | 'reject' | string;

export const orchBranchDecision: NodeImpl = async (state, ctx) => {
  const trigger = state.trigger_event;
  if (!trigger) {
    throw new ClassifiedError(
      'orch.branch.decision: missing trigger_event',
      'permanent-input',
    );
  }
  const p = trigger.payload ?? {};
  const requireHuman = Boolean(ctx.config.requireHuman);
  const actionableField = String(ctx.config.actionableField ?? 'is_actionable');
  const field = String(ctx.config.field ?? 'confidence_score');
  const passMin =
    typeof ctx.config.passMin === 'number' ? ctx.config.passMin : 0.6;
  const humanMin =
    typeof ctx.config.humanMin === 'number' ? ctx.config.humanMin : 0.35;

  const actionableRaw = p[actionableField] ?? p.isActionable;
  const isActionable =
    actionableRaw === undefined ? true : Boolean(actionableRaw);
  const score = Number(p[field] ?? p.confidenceScore ?? 0);

  let branch_key: BranchKey;
  if (requireHuman) {
    branch_key = 'human_review';
  } else if (!isActionable) {
    branch_key = 'reject';
  } else if (score >= passMin) {
    branch_key = 'pass';
  } else if (score >= humanMin) {
    branch_key = 'human_review';
  } else {
    branch_key = 'reject';
  }

  // Optional override from prior human.gate resume payload
  const humanDecision = p.human_decision ?? p.approval;
  if (humanDecision === true || humanDecision === 'approved') {
    branch_key = 'pass';
  } else if (humanDecision === false || humanDecision === 'rejected') {
    branch_key = 'reject';
  }

  if (branch_key === 'reject' && typeof ctx.config.onRejectEvent === 'string') {
    ctx.events.emit({
      event_id: uuidv4(),
      event_type: String(ctx.config.onRejectEvent),
      aggregate_id: trigger.aggregate_id,
      aggregate_type: trigger.aggregate_type ?? 'requirement',
      organization_id: trigger.organization_id,
      correlation_id: trigger.correlation_id,
      payload: {
        ...p,
        reason: 'branch_reject',
        branch_key,
        confidence_score: score,
        is_actionable: isActionable,
        source_event_id: trigger.event_id,
      },
    });
  }

  ctx.logger.info('branch decision', {
    branch_key,
    score,
    isActionable,
    passMin,
    humanMin,
  });

  return {
    result: `orch.branch.decision → ${branch_key} (score=${score})`,
    branch_key,
    trigger_event: {
      ...trigger,
      payload: {
        ...p,
        branch_key,
        branch_score: score,
      },
    },
  };
};
