import { useMemo } from "react";
import type { GraphDefinition } from "@tekisho/authoring/src/graph-definition.js";
import { getToolCatalog } from "@tekisho/authoring/src/tool-registry.js";
import { summarizeGraphWorkflow } from "@tekisho/authoring/src/summarize-graph.js";

export type WorkflowStep = {
  id: string;
  impl: string;
  config?: Record<string, unknown>;
};

type WorkflowCanvasProps = {
  definition: GraphDefinition | null | undefined;
  version?: number | null;
  editable?: boolean;
  steps?: WorkflowStep[];
  onStepsChange?: (steps: WorkflowStep[]) => void;
  emptyHint?: string;
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

export function workflowStepsFromDefinition(
  def: GraphDefinition | null | undefined,
): WorkflowStep[] {
  return stepsFromDefinition(def);
}

function stepsFromDefinition(def: GraphDefinition | null | undefined): WorkflowStep[] {
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
  const nodes = steps.map((s) => ({
    id: s.id,
    impl: s.impl,
    config: s.config && Object.keys(s.config).length > 0 ? s.config : undefined,
  }));
  const edges: [string, string][] = [["__start__", steps[0].id]];
  for (let i = 0; i < steps.length - 1; i++) {
    edges.push([steps[i].id, steps[i + 1].id]);
  }
  edges.push([steps[steps.length - 1].id, "__end__"]);
  return { graphKey, nodes, edges };
}

function nextStepId(steps: WorkflowStep[]): string {
  let n = steps.length + 1;
  while (steps.some((s) => s.id === `step_${n}`)) n += 1;
  return `step_${n}`;
}

export function WorkflowCanvas({
  definition,
  version,
  editable = false,
  steps: stepsProp,
  onStepsChange,
  emptyHint = "No workflow yet. Build from policy with AI, or add steps manually.",
}: WorkflowCanvasProps) {
  const tools = getToolCatalog();
  const derivedSteps = useMemo(() => stepsFromDefinition(definition), [definition]);
  const steps = stepsProp ?? derivedSteps;
  const graphKey = definition?.graphKey ?? "";

  if (steps.length === 0) {
    return (
      <div className="workflow-canvas workflow-canvas--empty">
        <p className="muted">{emptyHint}</p>
      </div>
    );
  }

  function updateStep(index: number, patch: Partial<WorkflowStep>) {
    if (!onStepsChange) return;
    const next = steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onStepsChange(next);
  }

  function removeStep(index: number) {
    if (!onStepsChange) return;
    onStepsChange(steps.filter((_, i) => i !== index));
  }

  function addStep(afterIndex?: number) {
    if (!onStepsChange) return;
    const newStep: WorkflowStep = {
      id: nextStepId(steps),
      impl: tools[0]?.key ?? "syntra.jd.process",
    };
    if (afterIndex === undefined) {
      onStepsChange([...steps, newStep]);
    } else {
      const next = [...steps];
      next.splice(afterIndex + 1, 0, newStep);
      onStepsChange(next);
    }
  }

  function moveStep(index: number, dir: -1 | 1) {
    if (!onStepsChange) return;
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onStepsChange(next);
  }

  return (
    <div className={`workflow-canvas${editable ? " workflow-canvas--edit" : ""}`}>
      <div className="workflow-canvas-head">
        <span className="workflow-canvas-title">Workflow</span>
        {version != null ? (
          <span className="muted workflow-canvas-version">v{version}</span>
        ) : null}
      </div>

      <div className="workflow-canvas-flow">
        <div className="workflow-node workflow-node--pill">Start</div>
        <div className="workflow-connector" aria-hidden="true" />

        {steps.map((step, index) => (
          <div key={step.id} className="workflow-step-wrap">
            <div
              className={`workflow-node${editable ? " workflow-node--editable" : ""}`}
            >
              {editable ? (
                <>
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
                </>
              ) : (
                <>
                  <span className="workflow-node-num">{index + 1}</span>
                  <div className="workflow-node-body">
                    <span className="workflow-node-label">{toolLabel(step.impl)}</span>
                    {stepConfigBits(step).map((bit) => (
                      <span key={bit} className="workflow-node-detail">
                        {bit}
                      </span>
                    ))}
                    <span className="workflow-node-impl muted">{step.impl}</span>
                  </div>
                </>
              )}
            </div>
            {editable ? (
              <button
                type="button"
                className="workflow-add-btn"
                title="Add step below"
                onClick={() => addStep(index)}
              >
                + Add step
              </button>
            ) : null}
            <div className="workflow-connector" aria-hidden="true" />
          </div>
        ))}

        <div className="workflow-node workflow-node--pill">End</div>
      </div>

      {editable && onStepsChange ? (
        <button
          type="button"
          className="btn secondary btn--compact workflow-add-end"
          onClick={() => addStep()}
        >
          + Add step at end
        </button>
      ) : null}
    </div>
  );
}
