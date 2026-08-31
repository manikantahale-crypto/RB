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
import type { JsonSchema, RegistryNode } from "../api/editor";
import type { Finding } from "../lib/graph-validate";

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
  // The edge already knows which edge it is; the callback carries the
  // reference so nothing has to be recovered by parsing this id.
  const onInsert = (data as { onInsert?: () => void } | undefined)?.onInsert;

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
                onInsert();
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

/**
 * The checks themselves are pure and live in `lib/graph-validate.ts` so they
 * can be tested without the canvas. Re-exported here because this is where the
 * screen has always imported them from.
 */
export type { Finding };
export { validate } from "../lib/graph-validate";

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
