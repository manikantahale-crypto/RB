import type { GraphDefinition } from "@tekisho/authoring/src/graph-definition.js";
import type { GenerationTrace } from "@tekisho/authoring/src/generation-meta.js";
import { WorkflowCanvas } from "./WorkflowCanvas";
import {
  buildPlannedSteps,
  explainGeneratedGraph,
  type PlannedStep,
} from "../lib/policy-workflow-guide";

type PolicyGraphExplainerProps = {
  policyText: string;
  template: {
    nodes?: Array<{ id: string; impl: string }>;
    wiring?: Array<[string, string]>;
  } | null;
  definition: GraphDefinition | null;
  graphKey?: string | null;
  graphVersion?: number | null;
  mode: "planned" | "generated" | "preview";
  generationTrace?: GenerationTrace | null;
};

export function PolicyGraphExplainer({
  policyText,
  template,
  definition,
  graphKey,
  graphVersion,
  mode,
  generationTrace,
}: PolicyGraphExplainerProps) {
  const planned: PlannedStep[] = buildPlannedSteps(template);
  const mapping =
    mode === "generated" || mode === "preview"
      ? explainGeneratedGraph(definition, policyText, generationTrace)
      : planned.map((p) => ({
          step: `Step ${p.order}`,
          fromPolicy: p.policyApplies,
          source: "heuristic" as const,
        }));

  const title =
    mode === "planned"
      ? "Planned workflow"
      : mode === "preview"
        ? "Preview workflow (not saved)"
        : "Your saved workflow";

  const intro =
    mode === "planned"
      ? "After you create a workflow, the AI will turn your description into steps. You can change your text and update the workflow any time."
      : mode === "preview"
        ? "This is what the AI proposed. It is not in the database until you click Accept & save."
        : "These steps were saved from your policy. Confirmed values come from the graph JSON, not keyword guesses.";

  return (
    <div className="policy-graph-explainer">
      <h3 className="form-block-title">{title}</h3>
      <p className="muted explainer-intro">{intro}</p>

      {mapping.length === 0 ? (
        <p className="muted">Save your policy first, then create a workflow.</p>
      ) : (
        <ul className="workflow-steps workflow-steps--plain policy-step-list">
          {mapping.map((row, i) => (
            <li key={i}>
              <span className="workflow-step-label">{row.step}</span>
              {mode !== "planned" && row.source === "confirmed" ? (
                <span className="step-explanation-source step-explanation-source--confirmed">
                  From generation
                </span>
              ) : null}
              <span className="workflow-step-detail">{row.fromPolicy}</span>
            </li>
          ))}
        </ul>
      )}

      {mode !== "planned" && definition ? (
        <WorkflowCanvas definition={definition} version={graphVersion} title={title} />
      ) : null}
    </div>
  );
}
