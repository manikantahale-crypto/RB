import { useParams } from "react-router-dom";
import { WorkflowMermaidView } from "../components/WorkflowMermaidView.js";
import { getWorkflowFixture } from "../lib/workflow-fixtures.js";

/** Dev/e2e page — renders workflow fixtures without API or auth. */
export function WorkflowTestPage() {
  const { fixtureId } = useParams<{ fixtureId: string }>();
  const { graph, labelSuffix } = getWorkflowFixture(fixtureId);

  return (
    <div
      data-testid="workflow-test-root"
      style={{ padding: "1rem", maxWidth: 1200, margin: "0 auto" }}
    >
      <h1 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>
        Workflow fixture: {fixtureId ?? "duplicate-review"}
      </h1>
      <WorkflowMermaidView
        definition={graph}
        title={`Fixture ${fixtureId ?? "duplicate-review"}`}
        mermaidOptions={labelSuffix ? { labelSuffix } : undefined}
      />
    </div>
  );
}
