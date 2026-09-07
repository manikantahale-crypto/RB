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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useNodesState,
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
  ROUTERS,
  addArm,
  addBranch,
  forkAt,
  insertOnEdge,
  readBands,
  removeArm,
  removeStep,
  renameArm,
  setArmTarget,
  setArmThreshold,
  whyNoBranch,
  whyNotArmName,
  type EdgeRef,
  type RouterSpec,
} from "../lib/graph-edit";
import {
  listRegistryNodes,
  loadChain,
  loadVersion,
  saveDraft,
  type GraphDefinition,
  type JsonSchema,
  type ChainNeighbours,
  type LoadedVersion,
  type RegistryNode,
} from "../api/editor";

const NODE_W = 230;
const NODE_H = 78;

/**
 * `syntra.match.workflow` → `syntra`. Decides which nodes may be inserted.
 *
 * The known modules are read off the registry the API just returned rather
 * than written out here. A hardcoded list is how this file came to know about
 * `orbit` while the node contract did not, and neither of them knew about
 * `relay` or `interview` — both of which run in production.
 */
function moduleOf(graphKey: string, known: Iterable<string>): string {
  const head = graphKey.split(".")[0] ?? "";
  const modules = new Set(known);
  return head !== "platform" && modules.has(head) ? head : "platform";
}

/* ─────────────────────────── canvas node ─────────────────────────────── */

type CanvasNodeData = {
  label: string;
  impl: string;
  kind: "trigger" | "end" | "node" | "decision";
  sideEffect: string | null;
  known: boolean;
  selected: boolean;
  /**
   * The outcomes this step branches on, if any. A decision is drawn as a step
   * that fans out rather than a step you pass through, because that is what it
   * is — the fork lives on the edges leaving it, not in the box.
   */
  outcomes?: string[];
  /** Trigger chosen but not bound yet — the binding is made at go-live. */
  pending?: boolean;
};

