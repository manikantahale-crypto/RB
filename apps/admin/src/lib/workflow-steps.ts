import type { GraphDefinition } from "@tekisho/authoring/src/graph-definition.js";
import { summarizeGraphWorkflow } from "@tekisho/authoring/src/summarize-graph.js";

export type WorkflowStep = {
  id: string;
  impl: string;
  config?: Record<string, unknown>;
};

export function workflowStepsFromDefinition(
  def: GraphDefinition | null | undefined,
): WorkflowStep[] {
  if (!def?.nodes?.length) return [];
  const summary = summarizeGraphWorkflow(def);
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  return summary.steps.map((s) => {
    const node = byId.get(s.id);
    return {
      id: s.id,
      impl: node?.impl ?? s.impl,
      config: (node?.config as Record<string, unknown> | undefined) ?? undefined,
    };
  });
}

export function stepsToLinearGraph(
  graphKey: string,
  steps: WorkflowStep[],
): GraphDefinition | null {
  if (steps.length === 0) return null;
  const first = steps[0]!;
  const last = steps[steps.length - 1]!;
  const nodes = steps.map((s) => ({
    id: s.id,
    impl: s.impl,
    config: s.config && Object.keys(s.config).length > 0 ? s.config : undefined,
  }));
  const edges: [string, string][] = [["__start__", first.id]];
  for (let i = 0; i < steps.length - 1; i++) {
    edges.push([steps[i]!.id, steps[i + 1]!.id]);
  }
  edges.push([last.id, "__end__"]);
  return { graphKey, nodes, edges };
}

export function nextStepId(steps: WorkflowStep[]): string {
  let n = steps.length + 1;
  while (steps.some((s) => s.id === `step_${n}`)) n += 1;
  return `step_${n}`;
}
