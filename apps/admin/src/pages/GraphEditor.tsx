/**
 * Screen 4 — the graph editor.
 *
 * Auto-layout, always. The drawing is computed from the topology every render;
 * nobody drags anything and no layout is ever stored. A stored layout goes
 * stale the moment someone edits the graph somewhere else, and then the picture
 * lies about the workflow.
 *
 * The right panel is a projection of the node contract, not a hand-written form
 * per node. Config fields, their ranges, which ones an admin may tune, the
 * retry policy, whether the node may be re-run — all of it is read from
 * `node_registry`, which is materialized from the contracts in git. Add a field
 * to a contract and it appears here; nothing in this file changes.
 *
 * What is deliberately absent: any way to edit an active version. Editing
 * means a draft, and the save endpoint refuses anything else — runs are pinned
 * to a version and read their topology back from that row.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
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
import { token } from "../lib/tokens.js";
import { NodeTestPanel } from "./node-test-panel";
import {
  InsertableEdge,
  NodePicker,
  ValidationRail,
  rankCandidates,
  validate,
} from "./editor-parts";
import {
  listRegistryNodes,
  loadVersion,
  saveDraft,
  type GraphDefinition,
  type JsonSchema,
  type LoadedVersion,
  type RegistryNode,
} from "../api/editor";

const NODE_W = 230;
const NODE_H = 78;

/** `syntra.match.workflow` → `syntra`. Decides which nodes may be inserted. */
function moduleOf(graphKey: string): string {
  const head = graphKey.split(".")[0] ?? "";
  return ["syntra", "astra", "orbit"].includes(head) ? head : "platform";
}

/* ─────────────────────────── canvas node ─────────────────────────────── */

type CanvasNodeData = {
  label: string;
  impl: string;
  kind: "trigger" | "node";
  sideEffect: string | null;
  known: boolean;
  selected: boolean;
};

function CanvasNode({ data }: { data: CanvasNodeData }) {
  if (data.kind === "trigger") {
    return (
      <div className="ge-trigger" title="The event that starts this workflow">
        <span className="ge-trigger-bolt" aria-hidden="true">
          ⚡
        </span>
        <span className="ge-trigger-name">{data.label}</span>
        <Handle type="source" position={Position.Bottom} className="ge-handle" />
      </div>
    );
  }
  return (
    <div
      className={`ge-node${data.selected ? " ge-node--on" : ""}${
        data.known ? "" : " ge-node--unknown"
      }`}
      title={
        data.known
          ? `${data.impl}${data.sideEffect ? ` · ${data.sideEffect}` : ""}`
          : `${data.impl} — not in the node registry`
      }
    >
      <Handle type="target" position={Position.Top} className="ge-handle" />
      <span className="ge-node-id">{data.label}</span>
      <span className="ge-node-impl">{data.impl}</span>
      {data.sideEffect ? (
        <span className={`ge-effect ge-effect--${data.sideEffect}`}>
          {data.sideEffect.replace("_", " ")}
        </span>
      ) : null}
      {!data.known ? <span className="ge-unknown-flag">unknown node</span> : null}
      <Handle type="source" position={Position.Bottom} className="ge-handle" />
    </div>
  );
}

const nodeTypes = { canvasNode: CanvasNode };
const edgeTypes = { insertable: InsertableEdge };

function layout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 52 });
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

/* ──────────────────── config form, from JSON Schema ──────────────────── */

