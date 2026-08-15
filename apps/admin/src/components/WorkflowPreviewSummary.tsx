import type { GenerationTrace } from "@tekisho/authoring/src/generation-meta.js";
import type { GraphDefinition } from "@tekisho/authoring/src/graph-definition.js";
import { summarizeGraphWorkflow } from "@tekisho/authoring/src/summarize-graph.js";

type WorkflowPreviewSummaryProps = {
  definition: GraphDefinition;
  builtSummary?: string | null;
  trace?: GenerationTrace | null;
};

/**
 * Plain-language preview after Create workflow — no code paths or raw JSON.
 */
export function WorkflowPreviewSummary({
  definition,
  builtSummary,
  trace,
  isPreviewOnly = false,
}: WorkflowPreviewSummaryProps & { isPreviewOnly?: boolean }) {
  const summary = summarizeGraphWorkflow(definition);
  const extracted = trace?.extracted;

  return (
    <div className="workflow-preview-summary" role="region" aria-label="Workflow preview">
      {isPreviewOnly ? (
        <p className="preview-not-saved-line">
          <strong>Status:</strong> Preview only — database not updated until you Accept
          &amp; save.
        </p>
      ) : null}
      <h3 className="form-block-title">What we will save</h3>
      {trace?.userRequest ? (
        <p className="preview-your-words">
          <strong>From your description:</strong>{" "}
          {trace.userRequest.length > 200
            ? `${trace.userRequest.slice(0, 200)}…`
            : trace.userRequest}
        </p>
      ) : null}
      <p className="preview-built-line">
        <strong>Steps:</strong>{" "}
        {builtSummary ?? summary.line}
      </p>
      {extracted && (
        <ul className="preview-settings">
          {extracted.matchThreshold != null ? (
            <li>Only shortlist matches at or above <strong>{extracted.matchThreshold}</strong></li>
          ) : null}
          {extracted.rerank != null ? (
            <li>
              Reranking: <strong>{extracted.rerank ? "on" : "off"}</strong>
            </li>
          ) : null}
          {extracted.hardFilters?.length ? (
            <li>
              Filters: <strong>{extracted.hardFilters.join(", ")}</strong>
            </li>
          ) : null}
        </ul>
      )}
      <p className="muted preview-hint">
        Click <strong>Accept & save</strong> to store this workflow for this agent.
      </p>
    </div>
  );
}
