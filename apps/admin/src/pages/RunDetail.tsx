/**
 * Screen 13 — Run detail. "The executed graph, with its story."
 *
 * Laid out as the wireframe specifies: a graph canvas on the left, the
 * selected node's detail on the right, and Timeline / Logs / Outcome tabs
 * underneath. Hover a node for status, latency and attempts; click it for the
 * full record.
 *
 * ONLY THE EXECUTED PATH IS DRAWN. The wireframe also shows untaken branches
 * ghosted, which needs the topology of the version this run executed — a
 * different problem, deliberately out of scope here.
 *
 * EVERYTHING COMES FROM `orch.steps`, which was written as the run happened.
 * Nothing is reconstructed from the workflow's current shape, so this screen
 * still tells the truth about a run whose graph has been re-authored since.
 *
 * A node that failed and was retried is ONE node carrying its attempts, not
 * several nodes — that is what the wireframe's "3 attempts · 61s" means.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import {
  getRunDetail,
  type RunDetail,
  type RunPathNode,
  type RunStep,
} from "../api";
import { token } from "../lib/tokens.js";

const NODE_W = 210;
const NODE_H = 74;

/* ─────────────────────────────── helpers ─────────────────────────────── */

function statusKind(status: string): "ok" | "failed" | "waiting" | "other" {
  const s = status.toUpperCase();
  if (s === "OK" || s === "COMPLETED") return "ok";
  if (s === "FAILED") return "failed";
  if (s === "WAITING_APPROVAL") return "waiting";
  return "other";
}

function statusLabel(status: string): string {
  if (status === "WAITING_APPROVAL") return "Waiting on a person";
  if (status === "OK") return "OK";
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}

