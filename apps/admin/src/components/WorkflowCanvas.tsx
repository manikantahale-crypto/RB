import { useMemo } from "react";
import type { GraphDefinition } from "@tekisho/authoring/src/graph-definition.js";
import { getToolCatalog } from "@tekisho/authoring/src/tool-registry.js";
import { WorkflowMermaidView } from "./WorkflowMermaidView.js";
import { WorkflowEditFlow } from "./WorkflowEditFlow.js";
import {
  nextStepId,
  stepsToLinearGraph,
  workflowStepsFromDefinition,
  type WorkflowStep,
} from "../lib/workflow-steps.js";
import {
  friendlyEventLabel,
  friendlyToolBlurb,
  friendlyToolTitle,
} from "../lib/friendly-labels";

export type { WorkflowStep };
export {
  nextStepId,
  stepsToLinearGraph,
  workflowStepsFromDefinition,
};

type WorkflowCanvasProps = {
  definition: GraphDefinition | null | undefined;
  version?: number | null;
  editable?: boolean;
  steps?: WorkflowStep[];
  onStepsChange?: (steps: WorkflowStep[]) => void;
  emptyHint?: string;
  /** Mermaid / panel title (from syntra_orch_tools). */
  title?: string;
  /** Event that starts this live workflow (shown above the diagram). */
  triggerEventType?: string | null;
  /** Whether this graph is bound live for orchestrator pickup. */
  isLive?: boolean;
};

function toolLabel(impl: string): string {
  return friendlyToolTitle(impl);
}

function isHumanStep(impl: string): boolean {
  return impl === "human.gate";
}

function isBranchStep(impl: string): boolean {
  return impl === "orch.branch.decision";
}

export function WorkflowCanvas({
  definition,
  version,
  editable = false,
  steps: stepsProp,
  onStepsChange,
  emptyHint = "No workflow yet. Generate from your policy, or add steps with ✎.",
  title,
  triggerEventType,
  isLive,
}: WorkflowCanvasProps) {
  const tools = getToolCatalog();
  const derivedSteps = useMemo(
    () => workflowStepsFromDefinition(definition),
    [definition],
  );
  const steps = stepsProp ?? derivedSteps;

  const hasHumanLoop = useMemo(
    () =>
      steps.some((s) => isHumanStep(s.impl)) ||
      Boolean(
        definition?.conditionalEdges?.some((ce) =>
          Object.keys(ce.map ?? {}).includes("human_review"),
        ),
      ),
    [steps, definition],
  );

  if (steps.length === 0 && !definition?.nodes?.length) {
    return (
      <div className="workflow-canvas workflow-canvas--empty">
        <p className="muted">{emptyHint}</p>
      </div>
    );
  }

  const startBanner = (
    <div className="workflow-canvas-meta">
      <div className="workflow-canvas-head">
        <span className="workflow-canvas-title">
          {title
            ? title
            : version != null
              ? `Workflow · v${version}`
              : "Workflow"}
        </span>
        {isLive ? <span className="workflow-live-badge">Live</span> : null}
      </div>
      <div className="workflow-node workflow-node--pill workflow-node--start workflow-start-inline">
        <span className="workflow-start-kicker">Starts when</span>
        <span className="workflow-start-title">
          {triggerEventType
            ? friendlyEventLabel(triggerEventType)
            : "Choose a trigger in Policy"}
        </span>
      </div>
      {hasHumanLoop ? (
        <p className="workflow-human-banner" role="status">
          This flow can pause for a person — Approve / Reject appears in History
          when a run waits.
        </p>
      ) : null}
    </div>
  );

  if (editable) {
    return (
      <div className="workflow-canvas workflow-canvas--edit">
        {startBanner}
        <WorkflowEditFlow steps={steps} version={version} />
        <LinearStepEditor
          steps={steps}
          onStepsChange={onStepsChange}
          tools={tools}
        />
      </div>
    );
  }

  if (definition) {
    return (
      <div className="workflow-canvas">
        {startBanner}
        <WorkflowMermaidView
          definition={definition}
          title={title}
          version={version}
        />
      </div>
    );
  }

  const linearDef = stepsToLinearGraph("preview.authored", steps);
  if (linearDef) {
    return (
      <div className="workflow-canvas">
        {startBanner}
        <WorkflowMermaidView
          definition={linearDef}
          title={title}
          version={version}
        />
      </div>
    );
  }

  return (
    <div className="workflow-canvas workflow-canvas--empty">
      <p className="muted">{emptyHint}</p>
    </div>
  );
}

