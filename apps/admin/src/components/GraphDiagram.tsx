import type { GraphDefinition } from "@tekisho/authoring/src/graph-definition.js";
import { summarizeGraphWorkflow } from "@tekisho/authoring/src/summarize-graph.js";

type GraphDiagramProps = {
  definition: GraphDefinition | null | undefined;
  version?: number | null;
  compact?: boolean;
};

export function GraphDiagram({
  definition,
  version,
  compact = false,
}: GraphDiagramProps) {
  const summary = summarizeGraphWorkflow(definition ?? null);

  if (summary.empty) {
    return (
      <div className="graph-diagram graph-diagram--empty">
        <p className="muted">No workflow yet — use Create workflow after saving your policy.</p>
      </div>
    );
  }

  return (
    <div className={`graph-diagram${compact ? " graph-diagram--compact" : ""}`}>
      <div className="graph-diagram-head">
        <span className="graph-diagram-title">Workflow</span>
        {version != null ? (
          <span className="graph-diagram-version muted">Version {version}</span>
        ) : null}
      </div>
      <ol className="graph-diagram-steps">
        {summary.steps.map((step) => (
          <li key={step.id} className="graph-diagram-step">
            <span className="graph-step-num">{step.order}.</span>
            <span className="graph-step-label">{step.label}</span>
            {step.detail ? (
              <span className="graph-step-detail muted"> — {step.detail}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