function FormField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string;
  schema: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = schema.label ?? name;
  const admin = schema.adminExposed === true;

  const control = () => {
    if (schema.enum?.length) {
      return (
        <select
          className="ge-input"
          value={value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">— not set —</option>
          {schema.enum.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
      );
    }
    if (schema.type === "boolean") {
      return (
        <label className="ge-check">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{value === true ? "on" : "off"}</span>
        </label>
      );
    }
    if (schema.type === "number" || schema.type === "integer") {
      return (
        <input
          className="ge-input"
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          min={schema.minimum}
          max={schema.maximum}
          step={schema.type === "integer" ? 1 : 0.01}
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      );
    }
    if (schema.type === "array") {
      const list = Array.isArray(value) ? (value as unknown[]) : [];
      return (
        <input
          className="ge-input"
          type="text"
          placeholder="comma separated"
          value={list.join(", ")}
          onChange={(e) => {
            const parts = e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            onChange(parts.length ? parts : undefined);
          }}
        />
      );
    }
    return (
      <input
        className="ge-input"
        type="text"
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    );
  };

  return (
    <div className="ge-field">
      <div className="ge-field-head">
        <label className="ge-field-label">
          {label}
          {schema.type === "number" &&
          schema.minimum !== undefined &&
          schema.maximum !== undefined ? (
            <span className="ge-range">
              {" "}
              ({schema.minimum}–{schema.maximum})
            </span>
          ) : null}
        </label>
        {admin ? (
          <span
            className="ge-admin-flag"
            title="An admin may tune this per organisation without a code change."
          >
            admin
          </span>
        ) : null}
      </div>
      {control()}
    </div>
  );
}

/* ─────────────────────────── the screen ──────────────────────────────── */

export function GraphEditorPage() {
  const { graphKey = "" } = useParams();
  const [searchParams] = useSearchParams();
  const version = Number(searchParams.get("version") ?? "0");

  const [loaded, setLoaded] = useState<LoadedVersion | null>(null);
  const [draft, setDraft] = useState<GraphDefinition | null>(null);
  const [registry, setRegistry] = useState<RegistryNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  /** Which edge the picker is inserting on, as "source->target". */
  const [insertAt, setInsertAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!graphKey || !version) return;
    setError(null);
    /**
     * The FULL registry, not the module-scoped one.
     *
     * Two different questions are being asked of it: "what may I insert here"
     * (module + shareable) and "does this step exist at all" (everything). Using
     * the narrowed list for both reported `orch.branch.decision` and
     * `human.gate` as steps the runtime cannot run — they are platform nodes,
     * excluded from an ASTRA picker — and a false error blocks saving.
     */
    const [v, r] = await Promise.all([
      loadVersion(graphKey, version),
      listRegistryNodes(),
    ]);
    if (v.ok) {
      setLoaded(v.data);
      setDraft(structuredClone(v.data.definition));
      setSelected((cur) => cur ?? v.data.definition.nodes[0]?.id ?? null);
    } else {
      setError(v.body.message ?? v.body.error ?? "Could not load this version");
    }
    if (r.ok) setRegistry(r.data.nodes);
    else if (!v.ok) return;
    else setError(r.body.message ?? "Could not load the node registry");
  }, [graphKey, version]);

  useEffect(() => {
    void load();
  }, [load]);

  /** What the node registry knows about a given impl key. */
  const contractFor = useCallback(
    (impl: string) => registry.find((n) => n.key === impl) ?? null,
    [registry],
  );

  const dirty = useMemo(() => {
    if (!loaded || !draft) return false;
    return JSON.stringify(draft) !== JSON.stringify(loaded.definition);
  }, [draft, loaded]);

  const { nodes, edges } = useMemo(() => {
    if (!draft) return { nodes: [] as Node[], edges: [] as Edge[] };
    const ns: Node[] = [];
    const es: Edge[] = [];

    const triggerId = "__trigger__";
    const triggerLabel = loaded?.triggers[0] ?? "no trigger bound";
    ns.push({
      id: triggerId,
      type: "canvasNode",
      position: { x: 0, y: 0 },
      data: {
        label: triggerLabel,
        impl: triggerLabel,
        kind: "trigger",
        sideEffect: null,
        known: true,
        selected: false,
      } satisfies CanvasNodeData,
    });

    // The workflow's end. Drawn so the final edge exists — without it there is
    // no `+` after the last step, and a step can only ever be inserted BEFORE
    // something, never appended.
    const endId = "__end_marker__";
    ns.push({
      id: endId,
      type: "canvasNode",
      position: { x: 0, y: 0 },
      data: {
        label: "done",
        impl: "end of workflow",
        kind: "trigger",
        sideEffect: null,
        known: true,
        selected: false,
      } satisfies CanvasNodeData,
    });

    for (const n of draft.nodes) {
      const c = contractFor(n.impl);
      ns.push({
        id: n.id,
        type: "canvasNode",
        position: { x: 0, y: 0 },
        data: {
          label: n.id,
          impl: n.impl,
          kind: "node",
          sideEffect: c?.sideEffect ?? null,
          known: Boolean(c),
          selected: n.id === selected,
        } satisfies CanvasNodeData,
      });
    }

    // `__start__` / `__end__` are LangGraph markers, not nodes — the trigger
    // chip stands in for the start so the canvas shows what a person sees.
    for (const [from, to] of draft.edges) {
      const source = from === "__start__" ? triggerId : from;
      const target = to === "__end__" ? endId : to;
      if (!ns.some((n) => n.id === source)) continue;
      if (!ns.some((n) => n.id === target)) continue;
      es.push({
        id: `${source}->${target}`,
        source,
        target,
        type: "insertable",
        data: { onInsert: (edgeId: string) => setInsertAt(edgeId) },
      });
    }
    for (const ce of draft.conditionalEdges ?? []) {
      for (const [label, target] of Object.entries(ce.map)) {
        if (!ns.some((n) => n.id === target)) continue;
        es.push({
          id: `${ce.from}->${target}:${label}`,
          source: ce.from,
          target,
          label,
          type: "insertable",
          data: { onInsert: (edgeId: string) => setInsertAt(edgeId) },
        });
      }
    }
    return { nodes: layout(ns, es), edges: es };
  }, [draft, loaded, selected, contractFor]);

  const selectedNode = draft?.nodes.find((n) => n.id === selected) ?? null;
  const selectedContract = selectedNode ? contractFor(selectedNode.impl) : null;

  const setConfigValue = (field: string, value: unknown) => {
    if (!draft || !selectedNode) return;
    setDraft({
      ...draft,
      nodes: draft.nodes.map((n) =>
        n.id !== selectedNode.id
          ? n
          : {
              ...n,
              config: (() => {
                const next = { ...(n.config ?? {}) };
                if (value === undefined) delete next[field];
                else next[field] = value;
                return next;
              })(),
            },
      ),
    });
  };

  /** Fields produced by everything upstream of an edge — feeds the picker. */
  const upstreamOutputs = useMemo(() => {
    if (!draft || !insertAt) return [] as string[];
    const source = insertAt.split("->")[0]!;
    const out = new Set<string>();
    // Walk backwards from the insertion point, collecting declared outputs.
    const seen = new Set<string>();
    const walk = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const node = draft.nodes.find((n) => n.id === id);
      if (node) {
        const c = contractFor(node.impl);
        for (const f of Object.keys(c?.outputSchema?.properties ?? {})) out.add(f);
      }
      for (const [a, b] of draft.edges) if (b === id) walk(a);
    };
    walk(source);
    return [...out];
  }, [draft, insertAt, contractFor]);

  /**
   * Insert a step on an edge: A → B becomes A → new → B.
   * The id is derived from the node key and made unique, because a person
   * should not have to invent one.
   */
  const insertNode = (chosen: RegistryNode) => {
    if (!draft || !insertAt) return;
    const [rawSource, rawTargetWithLabel] = insertAt.split("->");
    const rawTargetMarker = (rawTargetWithLabel ?? "").split(":")[0]!;
    // The canvas draws `__start__` as a trigger chip and `__end__` as a "done"
    // marker; the definition still speaks in the markers.
    const source = rawSource === "__trigger__" ? "__start__" : rawSource!;
    const rawTarget =
      rawTargetMarker === "__end_marker__" ? "__end__" : rawTargetMarker;

    const base = chosen.key.split(".").pop() ?? "step";
    let id = base;
    let n = 2;
    while (draft.nodes.some((x) => x.id === id)) id = `${base}${n++}`;

    setDraft({
      ...draft,
      nodes: [...draft.nodes, { id, impl: chosen.key, config: {} }],
      edges: [
        ...draft.edges.filter(([a, b]) => !(a === source && b === rawTarget)),
        [source, id] as [string, string],
        [id, rawTarget] as [string, string],
      ],
    });
    setSelected(id);
    setInsertAt(null);
  };

  /** Remove a step and heal the chain around it. */
  const removeNode = (id: string) => {
    if (!draft) return;
    const incoming = draft.edges.filter(([, b]) => b === id).map(([a]) => a);
    const outgoing = draft.edges.filter(([a]) => a === id).map(([, b]) => b);
    const healed: Array<[string, string]> = [];
    for (const a of incoming) for (const b of outgoing) healed.push([a, b]);
    setDraft({
      ...draft,
      nodes: draft.nodes.filter((x) => x.id !== id),
      edges: [
        ...draft.edges.filter(([a, b]) => a !== id && b !== id),
        ...healed,
      ],
    });
    setSelected(null);
  };

  /** What may be inserted: this module's own nodes, plus anything shared. */
  const insertable = useMemo(() => {
    const mod = moduleOf(graphKey);
    return registry.filter((n) => n.module === mod || n.shareable);
  }, [registry, graphKey]);

  const findings = useMemo(
    () => (draft ? validate(draft, registry) : []),
    [draft, registry],
  );
  const blocking = findings.some((f) => f.level === "error");

  const onSave = async () => {
    if (!draft || !loaded) return;
    setSaving(true);
    setError(null);
    const res = await saveDraft(graphKey, loaded.version, draft);
    if (res.ok) {
      setLoaded({ ...loaded, definition: structuredClone(draft) });
      setSavedAt(new Date());
    } else {
      setError(res.body.message ?? res.body.error ?? "Could not save");
    }
    setSaving(false);
  };

  const configProps = selectedContract?.configSchema?.properties ?? {};
  const configFields = Object.entries(configProps);

  return (
    <div className="ge-page" data-testid="graph-editor">
      <header className="ge-header">
        <div>
          <Link to="/workflows" className="run-back">
            ← All workflows
          </Link>
          <h1 className="ge-title">
            {graphKey}
            {loaded ? (
              <>
                <span className="ge-version">v{loaded.version}</span>
                <span
                  className={`ge-status ge-status--${loaded.status}`}
                  title={
                    loaded.editable
                      ? "A draft cannot run in production — the router reads active only."
                      : "Active versions are never edited in place."
                  }
                >
                  {loaded.status}
                </span>
              </>
            ) : null}
            {dirty ? <span className="ge-dirty">unsaved changes</span> : null}
          </h1>
        </div>
        <div className="ge-actions">
          <button type="button" className="wf-btn" disabled title="Screen 5">
            Test
          </button>
          <button type="button" className="wf-btn" disabled title="Screen 6">
            Review →
          </button>
          <button
            type="button"
            className="wf-btn wf-btn--primary"
            onClick={() => void onSave()}
            disabled={!dirty || saving || !loaded?.editable || blocking}
            title={
              loaded && !loaded.editable
                ? "This version is not a draft and cannot be edited."
                : blocking
                  ? "Fix the errors in the validation panel first."
                  : undefined
            }
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
          {savedAt && !dirty ? (
            <span className="wf-updated">saved {savedAt.toLocaleTimeString()}</span>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="wf-error" role="alert">
          {error}
        </div>
      ) : null}
      {!loaded && !error ? <p className="wf-empty">Loading workflow…</p> : null}

      {loaded && draft ? (
        <div className="ge-split">
          <section className="ge-canvas" aria-label="Workflow topology">
            <div className="ge-canvas-head">
              <span className="ge-canvas-title">
                {draft.nodes.length} step{draft.nodes.length === 1 ? "" : "s"}
              </span>
              <span className="ge-canvas-note">
                layout is computed, never stored · click a step to edit it
              </span>
            </div>
            <div className="ge-canvas-body">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                nodesDraggable={false}
                nodesConnectable={false}
                zoomOnScroll={false}
                panOnScroll={false}
                preventScrolling={false}
                proOptions={{ hideAttribution: true }}
                onNodeClick={(_, n) => {
                  if (n.id !== "__trigger__" && n.id !== "__end_marker__") {
                    setSelected(n.id);
                  }
                }}
              >
                <Background
                  gap={18}
                  size={0.5}
                  color={token("--slate-230", "#e8edf2")}
                />
              </ReactFlow>
            </div>
          </section>

          <aside className="ge-panel" aria-label="Step detail">
            {selectedNode ? (
              <>
                <h2 className="ge-panel-title">{selectedNode.id}</h2>
                <p className="ge-panel-impl">
                  {selectedNode.impl}
                  {selectedContract ? (
                    <span className="ge-panel-version">
                      @{selectedContract.registryKey.split("@")[1]}
                    </span>
                  ) : null}
                </p>

                {!selectedContract ? (
                  <div className="wf-warning" role="status">
                    This step is not in the node registry. It may have been
                    renamed, or it belongs to a module whose nodes have not been
                    declared yet — so its settings cannot be checked here.
                  </div>
                ) : null}

                {selectedContract ? (
                  <>
                    <div className="ge-badges">
                      {selectedContract.sideEffect ? (
                        <span
                          className={`ge-effect ge-effect--${selectedContract.sideEffect}`}
                        >
                          {selectedContract.sideEffect.replace("_", " ")}
                        </span>
                      ) : null}
                      {selectedContract.source === "legacy" ? (
                        <span className="ge-flag">no contract</span>
                      ) : null}
                      {selectedContract.requiresAllowlist ? (
                        <span
                          className="ge-flag ge-flag--warn"
                          title="Something leaves the building. Needs written justification per workflow, and cannot be tested here."
                        >
                          needs allowlist
                        </span>
                      ) : null}
                    </div>

                    <h3 className="rd-detail-h">Settings</h3>
                    {configFields.length === 0 ? (
                      <p className="ge-muted">
                        {selectedContract.source === "legacy"
                          ? "No contract, so no settings can be shown."
                          : "This step has no settings to tune."}
                      </p>
                    ) : (
                      <div className="ge-form">
                        {configFields.map(([name, schema]) => (
                          <FormField
                            key={name}
                            name={name}
                            schema={schema}
                            value={selectedNode.config?.[name]}
                            onChange={(v) => setConfigValue(name, v)}
                          />
                        ))}
                      </div>
                    )}

                    <h3 className="rd-detail-h">Contract</h3>
                    <dl className="ge-contract">
                      <div>
                        <dt>takes</dt>
                        <dd>
                          <code>
                            {Object.keys(
                              selectedContract.inputSchema?.properties ?? {},
                            ).join(", ") || "—"}
                          </code>
                        </dd>
                      </div>
                      <div>
                        <dt>returns</dt>
                        <dd>
                          <code>
                            {Object.keys(
                              selectedContract.outputSchema?.properties ?? {},
                            ).join(", ") || "—"}
                          </code>
                        </dd>
                      </div>
                      <div>
                        <dt>retry</dt>
                        <dd>
                          {selectedContract.execution
                            ? `${selectedContract.execution.retry.limit} × ${selectedContract.execution.retry.backoff}`
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>safe to re-run</dt>
                        <dd>
                          {selectedContract.idempotency
                            ? selectedContract.idempotency.strategy === "pure"
                              ? "yes — nothing happens twice"
                              : `keyed on ${
                                  selectedContract.idempotency.keyPaths?.join(", ") ??
                                  selectedContract.idempotency.keyPath
                                }`
                            : "not declared"}
                        </dd>
                      </div>
                      <div>
                        <dt>examples</dt>
                        <dd>
                          {selectedContract.fixtureNames.length
                            ? `${selectedContract.fixtureNames.length} on file`
                            : "none yet"}
                        </dd>
                      </div>
                    </dl>

                    <div className="ge-remove-slot">
                      <button
                        type="button"
                        className="wf-btn"
                        onClick={() => removeNode(selectedNode.id)}
                        disabled={!loaded.editable}
                      >
                        Remove this step
                      </button>
                    </div>

                    <NodeTestPanel
                      contract={selectedContract}
                      config={selectedNode.config ?? {}}
                      /* The saved draft, not the edited one — this is what
                         makes "settings edited — unsaved" honest. */
                      configIsSaved={
                        JSON.stringify(selectedNode.config ?? {}) ===
                        JSON.stringify(
                          loaded.definition.nodes.find(
                            (n) => n.id === selectedNode.id,
                          )?.config ?? {},
                        )
                      }
                    />
                  </>
                ) : null}
              </>
            ) : (
              <p className="wf-empty">Select a step to edit it.</p>
            )}
            <ValidationRail findings={findings} />
          </aside>
        </div>
      ) : null}

      {insertAt && draft ? (
        <NodePicker
          candidates={rankCandidates(insertable, upstreamOutputs)}
          module={moduleOf(graphKey)}
          onPick={insertNode}
          onClose={() => setInsertAt(null)}
        />
      ) : null}
    </div>
  );
}
