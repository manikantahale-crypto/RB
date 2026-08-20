import { useMemo } from "react";
import type { GraphDefinition } from "@tekisho/authoring/src/graph-definition.js";
import { getToolCatalog } from "@tekisho/authoring/src/tool-registry.js";
import { summarizeGraphWorkflow } from "@tekisho/authoring/src/summarize-graph.js";
import {
  friendlyEventLabel,
  friendlyToolBlurb,
  friendlyToolTitle,
} from "../lib/friendly-labels";

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
  /** Event that starts this live workflow (shown on Start). */
  triggerEventType?: string | null;
  /** Whether this graph is bound live for orchestrator pickup. */
  isLive?: boolean;
};

function toolLabel(impl: string): string {
  return friendlyToolTitle(impl);
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
    bits.push(`Filters: ${(cfg.hardFilters as string[]).join(", ")}`);
  }
  return bits;
}

export function workflowStepsFromDefinition(
  def: GraphDefinition | null | undefined,
): WorkflowStep[] {
  return stepsFromDefinition(def);
}

function stepsFromDefinition(
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
  opts?: {
    conditionalEdges?: GraphDefinition["conditionalEdges"];
  },
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
  return {
    graphKey,
    nodes,
    edges,
    ...(opts?.conditionalEdges?.length
      ? { conditionalEdges: opts.conditionalEdges }
      : {}),
  };
}

function nextStepId(steps: WorkflowStep[]): string {
  let n = steps.length + 1;
  while (steps.some((s) => s.id === `step_${n}`)) n += 1;
  return `step_${n}`;
}

function branchPlain(key: string): string {
  if (key === "pass") return "good enough → continue";
  if (key === "human_review") return "ask a person";
  if (key === "reject") return "stop / reject";
  return key;
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
  triggerEventType,
  isLive,
}: WorkflowCanvasProps) {
  const tools = getToolCatalog();
  const derivedSteps = useMemo(
    () => stepsFromDefinition(definition),
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
    if (!item) return;
    next.splice(target, 0, item);
    onStepsChange(next);
  }

  const startLabel = triggerEventType
    ? friendlyEventLabel(triggerEventType)
    : "Choose a trigger in Policy";

  return (
    <div className={`workflow-canvas${editable ? " workflow-canvas--edit" : ""}`}>
      <div className="workflow-canvas-head">
        <span className="workflow-canvas-title">
          {version != null ? `Workflow · v${version}` : "Workflow"}
        </span>
        {isLive ? <span className="workflow-live-badge">Live</span> : null}
      </div>

      {hasHumanLoop ? (
        <p className="workflow-human-banner" role="status">
          This flow can pause for a person — Approve / Reject appears in History
          when a run waits.
        </p>
      ) : null}

      <div className="workflow-canvas-flow">
        <div className="workflow-node workflow-node--pill workflow-node--start">
          <span className="workflow-start-kicker">Starts when</span>
          <span className="workflow-start-title">{startLabel}</span>
          {!triggerEventType ? (
            <span className="workflow-start-event muted">
              Set this under Policy before going live
            </span>
          ) : null}
        </div>
        <div className="workflow-connector" aria-hidden="true" />

        {steps.map((step, index) => {
          const human = isHumanStep(step.impl);
          const branch = isBranchStep(step.impl);
          return (
            <div key={step.id} className="workflow-step-wrap">
              <div
                className={`workflow-node${editable ? " workflow-node--editable" : ""}${
                  human ? " workflow-node--human" : ""
                }${branch ? " workflow-node--branch" : ""}`}
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
                      <span className="workflow-node-field-label">
                        What this step does
                      </span>
                      <select
                        value={step.impl}
                        onChange={(e) =>
                          updateStep(index, {
                            impl: e.target.value,
                            config: {},
                          })
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
                        <span className="workflow-node-field-label">
                          Min score
                        </span>
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
                      <span className="workflow-node-label">
                        {toolLabel(step.impl)}
                      </span>
                      {friendlyToolBlurb(step.impl) ? (
                        <span className="workflow-node-blurb muted">
                          {friendlyToolBlurb(step.impl)}
                        </span>
                      ) : null}
                      {human ? (
                        <span className="workflow-tag workflow-tag--human">
                          Needs a person
                        </span>
                      ) : null}
                      {branch ? (
                        <span className="workflow-tag workflow-tag--branch">
                          Chooses path by score
                        </span>
                      ) : null}
                      {stepConfigBits(step).map((bit) => (
                        <span key={bit} className="workflow-node-detail muted">
                          {bit}
                        </span>
                      ))}
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
          );
        })}

        <div className="workflow-node workflow-node--pill">Done</div>
      </div>

      {definition?.conditionalEdges && definition.conditionalEdges.length > 0 ? (
        <div className="workflow-branches">
          <strong>If the score is…</strong>
          <ul className="workflow-branch-list">
            {definition.conditionalEdges.flatMap((ce) =>
              Object.entries(ce.map).map(([k, v]) => (
                <li key={`${ce.from}-${k}`}>
                  {branchPlain(k)} →{" "}
                  {v === "__end__"
                    ? "end"
                    : friendlyToolTitle(
                        definition.nodes.find((n) => n.id === v)?.impl ?? v,
                      )}
                </li>
              )),
            )}
          </ul>
        </div>
      ) : null}

      {editable && onStepsChange ? (
        <button
          type="button"
          className="btn secondary btn--compact workflow-add-end"
          onClick={() => addStep()}
        >
          + Add step at end
        </button>
      ) : null}

      {editable ? (
        <p className="muted workflow-edit-hint">
          Save steps, then <strong>Make it live</strong> so this version runs when
          the start action happens.
        </p>
      ) : null}
    </div>
  );
}
