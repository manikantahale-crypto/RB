import type { WorkflowPhase } from "../lib/policy-workflow-guide";
import { phaseLabel } from "../lib/policy-workflow-guide";

const STEPS: Array<{ id: WorkflowPhase | "done"; label: string }> = [
  { id: "draft_saved", label: "Policy" },
  { id: "preview_pending", label: "Preview" },
  { id: "graph_ready", label: "Graph saved" },
  { id: "live", label: "Live" },
];

function stepState(
  stepId: string,
  phase: WorkflowPhase,
): "done" | "current" | "pending" | "warn" {
  if (phase === "error") return "warn";
  if (phase === "policy_changed" && stepId === "graph_ready") return "warn";

  if (stepId === "draft_saved") {
    if (phase === "no_policy") return "current";
    return "done";
  }

  if (stepId === "preview_pending") {
    if (phase === "preview_pending") return "current";
    if (
      phase === "graph_ready" ||
      phase === "going_live" ||
      phase === "live" ||
      phase === "policy_changed"
    ) {
      return "done";
    }
    if (phase === "generating") return "current";
    return "pending";
  }

  if (stepId === "graph_ready") {
    if (phase === "live" || phase === "going_live") return "done";
    if (phase === "graph_ready" || phase === "policy_changed") return "current";
    return "pending";
  }

  if (stepId === "live") {
    if (phase === "live") return "done";
    if (phase === "going_live") return "current";
    return "pending";
  }

  return "pending";
}

export function WorkflowStatusStepper({
  phase,
  version,
  graphKey,
  hasUnsavedPreview,
}: {
  phase: WorkflowPhase;
  version?: number;
  graphKey?: string | null;
  hasUnsavedPreview?: boolean;
}) {
  return (
    <div className="workflow-stepper" role="status">
      <p className="workflow-stepper-status">
        <strong>Status:</strong> {phaseLabel(phase)}
        {hasUnsavedPreview ? (
          <span className="preview-not-saved-badge">Not saved</span>
        ) : null}
        {version != null ? ` · v${version}` : ""}
        {graphKey ? ` · ${graphKey}` : ""}
      </p>
      <ol className="workflow-stepper-track">
        {STEPS.map((s) => {
          const state = stepState(s.id, phase);
          return (
            <li
              key={s.id}
              className={`workflow-stepper-item workflow-stepper-item--${state}`}
            >
              <span className="workflow-stepper-dot" />
              {s.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
