/**
 * Conditional branch planner — sets state.branch_key for LangGraph
 * conditionalEdges so graphs can diverge.
 *
 * THE OUTCOMES ARE THE GRAPH'S TO NAME.
 *
 * This used to produce exactly three keys — pass / human_review / reject —
 * which meant a workflow could only ever fork three ways, with those names.
 * An author who wanted a fourth path, or wanted to call one "escalate", had
 * nowhere to put it: an edge labelled anything else is simply never taken,
 * with no error and no failed run.
 *
 * So `outcomes` lets a graph declare its own bands. Each is a name and the
 * score at or above which it applies; the highest matching band wins, and the
 * lowest is the catch-all. Omit it and the three defaults below reproduce the
 * old behaviour exactly, which is why every existing graph is untouched.
 *
 * Config:
 * - field: payload field to read (default confidence_score)
 * - outcomes: [{ name, min }] — the graph's own bands
 * - passMin / humanMin: the two thresholds of the default three bands
 * - actionableField: payload boolean (default is_actionable); false → the
 *   lowest band, whatever it is called
 * - requireHuman: forces `human_review`. Only meaningful with the default
 *   bands, since a custom set need not contain that name.
 * - onRejectEvent: optional event type emitted when the lowest band is taken
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

  const bands = resolveOutcomes(ctx.config, passMin, humanMin);
  const usingDefaults = !Array.isArray(ctx.config.outcomes);
  /** The catch-all: anything matching no band above it lands here. */
  const lowest = bands[bands.length - 1]!.name;

  let branch_key: BranchKey;
  if (requireHuman && usingDefaults) {
    branch_key = 'human_review';
  } else if (!isActionable) {
    branch_key = lowest;
  } else {
    branch_key = bands.find((b) => score >= b.min)?.name ?? lowest;
  }

  // Optional override from prior human.gate resume payload
  const humanDecision = p.human_decision ?? p.approval;
  if (humanDecision === true || humanDecision === 'approved') {
    branch_key = 'pass';
  } else if (humanDecision === false || humanDecision === 'rejected') {
    branch_key = 'reject';
  }

  if (branch_key === lowest && typeof ctx.config.onRejectEvent === 'string') {
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
    bands: bands.map((b) => `${b.name}>=${b.min}`),
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

/**
 * The bands this branch decides between, highest threshold first.
 *
 * Sorted here rather than trusting the order they were written, so an author
 * can add a band anywhere in the list and it still lands in the right place.
 * A band whose `min` is not a finite number is DROPPED rather than treated as
 * zero — a typo that quietly became a catch-all would swallow every run.
 */
export function resolveOutcomes(
  config: Record<string, unknown>,
  passMin: number,
  humanMin: number,
): Array<{ name: string; min: number }> {
  const declared = config.outcomes;
  if (Array.isArray(declared)) {
    const bands = declared
      .filter(
        (o): o is { name: string; min: number } =>
          Boolean(o) &&
          typeof o === 'object' &&
          typeof (o as { name?: unknown }).name === 'string' &&
          (o as { name: string }).name.length > 0 &&
          typeof (o as { min?: unknown }).min === 'number' &&
          Number.isFinite((o as { min: number }).min),
      )
      .map((o) => ({ name: o.name, min: o.min }))
      .sort((a, b) => b.min - a.min);
    if (bands.length > 0) return bands;
  }
  // The three every existing graph relies on, unchanged.
  return [
    { name: 'pass', min: passMin },
    { name: 'human_review', min: humanMin },
    { name: 'reject', min: Number.NEGATIVE_INFINITY },
  ];
}