function CanvasNode({ data }: { data: CanvasNodeData }) {
  if (data.kind === "trigger") {
    return (
      <div
        className="ge-trigger"
        title={
          data.pending
            ? `${data.impl} — chosen, but the binding is created at go-live`
            : "The event that starts this workflow"
        }
      >
        <span className="ge-trigger-bolt" aria-hidden="true">
          ⚡
        </span>
        <span className="ge-trigger-name">{data.label}</span>
        {data.pending ? (
          <span className="ge-flag" title="No binding exists yet — nothing reaches this workflow until go-live.">
            not bound yet
          </span>
        ) : null}
        <Handle type="source" position={Position.Bottom} className="ge-handle" />
      </div>
    );
  }
  // The end of the workflow. It needs a TARGET handle and no source one —
  // React Flow drops any edge pointing at a node that cannot receive it, and a
  // dropped final edge takes the `+` after the last step with it, leaving a
  // canvas where steps can only be inserted before something, never appended.
  if (data.kind === "end") {
    return (
      <div className="ge-end" title="Where this workflow finishes">
        <Handle type="target" position={Position.Top} className="ge-handle" />
        <span className="ge-end-name">{data.label}</span>
      </div>
    );
  }
  /**
   * A decision is drawn as the point the flow splits, not as a box with a
   * caption saying it splits. The outcomes sit along the bottom edge, in the
   * order their arms leave, so the box and the lines below it say the same
   * thing — which is what "branches 3 ways" written inside a rectangle never
   * did.
   */
  return (
    <div
      className={`ge-node${data.selected ? " ge-node--on" : ""}${
        data.known ? "" : " ge-node--unknown"
      }${data.outcomes?.length ? " ge-node--fork" : ""}`}
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
      {data.outcomes?.length ? (
        <span className="ge-outcomes">
          {data.outcomes.map((o) => (
            <span className="ge-outcome" key={o}>
              {o}
            </span>
          ))}
        </span>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="ge-handle" />
    </div>
  );
}

const nodeTypes = { canvasNode: CanvasNode };
const edgeTypes = { insertable: InsertableEdge };

function layout(nodes: Node[], edges: Edge[]): Node[] {
  /**
   * `multigraph` is not optional here. Two outcomes of one branch often lead
   * to the same place — both ending the workflow is the usual case — and a
   * plain graph collapses those into a single edge, so dagre lays out a fork
   * it cannot see and the arms come back drawn on top of each other.
   */
  const g = new dagre.graphlib.Graph({ multigraph: true }).setDefaultEdgeLabel(
    () => ({}),
  );
  const branching = edges.some((e) => e.label);
  g.setGraph({
    rankdir: "TB",
    nodesep: branching ? 64 : 40,
    // Room for an outcome label to sit above the step it leads into.
    ranksep: branching ? 78 : 52,
  });
  nodes.forEach((n) => {
    /**
     * A fork is taller than a step, because its outcomes are drawn along the
     * bottom of it. Telling dagre the same height it uses for everything else
     * makes it reserve too little room and the arms leave through the step
     * below — the overlap this layout exists to avoid.
     */
    const outcomes = (n.data as { outcomes?: string[] } | undefined)?.outcomes;
    g.setNode(n.id, {
      width: NODE_W,
      height: outcomes?.length ? NODE_H + 26 : NODE_H,
    });
  });
  edges.forEach((e) =>
    g.setEdge(
      e.source,
      e.target,
      e.label ? { width: 96, height: 24, labelpos: "c" } : {},
      e.id,
    ),
  );
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
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
  /**
   * The workflows either side of this one.
   *
   * A flow that crosses applications is stored as a chain — a workflow per
   * application, joined by published events — and this canvas edits one link.
   * Without saying so, somebody who authored one flow opens it and finds half
   * their work apparently gone.
   */
  const [chain, setChain] = useState<ChainNeighbours | null>(null);
  const [draft, setDraft] = useState<GraphDefinition | null>(null);
  const [registry, setRegistry] = useState<RegistryNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  /**
   * Which edge the picker is inserting on, in definition space.
   *
   * Not the canvas edge id. The id is a display string, and recovering an arm
   * from it meant splitting on `->` and then on `:` — which any node id
   * containing either character defeats. The loops below already hold both
   * ends, so they hand over the reference itself.
   */
  const [insertAt, setInsertAt] = useState<EdgeRef | null>(null);

  const load = useCallback(async () => {
    if (!graphKey || !version) return;
    setError(null);
    // Best effort: a workflow with no neighbours is the ordinary case, and a
    // failure here must not stop the editor loading.
    void loadChain(graphKey).then((r) => setChain(r.ok ? r.data : null));
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
        pending: loaded?.triggerSource === "draft",
      } satisfies CanvasNodeData,
    });

    /**
     * The workflow's end. Drawn so the final edge exists — without it there is
     * no `+` after the last step, and a step can only ever be inserted BEFORE
     * something, never appended.
     *
     * ONE PER ARM THAT ENDS, not one shared marker. A branch usually sends two
     * of its outcomes straight to the end, and pointing both at the same chip
     * draws two edges along one line with their labels on top of each other —
     * which is the whole picture of the branch, illegible. The definition still
     * says `__end__` for all of them; only the drawing separates them.
     */
    const endId = "__end_marker__";
    ns.push({
      id: endId,
      type: "canvasNode",
      position: { x: 0, y: 0 },
      data: {
        label: "done",
        impl: "end of workflow",
        kind: "end",
        sideEffect: null,
        known: true,
        selected: false,
      } satisfies CanvasNodeData,
    });

    const outcomesOf = new Map<string, string[]>();
    for (const ce of draft.conditionalEdges ?? []) {
      outcomesOf.set(ce.from, [
        ...(outcomesOf.get(ce.from) ?? []),
        ...Object.keys(ce.map),
      ]);
    }

    for (const n of draft.nodes) {
      const c = contractFor(n.impl);
      ns.push({
        id: n.id,
        type: "canvasNode",
        position: { x: 0, y: 0 },
        data: {
          label: n.id,
          impl: n.impl,
          kind: outcomesOf.get(n.id) ? "decision" : "node",
          sideEffect: c?.sideEffect ?? null,
          known: Boolean(c),
          selected: n.id === selected,
          outcomes: outcomesOf.get(n.id),
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
      const ref: EdgeRef = { kind: "plain", from, to };
      es.push({
        id: `${source}->${target}`,
        source,
        target,
        type: "insertable",
        data: { onInsert: () => setInsertAt(ref) },
      });
    }
    for (const ce of draft.conditionalEdges ?? []) {
      for (const [label, to] of Object.entries(ce.map)) {
        if (!ns.some((n) => n.id === ce.from)) continue;
        let target = to;
        if (to === "__end__") {
          // Its own ending, named for the arm that reaches it.
          target = `__end__:${ce.from}:${label}`;
          ns.push({
            id: target,
            type: "canvasNode",
            position: { x: 0, y: 0 },
            data: {
              label: "done",
              impl: "end of workflow",
              kind: "end",
              sideEffect: null,
              known: true,
              selected: false,
            } satisfies CanvasNodeData,
          });
        }
        if (!ns.some((n) => n.id === target)) continue;
        const ref: EdgeRef = { kind: "conditional", from: ce.from, label, to };
        es.push({
          id: `${ce.from}->${target}:${label}`,
          source: ce.from,
          target,
          label,
          type: "insertable",
          data: { onInsert: () => setInsertAt(ref) },
        });
      }
    }
    return { nodes: layout(ns, es), edges: es };
  }, [draft, loaded, selected, contractFor]);

  /**
   * DRAGGING, WITHOUT LAYOUT BECOMING STATE.
   *
   * Positions are computed by dagre from the topology, so the picture can never
   * disagree with the graph. Dragging has to coexist with that: React Flow owns
   * the node list while you drag, and dagre recomputes it whenever the topology
   * changes underneath.
   *
   * Where you moved something is remembered HERE, in a ref keyed by node id,
   * and reapplied over each fresh layout — so selecting a step or inserting one
   * elsewhere does not throw your arrangement away. It is deliberately not part
   * of the draft: it is never saved, never checksummed, and never travels to
   * another person. "Tidy up" drops it and the computed layout returns.
   */
  const movedRef = useRef<Record<string, { x: number; y: number }>>({});
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);

  useEffect(() => {
    setRfNodes(
      nodes.map((n) => {
        const moved = movedRef.current[n.id];
        return moved ? { ...n, position: moved } : n;
      }),
    );
  }, [nodes, setRfNodes]);

  // A ref alone cannot drive the "Tidy up" affordance — nothing re-renders when
  // it changes, so the button would never appear. The positions stay in the ref
  // (they must not cause a re-render mid-drag); this only tracks whether any
  // exist.
  const [arranged, setArranged] = useState(false);

  const tidyUp = useCallback(() => {
    movedRef.current = {};
    setArranged(false);
    setRfNodes(nodes);
  }, [nodes, setRfNodes]);

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

  /**
   * What a step inserted here would actually receive.
   *
   * THIS USED TO BE A PROMISE THE RUNTIME DID NOT KEEP. It collected the
   * declared OUTPUTS of every step upstream and told you a candidate "takes
   * jobId from an earlier step" — but a step's input is built from the trigger
   * payload, so an earlier step's output reached it only by coincidence of
   * naming, and usually not at all. The picker was describing the system we
   * wanted.
   *
   * What is true: a step receives the trigger payload, plus anything its own
   * input map pulls in. So availability at this point is the trigger's fields
   * plus everything upstream steps have MAPPED — mapping being the thing that
   * makes an earlier step's output reachable at all.
   *
   * Upstream outputs still count, but only as what COULD be mapped: they are
   * offered further down as sources, not counted as arriving on their own.
   */
  const upstreamOutputs = useMemo(() => {
    if (!draft || !insertAt) return [] as string[];
    // Always there: every step is handed the trigger payload.
    const out = new Set<string>(loaded?.triggerFields ?? []);

    const seen = new Set<string>();
    const walk = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const node = draft.nodes.find((n) => n.id === id);
      // What an upstream step MAPPED is available downstream, because mapping
      // merges it into the payload every later step reads.
      for (const field of Object.keys(node?.inputs ?? {})) out.add(field);
      for (const [a, b] of draft.edges) if (b === id) walk(a);
      // A step reached only through a branch arm has upstream too — without
      // this the picker reports nothing usable anywhere after a decision.
      for (const ce of draft.conditionalEdges ?? []) {
        if (Object.values(ce.map).includes(id)) walk(ce.from);
      }
    };
    walk(insertAt.from);
    return [...out];
  }, [draft, insertAt, loaded]);

  /** Insert a step on an edge — see `lib/graph-edit.ts` for both cases. */
  const insertNode = (chosen: RegistryNode) => {
    if (!draft || !insertAt) return;
    const { def, newNodeId } = insertOnEdge(draft, insertAt, chosen.key);
    setDraft(def);
    setSelected(newNodeId);
    setInsertAt(null);
  };

  /** Fork on an edge — see `lib/graph-edit.ts` for what each router means. */
  const addBranchHere = (router: RouterSpec) => {
    if (!draft || !insertAt) return;
    const { def, newNodeId } = addBranch(draft, insertAt, router);
    setDraft(def);
    if (newNodeId) setSelected(newNodeId);
    else setSelected(insertAt.from);
    setInsertAt(null);
  };

  /** Remove a step and heal the chain around it, through both edge lists. */
  const removeNode = (id: string) => {
    if (!draft) return;
    setDraft(removeStep(draft, id));
    setSelected(null);
  };

  /** What may be inserted: this module's own nodes, plus anything shared. */
  const insertable = useMemo(() => {
    const mod = moduleOf(graphKey, registry.map((n) => n.module));
    return registry.filter((n) => n.module === mod || n.shareable);
  }, [registry, graphKey]);

  const findings = useMemo(
    () =>
      draft
        ? validate(
            draft,
            registry,
            // Only when the API told us; an older response leaves the rail
            // saying it could not check rather than inventing an answer.
            loaded?.triggerDeclared === undefined
              ? undefined
              : {
                  fields: loaded.triggerFields ?? [],
                  declared: loaded.triggerDeclared,
                },
          )
        : [],
    [draft, registry, loaded],
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

  /** The fork on the selected step, if it has one. */
  const selectedFork = draft && selected ? forkAt(draft, selected) : null;

  /** Everywhere an outcome may be sent: any other step, or the end. */
  const armTargets = useMemo(() => {
    if (!draft || !selected) return [] as string[];
    return [...draft.nodes.filter((n) => n.id !== selected).map((n) => n.id), "__end__"];
  }, [draft, selected]);

  const moveArm = (label: string, target: string) => {
    if (!draft || !selected) return;
    setDraft(setArmTarget(draft, selected, label, target));
  };

  /**
   * Whether this fork's paths are the graph's to name.
   *
   * Only the score decision can be told what to return. The `result.*` routers
   * read the previous step's output text and can produce exactly two fixed
   * strings each, so renaming one of those arms would give a path nothing ever
   * takes — and nothing would report it.
   */
  const forkRouter = selectedFork
    ? (ROUTERS.find((r) => r.key === selectedFork.router) ?? null)
    : null;
  const canNamePaths = Boolean(forkRouter?.customOutcomes);

  /** The score bands behind the paths, when the decision has them. */
  const bands = readBands(selectedNode ?? undefined);
  const bandOf = (name: string) => bands?.find((b) => b.name === name) ?? null;

  /** A path being renamed, and the text typed so far. */
  const [renaming, setRenaming] = useState<{ from: string; text: string } | null>(
    null,
  );
  const [newArm, setNewArm] = useState("");

  const commitRename = () => {
    if (!draft || !selected || !renaming || !selectedFork) return;
    const next = renaming.text.trim();
    if (next === renaming.from || whyNotArmName(selectedFork, next, renaming.from)) {
      setRenaming(null);
      return;
    }
    setDraft(renameArm(draft, selected, renaming.from, next));
    setRenaming(null);
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
          {/*
            Screen 5. A link rather than a button, and deliberately not the
            primary one: firing runs the workflow for real, and a control level
            with "Save draft" would invite being pressed with the same
            expectations. The warning lives on that screen, where there is room
            to say it properly.

            Enabled for a draft too. A draft has no binding, so firing its
            trigger runs whatever IS bound to that event — which may be a
            different workflow. That is worth seeing rather than being
            prevented from finding out; screen 5 says so before the button.
          */}
          <Link
            className="wf-btn"
            to={`/workflows/${encodeURIComponent(graphKey)}/test`}
            title={`Fire a real ${graphKey} event`}
          >
            Test…
          </Link>
          <button
            type="button"
            className="wf-btn"
            disabled
            title="Screen 6 is not built — it needs a decision on how the platform talks to GitHub."
          >
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
            {/* ── where this workflow sits ──────────────────────────────
                Only when it has neighbours. Read-only on purpose: each link
                is a separate workflow with its own version and its own
                go-live, and letting one canvas edit several would put two
                applications' release cycles behind one Save button. */}
            {chain && (chain.upstream.length > 0 || chain.downstream.length > 0) ? (
              <div className="ge-chain" aria-label="Chain">
                {chain.upstream.map((u) => (
                  <span className="ge-chain-link" key={`u-${u.graphKey}`}>
                    <Link to={`/workflows/${encodeURIComponent(u.graphKey)}/runs`}>
                      {u.graphKey}
                    </Link>
                    <span className="ge-chain-via">⚡ {u.via}</span>
                    <span className="ge-chain-arrow" aria-hidden="true">→</span>
                  </span>
                ))}
                <span className="ge-chain-here">{graphKey}</span>
                {chain.downstream.map((d) => (
                  <span className="ge-chain-link" key={`d-${d.graphKey}`}>
                    <span className="ge-chain-arrow" aria-hidden="true">→</span>
                    <span className="ge-chain-via">⚡ {d.via}</span>
                    <Link to={`/workflows/${encodeURIComponent(d.graphKey)}/runs`}>
                      {d.graphKey}
                    </Link>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="ge-canvas-head">
              <span className="ge-canvas-title">
                {draft.nodes.length} step{draft.nodes.length === 1 ? "" : "s"}
              </span>
              <span className="ge-canvas-note">
                drag to arrange · click a step to edit it
              </span>
              {arranged ? (
                <button
                  type="button"
                  className="wf-btn ge-tidy"
                  onClick={tidyUp}
                  title="Drop your arrangement and return to the computed layout. Arrangement is never saved."
                >
                  Tidy up
                </button>
              ) : null}
            </div>
            <div className="ge-canvas-body">
              <ReactFlow
                nodes={rfNodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                fitView
                fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                nodesDraggable
                onNodeDragStop={(_, n) => {
                  movedRef.current[n.id] = n.position;
                  setArranged(true);
                }}
                /* Edges are drawn from the topology. Dragging a wire between
                   two boxes would imply you can rewire by hand, and you
                   cannot — structure changes by inserting on an edge. */
                nodesConnectable={false}
                /* Off, or React Flow stamps z-index:1000 inline on the selected
                   node — which beats any stylesheet and lets a step you dragged
                   over an edge bury the `+` that edits structure. */
                elevateNodesOnSelect={false}
                minZoom={0.2}
                maxZoom={2}
                zoomOnScroll
                zoomOnPinch
                panOnDrag
                proOptions={{ hideAttribution: true }}
                onNodeClick={(_, n) => {
                  // Everything the canvas draws but the definition does not
                  // contain — the trigger chip, and one "done" chip per path
                  // that ends — is named with a `__` prefix and selects
                  // nothing. Naming the rule beats listing the ids, which is
                  // how the per-arm endings became clickable in the first
                  // place.
                  if (!n.id.startsWith("__")) setSelected(n.id);
                }}
              >
                <Background
                  gap={18}
                  size={0.5}
                  color={token("--slate-230", "#e8edf2")}
                />
                <Controls
                  className="ge-controls"
                  showInteractive={false}
                  aria-label="Zoom and fit"
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
                      {selectedContract.source === "declared" ? (
                        <span
                          className="ge-flag"
                          title="The settings below are declared, but the engine runs its own implementation of this step — nothing checks one against the other."
                        >
                          declared, not enforced
                        </span>
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

                    {/*
                      WHERE EACH PATH GOES.

                      A fork is edges, so this is the only place the arms can be
                      edited as a set — the canvas can show them but a labelled
                      line is not somewhere you retarget. Deliberately no way to
                      add or rename an outcome: the runtime's router returns
                      exactly these names, and an arm called anything else is
                      never taken, with no error to notice.
                    */}
                    {selectedFork ? (
                      <>
                        <h3 className="rd-detail-h">Paths out of this step</h3>
                        <p className="ge-muted">
                          {canNamePaths
                            ? "Name each path, say what score reaches it, and where it goes."
                            : `Decided by ${selectedFork.router}, which returns these paths and no others — they cannot be renamed.`}
                        </p>
                        <div className="ge-arms">
                          {Object.entries(selectedFork.map).map(
                            ([label, target]) => {
                              const band = bandOf(label);
                              const last =
                                Object.keys(selectedFork.map).length === 1;
                              return (
                                <div className="ge-arm" key={label}>
                                  <div className="ge-arm-head">
                                    {renaming?.from === label ? (
                                      <input
                                        className="ge-input ge-arm-name"
                                        autoFocus
                                        value={renaming.text}
                                        onChange={(e) =>
                                          setRenaming({
                                            from: label,
                                            text: e.target.value,
                                          })
                                        }
                                        onBlur={commitRename}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") commitRename();
                                          if (e.key === "Escape")
                                            setRenaming(null);
                                        }}
                                        aria-label={`Rename the ${label} path`}
                                      />
                                    ) : (
                                      <button
                                        type="button"
                                        className="ge-arm-name-btn"
                                        disabled={!canNamePaths}
                                        title={
                                          canNamePaths
                                            ? "Rename this path"
                                            : "This router returns fixed names"
                                        }
                                        onClick={() =>
                                          setRenaming({
                                            from: label,
                                            text: label,
                                          })
                                        }
                                      >
                                        {label}
                                      </button>
                                    )}
                                    {canNamePaths ? (
                                      <button
                                        type="button"
                                        className="ge-arm-drop"
                                        /*
                                          A fork with one path is not a fork,
                                          and deleting the last one would leave
                                          a decision that decides nothing.
                                        */
                                        disabled={last}
                                        title={
                                          last
                                            ? "A branch needs at least one path — remove the whole branch instead."
                                            : `Remove the ${label} path`
                                        }
                                        onClick={() =>
                                          draft &&
                                          selected &&
                                          setDraft(
                                            removeArm(draft, selected, label),
                                          )
                                        }
                                      >
                                        remove
                                      </button>
                                    ) : null}
                                  </div>
                                  {band && canNamePaths ? (
                                    <label className="ge-arm-row">
                                      <span className="ge-field-name">
                                        at or above
                                      </span>
                                      <input
                                        className="ge-input"
                                        type="number"
                                        step="0.05"
                                        value={band.min}
                                        onChange={(e) =>
                                          draft &&
                                          selected &&
                                          setDraft(
                                            setArmThreshold(
                                              draft,
                                              selected,
                                              label,
                                              Number(e.target.value),
                                            ),
                                          )
                                        }
                                      />
                                    </label>
                                  ) : null}
                                  <label className="ge-arm-row">
                                    <span className="ge-field-name">goes to</span>
                                    <select
                                      className="ge-input"
                                      value={target}
                                      onChange={(e) =>
                                        moveArm(label, e.target.value)
                                      }
                                    >
                                      {armTargets.map((t) => (
                                        <option key={t} value={t}>
                                          {t === "__end__"
                                            ? "end the workflow"
                                            : t}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                </div>
                              );
                            },
                          )}

                          {canNamePaths ? (
                            <div className="ge-arm ge-arm--new">
                              <div className="ge-arm-head">
                                <input
                                  className="ge-input ge-arm-name"
                                  placeholder="another path…"
                                  value={newArm}
                                  onChange={(e) => setNewArm(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key !== "Enter") return;
                                    if (
                                      !draft ||
                                      !selected ||
                                      whyNotArmName(selectedFork, newArm)
                                    )
                                      return;
                                    setDraft(
                                      addArm(draft, selected, newArm.trim()),
                                    );
                                    setNewArm("");
                                  }}
                                  aria-label="Name for a new path"
                                />
                                <button
                                  type="button"
                                  className="wf-btn"
                                  disabled={Boolean(
                                    whyNotArmName(selectedFork, newArm),
                                  )}
                                  onClick={() => {
                                    if (!draft || !selected) return;
                                    setDraft(
                                      addArm(draft, selected, newArm.trim()),
                                    );
                                    setNewArm("");
                                  }}
                                >
                                  Add path
                                </button>
                              </div>
                              {newArm.trim().length > 0 &&
                              whyNotArmName(selectedFork, newArm) ? (
                                <span className="ge-field-why">
                                  {whyNotArmName(selectedFork, newArm)}
                                </span>
                              ) : (
                                <span className="ge-field-why">
                                  It starts below every other path and ends the
                                  workflow — move its score and its destination
                                  after adding it.
                                </span>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </>
                    ) : null}

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
          module={moduleOf(graphKey, registry.map((n) => n.module))}
          onPick={insertNode}
          onBranch={addBranchHere}
          branchBlocked={(r) => whyNoBranch(draft, insertAt, r)}
          onClose={() => setInsertAt(null)}
        />
      ) : null}
    </div>
  );
}
