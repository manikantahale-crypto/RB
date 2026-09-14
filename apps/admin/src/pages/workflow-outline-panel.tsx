/**
 * "Is this the workflow I meant?" — answered at the top of its history page.
 *
 * WHY THIS IS NOT A SMALLER RUN PAGE.
 *
 * Somebody who lands on a list of runs has usually arrived from a search and
 * wants to know what the workflow does before deciding whether any of those
 * runs are worth reading. The only way to find that out used to be opening a
 * run — which answers a different question at much greater length, with logs,
 * per-node input and output, and timings, all of them about one execution.
 *
 * So this shows the SHAPE and nothing else. No run is involved and none is
 * highlighted, and there is deliberately no per-node detail: clicking a node
 * here does nothing, because everything worth knowing about a node belongs to
 * either the editor or a run, and both are one click away.
 *
 * WHY A CANVAS AND NOT A STRIP.
 *
 * This was first built as a horizontal strip of steps in topological order.
 * That reads well for a chain of four and misrepresents everything else: a
 * workflow that splits three ways renders as three consecutive steps, which
 * says the opposite of what the workflow does. Anything with branches has to
 * be drawn, and anything drawn has to be pannable and zoomable or a big graph
 * is just a small unreadable one.
 *
 * Fixed height, and the canvas scrolls internally rather than the page
 * growing: this sits ABOVE the run list, and a panel that grows with the graph
 * pushes the actual content of the page off the screen.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { loadOutline, type WorkflowOutline } from "../api/editor";

const NODE_W = 168;
const NODE_H = 46;

type OutlineNodeData = {
  label: string;
  kind: "trigger" | "end" | "step";
  unknown: boolean;
};

/**
 * Small on purpose. This is a thumbnail of the workflow, not the editor — the
 * node id is what identifies a step when somebody is checking they have the
 * right workflow, and impl keys at this size are unreadable noise.
 */
function OutlineNode({ data }: { data: OutlineNodeData }) {
  if (data.kind === "trigger") {
    return (
      <div className="wo-n wo-n--trigger" title={data.label}>
        <span aria-hidden="true">⚡</span>
        <span className="wo-n-label">{data.label}</span>
        <Handle type="source" position={Position.Bottom} className="wo-h" />
      </div>
    );
  }
  if (data.kind === "end") {
    return (
      <div className="wo-n wo-n--end">
        <Handle type="target" position={Position.Top} className="wo-h" />
        <span className="wo-n-label">{data.label}</span>
      </div>
    );
  }
  return (
    <div
      className={`wo-n wo-n--step${data.unknown ? " wo-n--unknown" : ""}`}
      title={data.unknown ? `${data.label} — not in the node registry` : data.label}
    >
      <Handle type="target" position={Position.Top} className="wo-h" />
      <span className="wo-n-label">{data.label}</span>
      <Handle type="source" position={Position.Bottom} className="wo-h" />
    </div>
  );
}

const nodeTypes = { outlineNode: OutlineNode };

