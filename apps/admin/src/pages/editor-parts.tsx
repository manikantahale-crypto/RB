/**
 * Screen 4 — the insert-on-edge control, the node picker, and the validation
 * rail. Split out of GraphEditor.tsx to keep that file about the screen rather
 * than about its parts.
 */
import { useMemo, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import type { GraphDefinition, JsonSchema, RegistryNode } from "../api/editor";

/* ─────────────────────── insert-on-edge control ──────────────────────── */

/**
 * An edge with a `+` at its midpoint.
 *
 * Structure is edited by inserting on an edge, never by dragging boxes around.
 * That is what makes the drawing a projection of the topology rather than a
 * picture someone arranged — and it is why layout is never stored.
 */
export function InsertableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const onInsert = (data as { onInsert?: (edgeId: string) => void } | undefined)
    ?.onInsert;

  return (
    <>
      <BaseEdge id={id} path={path} />
      <EdgeLabelRenderer>
        <div
          className="ge-edge-tools"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {label ? <span className="ge-edge-label">{String(label)}</span> : null}
          {onInsert ? (
            <button
              type="button"
              className="ge-insert"
              title="Insert a step here"
              aria-label="Insert a step here"
              onClick={(e) => {
                e.stopPropagation();
                onInsert(id);
              }}
            >
              +
            </button>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/* ───────────────────────────── node picker ───────────────────────────── */

function propsOf(schema: JsonSchema | null): string[] {
  return Object.keys(schema?.properties ?? {});
}

export type PickerCandidate = {
  node: RegistryNode;
  /** Input fields this node needs that something upstream already produces. */
  satisfied: string[];
  /** Declared required fields nothing upstream produces. */
  missing: string[];
  checkable: boolean;
};

/**
 * Which nodes make sense at this point in the workflow.
 *
 * The spec asks for "only nodes whose input is satisfiable at that edge". That
 * is only answerable where both sides declared themselves, so this reports what
 * it can and says so where it cannot, rather than filtering on a guess:
 *
 *   fits here     — something upstream produces a field this node takes
 *   possible      — nothing overlaps, but nothing declared is missing either
 *   needs data    — a required field nothing upstream produces
 *   unchecked     — the node has no contract, so nothing can be said
 */
export function rankCandidates(
  registry: RegistryNode[],
  upstreamOutputs: string[],
): PickerCandidate[] {
  const available = new Set(upstreamOutputs);
  return registry
    .map((node) => {
      const inputs = propsOf(node.inputSchema);
      const required = node.inputSchema?.required ?? [];
      const satisfied = inputs.filter((f) => available.has(f));
      const missing = required.filter((f) => !available.has(f));
      return {
        node,
        satisfied,
        missing,
        checkable: node.source === "contract" && inputs.length > 0,
      };
    })
    .sort((a, b) => {
      if (a.checkable !== b.checkable) return a.checkable ? -1 : 1;
      if (b.satisfied.length !== a.satisfied.length)
        return b.satisfied.length - a.satisfied.length;
      return a.node.key.localeCompare(b.node.key);
    });
}

export function NodePicker({
  candidates,
  module,
  onPick,
  onClose,
}: {
  candidates: PickerCandidate[];
  module: string;
  onPick: (node: RegistryNode) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        c.node.key.toLowerCase().includes(q) ||
        c.node.title.toLowerCase().includes(q) ||
        c.node.description.toLowerCase().includes(q),
    );
  }, [candidates, query]);

  const fits = shown.filter((c) => c.checkable && c.satisfied.length > 0);
  const possible = shown.filter(
    (c) => c.checkable && c.satisfied.length === 0 && c.missing.length === 0,
  );
  const needs = shown.filter((c) => c.checkable && c.missing.length > 0);
  const unchecked = shown.filter((c) => !c.checkable);

  const group = (title: string, note: string, list: PickerCandidate[]) =>
    list.length === 0 ? null : (
      <div className="ge-pick-group" key={title}>
        <h4 className="ge-pick-group-title">
          {title} <span className="ge-muted">{note}</span>
        </h4>
        {list.map((c) => (
          <button
            key={c.node.registryKey}
            type="button"
            className="ge-pick-item"
            onClick={() => onPick(c.node)}
          >
            <span className="ge-pick-head">
              <span className="ge-pick-key">{c.node.key}</span>
              {c.node.sideEffect ? (
                <span className={`ge-effect ge-effect--${c.node.sideEffect}`}>
                  {c.node.sideEffect.replace("_", " ")}
                </span>
              ) : null}
              {c.node.module !== module ? (
                <span className="ge-flag" title="Shared by another module">
                  {c.node.module}
                </span>
              ) : null}
              {c.node.requiresAllowlist ? (
                <span
                  className="ge-flag ge-flag--warn"
                  title="Something leaves the building — inserting this needs written justification."
                >
                  allowlist
                </span>
              ) : null}
            </span>
            <span className="ge-pick-desc">{c.node.description}</span>
            {c.satisfied.length > 0 ? (
              <span className="ge-pick-match">
                takes {c.satisfied.join(", ")} from an earlier step
              </span>
            ) : null}
            {c.missing.length > 0 ? (
              <span className="ge-pick-missing">
                needs {c.missing.join(", ")} — nothing here produces that
              </span>
            ) : null}
          </button>
        ))}
      </div>
    );

  return (
    <div
      className="ge-picker-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Insert a step"
      onClick={onClose}
    >
      <div className="ge-picker" onClick={(e) => e.stopPropagation()}>
        <header className="ge-picker-head">
          <div>
            <h3 className="ge-picker-title">Insert a step</h3>
            <p className="ge-muted">
              Steps this <strong>{module}</strong> workflow may use — its own,
              plus anything another module shared.
            </p>
          </div>
          <button type="button" className="wf-btn" onClick={onClose}>
            Cancel
          </button>
        </header>
        <input
          className="ge-input"
          autoFocus
          placeholder="Search steps…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="ge-picker-body">
          {group("Fits here", "takes what an earlier step produces", fits)}
          {group("Possible", "nothing it needs is missing", possible)}
          {group("Needs data this point does not have", "", needs)}
          {group("Cannot be checked", "no contract — nothing declared", unchecked)}
          {shown.length === 0 ? (
            <p className="wf-empty">No step matches that search.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────── validation ─────────────────────────────── */

export type Finding = {
  level: "error" | "warning" | "ok";
  text: string;
  detail?: string;
};

/**
 * Re-run on every edit. Errors block saving; warnings advise.
 *
 * The split matters: a workflow with no fixtures is worth flagging but is not
 * broken, while a workflow with a step nothing can run IS broken and must not
 * be saved as if it were fine.
 */
export function validate(
  def: GraphDefinition,
  registry: RegistryNode[],
): Finding[] {
  const findings: Finding[] = [];
  const byKey = new Map(registry.map((n) => [n.key, n]));
  const ids = new Set(def.nodes.map((n) => n.id));

  // 1 — every step resolves to something the runtime can run
  const unknown = def.nodes.filter((n) => !byKey.has(n.impl));
  findings.push(
    unknown.length === 0
      ? { level: "ok", text: "Every step resolves" }
      : {
          level: "error",
          text: `${unknown.length} step${unknown.length === 1 ? "" : "s"} the runtime cannot run`,
          detail: unknown.map((n) => `${n.id} → ${n.impl}`).join(", "),
        },
  );

  // 2 — edges point at steps that exist
  const dangling = def.edges.filter(
    ([from, to]) =>
      (from !== "__start__" && !ids.has(from)) ||
      (to !== "__end__" && !ids.has(to)),
  );
  findings.push(
    dangling.length === 0
      ? { level: "ok", text: "Edges connect real steps" }
      : {
          level: "error",
          text: `${dangling.length} edge${dangling.length === 1 ? "" : "s"} point nowhere`,
          detail: dangling.map(([f, t]) => `${f} → ${t}`).join(", "),
        },
  );

  // 3 — nothing stranded: every step is reachable from the start
  const reachable = new Set<string>();
  const walk = (from: string) => {
    for (const [a, b] of def.edges) {
      if (a === from && b !== "__end__" && !reachable.has(b)) {
        reachable.add(b);
        walk(b);
      }
    }
    for (const ce of def.conditionalEdges ?? []) {
      if (ce.from !== from) continue;
      for (const target of Object.values(ce.map)) {
        if (!reachable.has(target)) {
          reachable.add(target);
          walk(target);
        }
      }
    }
  };
  walk("__start__");
  const orphaned = def.nodes.filter((n) => !reachable.has(n.id));
  findings.push(
    orphaned.length === 0
      ? { level: "ok", text: "No stranded steps" }
      : {
          level: "error",
          text: `${orphaned.length} step${orphaned.length === 1 ? "" : "s"} nothing leads to`,
          detail: orphaned.map((n) => n.id).join(", "),
        },
  );

  // 4 — anything that leaves the building needs written justification
  const external = def.nodes.filter((n) => byKey.get(n.impl)?.requiresAllowlist);
  if (external.length > 0) {
    findings.push({
      level: "warning",
      text: `${external.length} step${external.length === 1 ? "" : "s"} reach outside the company`,
      detail: `${external.map((n) => n.id).join(", ")} — each needs a written justification before release`,
    });
  }

  // 5 — a step with no worked example cannot be checked automatically
  const noFixture = def.nodes.filter((n) => {
    const c = byKey.get(n.impl);
    return c?.source === "contract" && c.fixtureNames.length === 0;
  });
  if (noFixture.length > 0) {
    findings.push({
      level: "warning",
      text: `${noFixture.length} step${noFixture.length === 1 ? "" : "s"} have no worked example`,
      detail: noFixture.map((n) => n.id).join(", "),
    });
  }

  // 6 — undeclared steps cannot be checked at all
  const legacy = def.nodes.filter((n) => byKey.get(n.impl)?.source === "legacy");
  if (legacy.length > 0) {
    findings.push({
      level: "warning",
      text: `${legacy.length} step${legacy.length === 1 ? "" : "s"} have no contract`,
      detail: `${legacy.map((n) => n.id).join(", ")} — settings and data cannot be checked`,
    });
  }

  return findings;
}

export function ValidationRail({ findings }: { findings: Finding[] }) {
  const errors = findings.filter((f) => f.level === "error").length;
  return (
    <section className="ge-rail" aria-label="Validation">
      <h3 className="ge-rail-title">
        Validation
        <span className="ge-muted">
          {errors > 0 ? "errors block saving" : "warnings advise"}
        </span>
      </h3>
      <ul className="ge-rail-list">
        {findings.map((f, i) => (
          <li key={i} className={`ge-rail-item ge-rail-item--${f.level}`}>
            <span className="ge-rail-mark" aria-hidden="true">
              {f.level === "ok" ? "✓" : f.level === "warning" ? "!" : "✗"}
            </span>
            <span>
              <span className="ge-rail-text">{f.text}</span>
              {f.detail ? (
                <span className="ge-rail-detail">{f.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
