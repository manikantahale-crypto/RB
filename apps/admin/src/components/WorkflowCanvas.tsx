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
  title?: string;
};

function toolLabel(impl: string): string {
  const tool = getToolCatalog().find((t) => t.key === impl);
  if (!tool) return impl;
  return tool.description.split(":")[0]?.trim() || impl;
}

function stepConfigBits(step: WorkflowStep): string[] {
  const cfg = step.config;
  if (!cfg || typeof cfg !== "object") return [];
  const bits: string[] = [];
  if (typeof cfg.matchThreshold === "number") {
    bits.push(`Min score: ${cfg.matchThreshold}`);
  }
  if (typeof cfg.rerank === "boolean") {
    bits.push(cfg.rerank ? "Rerank on" : "Rerank off");
  }
  if (Array.isArray(cfg.hardFilters) && cfg.hardFilters.length > 0) {
    bits.push(`Filters: ${cfg.hardFilters.join(", ")}`);
  }
  return bits;
}

export function WorkflowCanvas({
  definition,
  version,
  editable = false,
  steps: stepsProp,
  onStepsChange,
  emptyHint = "No workflow yet. Build from policy with AI, or add steps manually.",
  title,
}: WorkflowCanvasProps) {
  const tools = getToolCatalog();
  const derivedSteps = useMemo(
    () => workflowStepsFromDefinition(definition),
    [definition],
  );
  const steps = stepsProp ?? derivedSteps;

  if (steps.length === 0 && !definition?.nodes?.length) {
    return (
      <div className="workflow-canvas workflow-canvas--empty">
        <p className="muted">{emptyHint}</p>
      </div>
    );
  }

  if (editable) {
    return (
      <div className="workflow-canvas workflow-canvas--edit">
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
      <WorkflowMermaidView definition={definition} title={title} version={version} />
    );
  }

  const linearDef = stepsToLinearGraph("preview.authored", steps);
  if (linearDef) {
    return (
      <WorkflowMermaidView definition={linearDef} title={title} version={version} />
    );
  }

  return (
    <div className="workflow-canvas workflow-canvas--empty">
      <p className="muted">{emptyHint}</p>
    </div>
  );
}

/** Step list editor — tool selection and reorder (unchanged UX). */
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

      {steps.map((step, index) => (
        <div key={step.id} className="workflow-step-wrap">
          <div className="workflow-node workflow-node--editable">
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
              <span className="workflow-node-field-label">Step</span>
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
      ))}

      {steps.length === 0 ? (
        <button type="button" className="btn secondary" onClick={() => addStep()}>
          Add first step
        </button>
      ) : null}

      <div className="workflow-node workflow-node--pill">End</div>
    </div>
  );
}