function layout(nodes: Node[], edges: Edge[]): Node[] {
  /**
   * `multigraph` is not optional. Two arms of one branch often lead to the
   * same place — both ending the workflow is the usual case — and a plain
   * graph collapses those into one edge, so dagre lays out a fork it cannot
   * see and the arms come back drawn on top of each other.
   */
  const g = new dagre.graphlib.Graph({ multigraph: true }).setDefaultEdgeLabel(
    () => ({}),
  );
  const branching = edges.some((e) => e.label);
  g.setGraph({
    rankdir: "TB",
    nodesep: branching ? 28 : 18,
    ranksep: branching ? 46 : 34,
  });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target, {}, e.id));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      targetPosition: Position.Top,
      sourcePosition: Position.Bottom,
    };
  });
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function WorkflowOutlinePanel({ graphKey }: { graphKey: string }) {
  const [outline, setOutline] = useState<WorkflowOutline | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Collapsible, open by default, remembered per browser rather than per
   * workflow: somebody who wants this out of the way wants it out of the way
   * everywhere, and a per-key preference means it reappears on every workflow
   * they have not visited. Wrapped because storage throws outright in a
   * private window and in the thumbnail renderer.
   */
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("wf-outline-collapsed") !== "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    let cancelled = false;
    setOutline(null);
    setError(null);
    void loadOutline(graphKey).then((res) => {
      if (cancelled) return;
      if (res.ok) setOutline(res.data);
      else setError(res.body.message ?? res.body.error ?? "No design to show");
    });
    return () => {
      cancelled = true;
    };
  }, [graphKey]);

  const { nodes, edges } = useMemo(() => {
    if (!outline) return { nodes: [] as Node[], edges: [] as Edge[] };

    const stepIds = new Set(outline.steps.map((s) => s.id));
    const ns: Node[] = outline.steps.map((s) => ({
      id: s.id,
      type: "outlineNode",
      position: { x: 0, y: 0 },
      data: { label: s.id, kind: "step", unknown: s.unknown } as OutlineNodeData,
      draggable: false,
      selectable: false,
    }));

    // The trigger and the end are drawn, because "when does this run" and
    // "where does it finish" are half of what the shape says.
    const usesStart = outline.edges.some((e) => e.from === "__start__");
    const usesEnd = outline.edges.some((e) => e.to === "__end__");
    if (usesStart) {
      ns.unshift({
        id: "__start__",
        type: "outlineNode",
        position: { x: 0, y: 0 },
        data: {
          label:
            outline.triggers.length > 0
              ? outline.triggers.join(", ")
              : "nothing starts this",
          kind: "trigger",
          unknown: false,
        } as OutlineNodeData,
        draggable: false,
        selectable: false,
      });
    }
    if (usesEnd) {
      ns.push({
        id: "__end__",
        type: "outlineNode",
        position: { x: 0, y: 0 },
        data: { label: "done", kind: "end", unknown: false } as OutlineNodeData,
        draggable: false,
        selectable: false,
      });
    }

    const drawable = new Set(ns.map((x) => x.id));
    const es: Edge[] = outline.edges
      .filter((e) => drawable.has(e.from) && drawable.has(e.to))
      .map((e, i) => ({
        id: `${e.from}->${e.to}:${e.label ?? i}`,
        source: e.from,
        target: e.to,
        label: e.label ?? undefined,
        animated: false,
        className: e.label ? "wo-edge wo-edge--arm" : "wo-edge",
      }));

    // A workflow whose steps are connected by nothing still has to draw. Its
    // steps simply sit side by side, which is the truth about it.
    void stepIds;
    return { nodes: layout(ns, es), edges: es };
  }, [outline]);

  const toggle = () => {
    setOpen((v) => {
      try {
        localStorage.setItem("wf-outline-collapsed", v ? "1" : "0");
      } catch {
        /* a preference is not worth failing a render over */
      }
      return !v;
    });
  };

  // A workflow with no version yet is the ordinary case for something being
  // built. The run list below is still the point of the page, so this says
  // nothing rather than showing an empty frame.
  if (error) return null;

  return (
    <section className="wf-outline" aria-label="What this workflow does">
      <div className="wf-outline-head">
        <button
          type="button"
          className="wf-outline-toggle"
          aria-expanded={open}
          onClick={toggle}
        >
          <span className="wf-outline-caret" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          The workflow
        </button>
        {outline ? (
          <span className="wf-outline-facts">
            <span
              className={`wf-outline-ver${outline.live ? " wf-outline-ver--live" : ""}`}
            >
              v{outline.version} {outline.live ? "live" : outline.status}
            </span>
          </span>
        ) : null}
      </div>

      {open ? (
        outline === null ? (
          <p className="wf-outline-loading">Loading…</p>
        ) : (
          <div className="wf-outline-body">
            <div className="wf-outline-canvas">
              {outline.steps.length === 0 ? (
                <p className="wo-empty">
                  This version has no steps — nothing is stored for it.
                </p>
              ) : (
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  fitView
                  /* Room around a fitted graph, so a one-step workflow is not
                     blown up to fill the frame. */
                  fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
                  minZoom={0.15}
                  maxZoom={2}
                  panOnDrag
                  zoomOnScroll={false}
                  /* Scroll wheel must scroll the PAGE. This panel sits above
                     the run list, and hijacking the wheel means somebody
                     scrolling towards the runs zooms the diagram instead. The
                     Controls below, and ctrl+wheel, still zoom. */
                  zoomOnPinch
                  preventScrolling={false}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={16} />
                  <Controls showInteractive={false} />
                </ReactFlow>
              )}
            </div>

            {/* Facts about the whole workflow. Nothing node-by-node — that is
                the editor's job, and the link goes there. */}
            <dl className="wf-outline-meta">
              <div>
                <dt>Starts on</dt>
                <dd>
                  {outline.triggers.length === 0 ? (
                    <span className="wo-warn">
                      nothing — it is live and cannot run
                    </span>
                  ) : (
                    outline.triggers.map((t) => (
                      <span key={t} className="wo-meta-event">
                        {t}
                      </span>
                    ))
                  )}
                  {outline.triggerSource === "draft" ? (
                    <span className="wo-note">bound at go-live</span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>Steps</dt>
                <dd>
                  {outline.steps.length}
                  {outline.branchCount > 0
                    ? `, splitting in ${outline.branchCount} place${outline.branchCount === 1 ? "" : "s"}`
                    : ", in a straight line"}
                </dd>
              </div>
              {outline.steps.some((s) => s.unknown) ? (
                <div>
                  <dt>Warning</dt>
                  <dd>
                    <span className="wo-warn">
                      {outline.steps.filter((s) => s.unknown).length} step(s) are
                      not in the node registry
                    </span>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Version</dt>
                <dd>
                  v{outline.version} · {outline.live ? "live" : outline.status} ·
                  built {formatWhen(outline.compiledAt)}
                </dd>
              </div>
              <div>
                <dt />
                <dd>
                  <Link
                    className="wf-outline-open"
                    to={`/workflows/${encodeURIComponent(graphKey)}/edit?version=${outline.version}`}
                  >
                    Open in editor →
                  </Link>
                </dd>
              </div>
            </dl>
          </div>
        )
      ) : null}
    </section>
  );
}