function duration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  return `${mins}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return JSON.stringify(error);
}

function clock(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString() : "—";
}

/* ──────────────────────────── the graph node ─────────────────────────── */

type PathNodeData = {
  label: string;
  tool: string | null;
  status: string;
  attempts: number;
  latencyMs: number;
  selected: boolean;
};

function RunNode({ data }: { data: PathNodeData }) {
  const kind = statusKind(data.status);
  return (
    <div
      className={`rf-node rf-node--${kind}${data.selected ? " rf-node--on" : ""}`}
      /* Hover = status · latency · attempts, per the wireframe. */
      title={`${data.label} — ${statusLabel(data.status)} · ${duration(
        data.latencyMs,
      )}${data.attempts > 1 ? ` · ${data.attempts} attempts` : ""}`}
    >
      <Handle type="target" position={Position.Top} className="rf-handle" />
      <div className="rf-node-top">
        <span className={`rf-dot rf-dot--${kind}`} aria-hidden="true" />
        <span className="rf-node-name">{data.label}</span>
      </div>
      <div className="rf-node-meta">
        <span>{duration(data.latencyMs)}</span>
        {data.attempts > 1 ? (
          <span className="rf-attempts">{data.attempts} attempts</span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Bottom} className="rf-handle" />
    </div>
  );
}

const nodeTypes = { runNode: RunNode };

function layout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  // Top-to-bottom: a run is a sequence, and reading it downward matches how
  // the log below reads. Vertical also keeps long paths legible — a wide
  // horizontal chain runs off the side long before a tall one does.
  g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 42 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
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

/* ───────────────────────────── the screen ────────────────────────────── */

type TabKey = "timeline" | "logs" | "outcome";

export function RunDetailPage() {
  const { runId = "" } = useParams();
  const [data, setData] = useState<{
    run: RunDetail;
    path: RunPathNode[];
    steps: RunStep[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("timeline");

  const load = useCallback(async () => {
    if (!runId) return;
    setFetching(true);
    setError(null);
    const res = await getRunDetail(runId);
    if (res.ok) {
      setData(res.data);
      setSelected((cur) => cur ?? res.data.path[0]?.node ?? null);
    } else {
      setError(res.body.message ?? res.body.error ?? "Could not load this run");
    }
    setFetching(false);
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = data?.run;

  const { nodes, edges } = useMemo(() => {
    const path = data?.path ?? [];
    const ns: Node[] = path.map((p) => ({
      id: p.node,
      type: "runNode",
      position: { x: 0, y: 0 },
      data: {
        label: p.node,
        tool: p.tool,
        status: p.status,
        attempts: p.attempts,
        latencyMs: p.totalLatencyMs,
        selected: p.node === selected,
      } satisfies PathNodeData,
    }));
    const es: Edge[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      es.push({
        id: `${path[i]!.node}->${path[i + 1]!.node}`,
        source: path[i]!.node,
        target: path[i + 1]!.node,
        type: "smoothstep",
        animated: false,
      });
    }
    return { nodes: layout(ns, es), edges: es };
  }, [data, selected]);

  /**
   * Tall enough for every node, so nothing is hidden and nothing needs
   * hunting for. Past the cap the container scrolls rather than shrinking the
   * graph to illegibility — a fifty-node run should be scrolled, not zoomed
   * out until the labels vanish.
   */
  const canvasHeight = Math.max(
    220,
    (data?.path.length ?? 0) * (NODE_H + 42) + 48,
  );

  const selectedNode = data?.path.find((p) => p.node === selected) ?? null;
  const selectedAttempts = (data?.steps ?? []).filter(
    (s) => s.node === selected,
  );

  /** Every event this run announced, node by node — the Outcome tab. */
  const emitted = useMemo(() => {
    const out: Array<{ node: string; event: string; at: string | null }> = [];
    for (const s of data?.steps ?? []) {
      const list = (s.output as { emitted?: unknown } | null)?.emitted;
      if (Array.isArray(list)) {
        for (const e of list) {
          if (typeof e === "string") out.push({ node: s.node, event: e, at: s.at });
        }
      }
    }
    return out;
  }, [data]);

  const failure = run && run.status === "FAILED" ? errorMessage(run.error) : null;
  /**
   * An error recorded on a run that COMPLETED is not a failure — it is the
   * last transient error before a retry succeeded, and the runtime never
   * clears it. Reporting it as "this run failed" was wrong: run 5851b15a
   * completed cleanly after `normalize` failed once and was retried.
   */
  const recovered =
    run && run.status !== "FAILED" ? errorMessage(run.error) : null;

  return (
    <div className="rd-page" data-testid="run-detail">
      <header className="rd-header">
        <div className="rd-header-main">
          {run ? (
            <Link
              to={`/workflows/${encodeURIComponent(run.graphKey)}/runs`}
              className="run-back"
            >
              ← All runs of {run.graphKey}
            </Link>
          ) : (
            <Link to="/workflows" className="run-back">
              ← All workflows
            </Link>
          )}
          {/*
            The title is the WORKFLOW, because that is what a person is looking
            at; the run id is an identifier, not a name. Everything else moves
            into a labelled strip below rather than being strung together with
            middle dots, which read as clutter once there were five of them.
          */}
          <h1 className="rd-run-title">
            {run ? run.graphKey : "Run"}
            {run ? (
              <span className={`run-status run-status--${statusKind(run.status)}`}>
                {statusLabel(run.status)}
              </span>
            ) : null}
          </h1>
          {run ? (
            <dl className="rd-meta">
              <div className="rd-meta-item">
                <dt>Run</dt>
                <dd><code title={run.runId}>{run.runId.slice(0, 8)}</code></dd>
              </div>
              <div className="rd-meta-item">
                <dt>Version</dt>
                <dd>
                  {run.pinnedVersion != null ? (
                    `v${run.pinnedVersion}`
                  ) : (
                    <span
                      className="wf-muted"
                      title="Not recorded when this run executed."
                    >
                      unknown
                    </span>
                  )}
                </dd>
              </div>
              <div className="rd-meta-item">
                <dt>Started by</dt>
                <dd>
                  {run.triggerEvent ? (
                    <code>{run.triggerEvent}</code>
                  ) : (
                    <span className="wf-muted">unknown</span>
                  )}
                </dd>
              </div>
              <div className="rd-meta-item">
                <dt>Took</dt>
                <dd>{duration(run.durationMs)}</dd>
              </div>
              <div className="rd-meta-item">
                <dt>Started</dt>
                <dd>
                  {run.startedAt
                    ? new Date(run.startedAt).toLocaleString()
                    : "—"}
                </dd>
              </div>
              <div className="rd-meta-item">
                <dt>Correlation</dt>
                <dd>
                  {run.correlationId ? (
                    <code title={run.correlationId}>
                      {run.correlationId.slice(0, 8)}
                    </code>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>
        <div className="rd-actions">
          <button type="button" className="wf-btn" disabled title="Not built yet">
            Retry from failed node
          </button>
          <button type="button" className="wf-btn" disabled title="Not built yet">
            Export fixture
          </button>
          <button
            type="button"
            className="wf-btn"
            onClick={() => void load()}
            disabled={fetching}
          >
            {fetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="wf-error" role="alert">
          {error}
        </div>
      ) : null}
      {!data && !error ? <p className="wf-empty">Loading run…</p> : null}

      {failure ? (
        <div className="wf-error" role="alert">
          <strong>This run failed.</strong> {failure}
        </div>
      ) : null}
      {recovered ? (
        <div className="wf-warning" role="status">
          <strong>Recovered after a failure.</strong> A step failed and was
          retried; the run finished as {statusLabel(run!.status).toLowerCase()}.
          Last error: {recovered}
        </div>
      ) : null}

      {data ? (
        <>
          {/* ── the two panels ─────────────────────────────────────────── */}
          <div className="rd-split">
            <section className="rd-canvas" aria-label="The path this run took">
              <div className="rd-canvas-head">
                <span className="rd-canvas-title">The path it took</span>
                <span className="rd-canvas-note">
                  hover for status · click for detail
                </span>
              </div>
              <div className="rd-canvas-scroll">
                {nodes.length === 0 ? (
                  <p className="wf-empty">
                    No steps were recorded. This run never reached a node.
                  </p>
                ) : (
                  <div
                    className="rd-canvas-inner"
                    style={{ height: `${canvasHeight}px` }}
                  >
                    <ReactFlow
                      nodes={nodes}
                      edges={edges}
                      nodeTypes={nodeTypes}
                      fitView
                      fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
                      nodesDraggable={false}
                      nodesConnectable={false}
                      zoomOnScroll={false}
                      panOnScroll={false}
                      preventScrolling={false}
                      proOptions={{ hideAttribution: true }}
                      onNodeClick={(_, n) => setSelected(n.id)}
                    >
                      <Background
                        gap={18}
                        size={0.5}
                        color={token("--slate-230", "#e8edf2")}
                      />
                    </ReactFlow>
                  </div>
                )}
              </div>
            </section>

            <aside className="rd-detail" aria-label="Node detail">
              {selectedNode ? (
                <>
                  <h2 className="rd-detail-title">{selectedNode.node}</h2>
                  {selectedNode.tool ? (
                    <p className="rd-detail-tool">{selectedNode.tool}</p>
                  ) : null}

                  <p className="rd-detail-status">
                    <span
                      className={`run-status run-status--${statusKind(
                        selectedNode.status,
                      )}`}
                    >
                      {statusLabel(selectedNode.status)}
                    </span>
                    {selectedNode.attempts > 1 ? (
                      <span className="rd-detail-attempts">
                        attempt {selectedNode.attempts}/{selectedNode.attempts}
                        {selectedNode.errorClass
                          ? ` · ${selectedNode.errorClass}`
                          : ""}
                      </span>
                    ) : null}
                    <span className="rd-latency">
                      {duration(selectedNode.totalLatencyMs)}
                    </span>
                  </p>

                  <h3 className="rd-detail-h">Attempts</h3>
                  <ol className="rd-attempts">
                    {selectedAttempts.map((a, i) => (
                      <li key={`${a.seq}-${i}`} className="rd-attempt">
                        <span className="rd-attempt-n">#{i + 1}</span>
                        <span className="rd-attempt-time">{clock(a.at)}</span>
                        <span
                          className={`run-status run-status--${statusKind(
                            a.status,
                          )}`}
                        >
                          {statusLabel(a.status)}
                        </span>
                        <span className="rd-latency">
                          {duration(a.latencyMs)}
                        </span>
                      </li>
                    ))}
                  </ol>

                  {selectedAttempts.some((a) => a.output?.result) ? (
                    <>
                      <h3 className="rd-detail-h">What it did</h3>
                      {selectedAttempts
                        .filter((a) => a.output?.result)
                        .map((a, i) => (
                          <p key={i} className="rd-detail-result">
                            {String(a.output?.result)}
                          </p>
                        ))}
                    </>
                  ) : null}

                  {(() => {
                    const events = selectedAttempts.flatMap((a) => {
                      const e = (a.output as { emitted?: unknown } | null)
                        ?.emitted;
                      return Array.isArray(e) ? e.map(String) : [];
                    });
                    if (events.length === 0) return null;
                    return (
                      <>
                        <h3 className="rd-detail-h">Events announced</h3>
                        <ul className="rd-event-list">
                          {events.map((e, i) => (
                            <li key={i}>
                              <code>{e}</code>
                            </li>
                          ))}
                        </ul>
                      </>
                    );
                  })()}

                  <details className="rd-raw-output">
                    <summary>Recorded output</summary>
                    <pre>
                      {JSON.stringify(
                        selectedAttempts.map((a) => a.output),
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </>
              ) : (
                <p className="wf-empty">Select a node to see its detail.</p>
              )}
            </aside>
          </div>

          {/* ── tabs ───────────────────────────────────────────────────── */}
          <div className="rd-tabs" role="tablist">
            {(
              [
                ["timeline", `Timeline (${data.steps.length})`],
                ["logs", "Logs"],
                ["outcome", `Outcome (${emitted.length})`],
              ] as Array<[TabKey, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "rd-tab rd-tab--on" : "rd-tab"}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "timeline" ? (
            <div className="wf-table-wrap">
              <table className="wf-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Node</th>
                    <th scope="col">Tool</th>
                    <th scope="col">Status</th>
                    <th scope="col">Took</th>
                    <th scope="col">At</th>
                  </tr>
                </thead>
                <tbody>
                  {data.steps.map((s, i) => (
                    <tr
                      key={`${s.seq}-${i}`}
                      className="wf-row wf-row--clickable"
                      onClick={() => setSelected(s.node)}
                    >
                      <td className="run-num">{s.seq}</td>
                      <td>
                        <span className="run-id">{s.node}</span>
                      </td>
                      <td>
                        <span className="wf-trigger">{s.tool ?? "—"}</span>
                      </td>
                      <td>
                        <span
                          className={`run-status run-status--${statusKind(
                            s.status,
                          )}`}
                        >
                          {statusLabel(s.status)}
                        </span>
                      </td>
                      <td className="run-num">{duration(s.latencyMs)}</td>
                      <td className="wf-muted">{clock(s.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "logs" ? (
            <pre className="rd-logs" data-testid="run-logs">
              {[
                `${clock(run?.startedAt ?? null)} [orch_runs] STARTED ${
                  run?.graphKey
                }${run?.pinnedVersion != null ? `@${run.pinnedVersion}` : ""}`,
                ...data.steps.map((s) => {
                  const res = (s.output as { result?: unknown } | null)?.result;
                  const ec = (s.output as { errorClass?: unknown } | null)
                    ?.errorClass;
                  return (
                    `${clock(s.at)} [node:${s.node}] ${s.status} ${duration(
                      s.latencyMs,
                    )}` +
                    (ec ? ` — ${String(ec)}` : "") +
                    (res ? ` — ${String(res)}` : "")
                  );
                }),
                run?.completedAt
                  ? `${clock(run.completedAt)} [orch_runs] ${run.status}`
                  : `… still running`,
              ].join("\n")}
            </pre>
          ) : null}

          {tab === "outcome" ? (
            emitted.length === 0 ? (
              <p className="wf-empty">This run announced no events.</p>
            ) : (
              <div className="wf-table-wrap">
                <table className="wf-table">
                  <thead>
                    <tr>
                      <th scope="col">Event</th>
                      <th scope="col">Announced by</th>
                      <th scope="col">At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emitted.map((e, i) => (
                      <tr key={i} className="wf-row">
                        <td>
                          <span className="wf-trigger">{e.event}</span>
                        </td>
                        <td>
                          <span className="run-id">{e.node}</span>
                        </td>
                        <td className="wf-muted">{clock(e.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </>
      ) : null}
    </div>
  );
}