/** Step list editor — tool selection and reorder. */
function LinearStepEditor({
  steps,
  onStepsChange,
  tools,
}: {
  steps: WorkflowStep[];
  onStepsChange?: (steps: WorkflowStep[]) => void;
  tools: ReturnType<typeof getToolCatalog>;
}) {
  if (!onStepsChange) return null;
  const applySteps = onStepsChange;

  function updateStep(index: number, patch: Partial<WorkflowStep>) {
    applySteps(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeStep(index: number) {
    applySteps(steps.filter((_, i) => i !== index));
  }

  function addStep(afterIndex?: number) {
    const newStep: WorkflowStep = {
      id: nextStepId(steps),
      impl: tools[0]?.key ?? "syntra.jd.process",
    };
    if (afterIndex === undefined) {
      applySteps([...steps, newStep]);
    } else {
      const next = [...steps];
      next.splice(afterIndex + 1, 0, newStep);
      applySteps(next);
    }
  }

  function moveStep(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    applySteps(next);
  }

  return (
    <div className="workflow-canvas-flow" style={{ marginTop: "1rem" }}>
      <div className="workflow-node workflow-node--pill">Start</div>
      <div className="workflow-connector" aria-hidden="true" />

      {steps.map((step, index) => {
        const human = isHumanStep(step.impl);
        const branch = isBranchStep(step.impl);
        return (
          <div key={step.id} className="workflow-step-wrap">
            <div
              className={`workflow-node workflow-node--editable${
                human ? " workflow-node--human" : ""
              }${branch ? " workflow-node--branch" : ""}`}
            >
              <div className="workflow-node-edit-head">
                <span className="workflow-node-num">{index + 1}</span>
                <div className="workflow-node-actions">
                  <button
                    type="button"
                    className="icon-btn icon-btn--tiny"
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => moveStep(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--tiny"
                    title="Move down"
                    disabled={index === steps.length - 1}
                    onClick={() => moveStep(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--tiny icon-btn--danger"
                    title="Remove step"
                    disabled={steps.length <= 1}
                    onClick={() => removeStep(index)}
                  >
                    ×
                  </button>
                </div>
              </div>
              <label className="workflow-node-field">
                <span className="workflow-node-field-label">
                  What this step does
                </span>
                <select
                  value={step.impl}
                  onChange={(e) =>
                    updateStep(index, { impl: e.target.value, config: {} })
                  }
                >
                  {tools.map((t) => (
                    <option key={t.key} value={t.key}>
                      {toolLabel(t.key)}
                    </option>
                  ))}
                </select>
              </label>
              {friendlyToolBlurb(step.impl) ? (
                <p className="workflow-node-blurb muted">
                  {friendlyToolBlurb(step.impl)}
                </p>
              ) : null}
              {human ? (
                <span className="workflow-tag workflow-tag--human">
                  Needs a person
                </span>
              ) : null}
              {branch ? (
                <span className="workflow-tag workflow-tag--branch">
                  Chooses path
                </span>
              ) : null}
              {step.impl === "syntra.match.process" ? (
                <label className="workflow-node-field workflow-node-field--inline">
                  <span className="workflow-node-field-label">Min score</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={
                      typeof step.config?.matchThreshold === "number"
                        ? step.config.matchThreshold
                        : ""
                    }
                    placeholder="60"
                    onChange={(e) =>
                      updateStep(index, {
                        config: {
                          ...step.config,
                          matchThreshold: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                </label>
              ) : null}
            </div>
            <div className="workflow-connector" aria-hidden="true" />
            <button
              type="button"
              className="workflow-add-step"
              title="Add step here"
              onClick={() => addStep(index)}
            >
              + Add step
            </button>
            <div className="workflow-connector" aria-hidden="true" />
          </div>
        );
      })}

      {steps.length === 0 ? (
        <button type="button" className="btn secondary" onClick={() => addStep()}>
          Add first step
        </button>
      ) : null}

      <div className="workflow-node workflow-node--pill">End</div>
      <p className="muted workflow-edit-hint">
        Save steps, then <strong>Make it live</strong> so this version runs when
        the start action happens.
      </p>
    </div>
  );
}
