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
import { ROUTERS, type RouterSpec } from "../lib/graph-edit";
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

  /**
   * THE NAME COMES BEFORE THE `+`, READING DOWN THE PATH.
   *
   * Both sat in one row at the midpoint at first, which put three arms' worth
   * of controls in the one spot where three arms converge. Splitting them
   * helped but put the `+` above the name, so the canvas read "insert
   * something — into what?". Reversed: the name sits at the midpoint where
   * the arms have already separated, and the `+` sits below it, closer to the
   * step the path leads into. You read which path it is, then how to add to
   * it.
   */

  /**
   * WHERE A ROUTE'S NAME SITS, AND WHY IT MOVES FOR THE MIDDLE ONE.
   *
   * A smooth-step edge in a top-down layout drops, runs sideways, then drops
   * again — and every arm of one branch runs sideways at the SAME height. So
   * the arms either side of a three-way branch pass straight through the point
   * where the middle arm's name would sit, which is why the middle label
   * appeared to cover the routing.
   *
   * The middle arm has no sideways run to sit on, so its name goes halfway
   * down its first drop instead: above the band the other arms travel along,
   * clear of everything, and still unmistakably on its own line.
   */
  const straightDown = Math.abs(targetX - sourceX) < 8;
  const nameX = labelX;
  const nameY = straightDown ? sourceY + (labelY - sourceY) * 0.55 : labelY;

  /**
   * The `+` goes on the arm's LAST drop, which every arm has and which is
   * always directly above the step it leads into. Interpolating between the
   * two endpoints instead put the button in open canvas for any arm that
   * turned a corner — a control floating next to a line rather than on it.
   */
  const insertX = targetX;
  const insertY = labelY + (targetY - labelY) * 0.5;
  return (
    <>
      <BaseEdge id={id} path={path} />
      <EdgeLabelRenderer>
        {label ? (
          <div
            className="ge-edge-tools ge-edge-tools--label"
            style={{
              transform: `translate(-50%, -50%) translate(${nameX}px, ${nameY}px)`,
            }}
          >
            <span className="ge-edge-label">{String(label)}</span>
          </div>
        ) : null}
        {onInsert ? (
          <div
            className="ge-edge-tools"
            style={{
              transform: label
                ? `translate(-50%, -50%) translate(${insertX}px, ${insertY}px)`
                : `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            <button
              type="button"
              className="ge-insert"
              title={
                label
                  ? `Insert a step on the ${String(label)} path`
                  : "Insert a step here"
              }
              aria-label={
                label
                  ? `Insert a step on the ${String(label)} path`
                  : "Insert a step here"
              }
              onClick={(e) => {
                e.stopPropagation();
                onInsert();
              }}
            >
              +
            </button>
          </div>
        ) : null}
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
        // A `declared` node's schemas are real even though the engine
        // runs it, so its inputs are worth checking against.
        checkable: node.source !== "legacy" && inputs.length > 0,
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
  onBranch,
  branchBlocked,
  onClose,
}: {
  candidates: PickerCandidate[];
  module: string;
  onPick: (node: RegistryNode) => void;
  /** Fork here instead of inserting a step. */
  onBranch: (router: RouterSpec) => void;
  /** Per router, why it cannot be used here — null when it can. */
  branchBlocked: (router: RouterSpec) => string | null;
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

  /*
    "Fits here" used to mean "an earlier step declares an output with this
    name", which the runtime never honoured — a step reads the trigger
    payload, not the step before it. It now means the field will genuinely be
    present: carried by the trigger, or mapped in by a step along the way.
  */
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
                {c.satisfied.join(", ")} will be there
              </span>
            ) : null}
            {c.missing.length > 0 ? (
              <span className="ge-pick-missing">
                needs {c.missing.join(", ")} — nothing provides that here
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
      aria-label="Insert a step or add a branch"
      onClick={onClose}
    >
      <div className="ge-picker" onClick={(e) => e.stopPropagation()}>
        <header className="ge-picker-head">
          <div>
            <h3 className="ge-picker-title">What happens here</h3>
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
          {/*
            BRANCHING LIVES HERE, NOT IN A SEPARATE CONTROL.

            "What happens next" is one question. Sometimes the answer is a step
            and sometimes it is a fork, and making those two different gestures
            in different places is why nobody found the second one.

            The outcome names are not offered for editing: the runtime's router
            returns exactly these strings, and an arm named anything else is
            simply never taken — silently, with no error and no failed run.
          */}
          <div className="ge-pick-group">
            <h4 className="ge-pick-group-title">
              Or branch here <span className="ge-muted">two paths, not one</span>
            </h4>
            {ROUTERS.map((r) => {
              const blocked = branchBlocked(r);
              return (
                <button
                  key={r.key}
                  type="button"
                  className={`ge-pick-item${blocked ? " ge-pick-item--off" : ""}`}
                  disabled={Boolean(blocked)}
                  onClick={() => onBranch(r)}
                  title={blocked ?? undefined}
                >
                  <span className="ge-pick-head">
                    <span className="ge-pick-key">{r.label}</span>
                    <span className="ge-effect ge-effect--control">branch</span>
                  </span>
                  <span className="ge-pick-desc">{r.why}</span>
                  <span className="ge-pick-match">
                    paths: {r.outcomes.join(" · ")}
                  </span>
                  {blocked ? (
                    <span className="ge-pick-missing">{blocked}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {group("Fits here", "everything it needs will be there", fits)}
          {group("Possible", "nothing it needs is missing", possible)}
          {group("Needs data that does not reach this point", "", needs)}
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

/**
 * Screen 9 — what the go-live gate would say, shown while there is still time.
 *
 * Sits below the editor's own validation because the two answer different
 * questions and must not be mistaken for each other. Validation asks "is this
 * canvas coherent" and runs in the browser on every keystroke. These are the
 * release checks: they run on the server, against the stored draft and the
 * node registry, and they are what actually refuses a release.
 *
 * An author used to meet them for the first time at the moment they were
 * refused. Nothing about the checks changed — only when you can see them.
 */
export function GoLiveChecksRail({
  checks,
  loading,
}: {
  checks: import("../api/editor").GoLiveChecks | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <section className="ge-rail" aria-label="Go-live checks">
        <h3 className="ge-rail-title">
          Go-live checks<span className="ge-muted">checking…</span>
        </h3>
      </section>
    );
  }
  if (!checks) return null;

  /**
   * A runtime workflow key. The gate refuses these on purpose, so running it
   * would produce a wall of failures that mean nothing about this workflow.
   * Saying why beats showing them.
   */
  if (!checks.applicable) {
    return (
      <section className="ge-rail" aria-label="Go-live checks">
        <h3 className="ge-rail-title">
          Go-live checks<span className="ge-muted">not applicable</span>
        </h3>
        <p className="ge-rail-note">{checks.reason}</p>
      </section>
    );
  }

  const failed = checks.checks.filter((c) => !c.ok).length;
  return (
    <section className="ge-rail" aria-label="Go-live checks">
      <h3 className="ge-rail-title">
        Go-live checks
        <span className="ge-muted">
          {failed === 0
            ? `all ${checks.checks.length} pass`
            : `${failed} of ${checks.checks.length} would block`}
        </span>
      </h3>
      <ul className="ge-rail-list">
        {checks.checks.map((c) => (
          <li
            key={c.id}
            className={`ge-rail-item ge-rail-item--${c.ok ? "ok" : "error"}`}
          >
            <span className="ge-rail-mark">{c.ok ? "✓" : "!"}</span>
            <span>
              <code className="ge-rail-id">{c.id}</code>
              <span className="ge-rail-text">{c.message}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Screen 8 — what changed since the previous version.
 *
 * Field-level, not textual. The most common real change is one config value,
 * and a text diff renders that as several changed lines somewhere inside a
 * hundred unchanged ones, with the author left to find it.
 *
 * The summary line is written to be trusted: when it says "One setting
 * changed: match.matchThreshold 60 → 92" that is the whole story, and nobody
 * has to read the list underneath.
 */
export function WhatChangedRail({
  diff,
  loading,
}: {
  diff: import("../api/editor").DiffResponse | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <section className="ge-rail" aria-label="What changed">
        <h3 className="ge-rail-title">
          What changed<span className="ge-muted">comparing…</span>
        </h3>
      </section>
    );
  }
  if (!diff) return null;

  if (!diff.diff) {
    return (
      <section className="ge-rail" aria-label="What changed">
        <h3 className="ge-rail-title">
          What changed<span className="ge-muted">first version</span>
        </h3>
        <p className="ge-rail-note">{diff.note}</p>
      </section>
    );
  }

  const d = diff.diff;
  const val = (v: unknown) =>
    v === undefined ? "unset" : typeof v === "string" ? v : JSON.stringify(v);

  return (
    <section className="ge-rail" aria-label="What changed">
      <h3 className="ge-rail-title">
        What changed
        <span className="ge-muted">
          v{diff.from} → v{diff.to}
        </span>
      </h3>

      <p className="ge-rail-note">{d.summary}</p>

      {d.identical ? null : (
        <ul className="ge-rail-list">
          {d.trigger.changed ? (
            <li className="ge-rail-item ge-rail-item--warning">
              <span className="ge-rail-mark">→</span>
              <span>
                <code className="ge-rail-id">trigger</code>
                <span className="ge-rail-text">
                  {d.trigger.from ?? "none"} → {d.trigger.to ?? "none"}
                </span>
              </span>
            </li>
          ) : null}

          {d.nodes.map((n) => (
            <li
              key={n.id}
              className={`ge-rail-item ge-rail-item--${
                n.kind === "removed" ? "error" : n.kind === "added" ? "ok" : "warning"
              }`}
            >
              <span className="ge-rail-mark">
                {n.kind === "added" ? "+" : n.kind === "removed" ? "−" : "→"}
              </span>
              <span>
                <code className="ge-rail-id">
                  {n.id} · {n.impl}
                </code>
                {/* A step swapped for a different one is a bigger change than
                    a setting, and reads as one. */}
                {n.implFrom ? (
                  <span className="ge-rail-text">
                    step was {n.implFrom}
                  </span>
                ) : null}
                {n.config.map((c) => (
                  <span key={c.field} className="ge-rail-text">
                    {c.field}: {val(c.from)} → {val(c.to)}
                  </span>
                ))}
                {n.kind !== "changed" ? (
                  <span className="ge-rail-text">
                    {n.kind === "added" ? "added" : "removed"}
                  </span>
                ) : null}
              </span>
            </li>
          ))}

          {[...d.edgesRemoved.map((e) => ["−", e] as const),
            ...d.edgesAdded.map((e) => ["+", e] as const)].map(([mark, e], i) => (
            <li
              key={`${mark}-${e[0]}-${e[1]}-${i}`}
              className={`ge-rail-item ge-rail-item--${mark === "+" ? "ok" : "error"}`}
            >
              <span className="ge-rail-mark">{mark}</span>
              <span>
                <span className="ge-rail-text">
                  {e[0]} → {e[1]}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
