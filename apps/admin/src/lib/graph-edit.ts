/**
 * Structural edits to a graph definition — insert a step on an edge, remove a
 * step — as pure functions over the definition.
 *
 * They live here rather than inside the editor screen for two reasons. They are
 * the only place that understands a definition has TWO edge lists (`edges` and
 * `conditionalEdges`), and getting that wrong silently corrupts a workflow: a
 * step inserted on a branch arm used to be appended to `edges` while the arm
 * kept pointing at the original target, leaving the branch with a plain edge
 * AND its arms — in LangGraph both fire, and the inserted step is skipped on
 * the very path it was inserted into.
 *
 * The other reason is that an edit is worth testing, and a React component that
 * imports the canvas is not.
 */
import type { GraphDefinition } from "../api/editor";
import {
  ROUTER_DEFINITIONS,
  resolveSwitchOutputLabels,
} from "@tekisho/graph-contract";

/**
 * Which edge an insertion is happening on, in DEFINITION space.
 *
 * Deliberately not the canvas edge id. The canvas draws `__start__` as a
 * trigger chip and `__end__` as a "done" marker, and it used to hand those
 * display ids back as a string that had to be split on `->` and then on `:` to
 * recover the arm label. Any id containing either character broke it. Here the
 * caller resolves the ids once, at the point where it already knows both.
 */
export type EdgeRef =
  | { kind: "plain"; from: string; to: string }
  | { kind: "conditional"; from: string; label: string; to: string };

/** A step id derived from the node key, so nobody has to invent one. */
export function nextStepId(def: GraphDefinition, implKey: string): string {
  const base = implKey.split(".").pop() ?? "step";
  let id = base;
  let n = 2;
  while (def.nodes.some((x) => x.id === id)) id = `${base}${n++}`;
  return id;
}

/**
 * Insert a step on an edge: A → B becomes A → new → B.
 *
 * On a plain edge that is a swap of one edge for two. On a branch arm it is
 * NOT: the incoming side is the arm itself, so the arm is repointed at the new
 * step and only the outgoing side becomes a plain edge. The branch keeps
 * exactly its arms and gains no plain edge.
 */
export function insertOnEdge(
  def: GraphDefinition,
  ref: EdgeRef,
  implKey: string,
): { def: GraphDefinition; newNodeId: string } {
  const id = nextStepId(def, implKey);
  const nodes = [...def.nodes, { id, impl: implKey, config: {} }];

  if (ref.kind === "plain") {
    return {
      newNodeId: id,
      def: {
        ...def,
        nodes,
        edges: [
          ...def.edges.filter(([a, b]) => !(a === ref.from && b === ref.to)),
          [ref.from, id] as [string, string],
          [id, ref.to] as [string, string],
        ],
      },
    };
  }

  return {
    newNodeId: id,
    def: {
      ...def,
      nodes,
      edges: [...def.edges, [id, ref.to] as [string, string]],
      conditionalEdges: (def.conditionalEdges ?? []).map((ce) =>
        ce.from === ref.from && ce.map[ref.label] === ref.to
          ? { ...ce, map: { ...ce.map, [ref.label]: id } }
          : ce,
      ),
    },
  };
}

/**
 * Remove a step and heal the chain around it — through both edge lists.
 *
 * Three cases, and only the first used to be handled:
 *   - plain in, plain out      → cross-product, as before
 *   - the step IS the decision → its arms go with it
 *   - an arm points at it      → the arm is repointed at what the step led to,
 *                                or to `__end__`, which is always a legal
 *                                target and never strands the arm
 */
export function removeStep(def: GraphDefinition, id: string): GraphDefinition {
  const incoming = def.edges.filter(([, b]) => b === id).map(([a]) => a);
  const plainOut = def.edges.filter(([a]) => a === id).map(([, b]) => b);

  /**
   * A decision's exits are its arms, not plain edges, so healing only through
   * `edges` would leave whatever led into it pointing at nothing.
   *
   * Only the FIRST arm target is reconnected. Joining all of them would give a
   * plain node several outgoing edges, which in LangGraph means every one of
   * them runs — the same corruption this module exists to prevent. Deleting a
   * decision destroys its branching by definition; the paths that are left
   * behind show up in the validation rail as stranded steps, which is a
   * truthful thing to hand back to whoever deleted it.
   */
  const armTargets = (def.conditionalEdges ?? [])
    .filter((ce) => ce.from === id)
    .flatMap((ce) => Object.values(ce.map));
  const outgoing = plainOut.length > 0 ? plainOut : armTargets.slice(0, 1);

  const healed: Array<[string, string]> = [];
  for (const a of incoming) for (const b of outgoing) healed.push([a, b]);

  const fallback = plainOut[0] ?? "__end__";

  const conditionalEdges = (def.conditionalEdges ?? [])
    // The decision itself is going. Its arms have no source left.
    .filter((ce) => ce.from !== id)
    .map((ce) => {
      const map: Record<string, string> = {};
      for (const [label, target] of Object.entries(ce.map)) {
        map[label] = target === id ? fallback : target;
      }
      return { ...ce, map };
    })
    // A fork with nothing to fork to is not a fork.
    .filter((ce) => Object.keys(ce.map).length > 0);

  const next: GraphDefinition = {
    ...def,
    nodes: def.nodes.filter((x) => x.id !== id),
    edges: [
      ...def.edges.filter(([a, b]) => a !== id && b !== id),
      ...healed,
    ],
    conditionalEdges,
  };
  if (conditionalEdges.length === 0) delete next.conditionalEdges;
  return next;
}

/* ─────────────────────────────── branching ───────────────────────────────

   A BRANCH IS TWO THINGS, AND ONLY ONE OF THEM IS A STEP.

   The fork itself lives on the EDGES — a `conditionalEdges` entry whose `map`
   sends each outcome somewhere. What produces the outcome is either a step
   that computes it (`orch.branch.decision` writes `state.branch_key`) or the
   preceding step's own result.

   THE OUTCOME NAMES ARE NOT FREE TEXT. The runtime's router returns exactly
   these strings; an arm labelled anything else is never taken, and nothing
   reports it — the run just silently goes the other way. So a branch is added
   by choosing a router and getting its outcomes, never by typing a label.

   THE KEYS AND OUTCOMES ARE NOT DECLARED HERE. They come from
   `@tekisho/graph-contract`, which the engine reads too. This file used to
   keep its own copy of the same four routers — two hand-written lists of the
   same thing, in packages owned by different people, and the only question was
   when they would disagree. All that is added below is what only a screen
   knows: a label and the sentence explaining the choice.
   ───────────────────────────────────────────────────────────────────────── */

export type RouterSpec = {
  /** The `router` value stored in the definition. */
  key: string;
  /** What this branches on, in a person's words. */
  label: string;
  /** Every path the runtime can take. Fixed by the router. */
  outcomes: string[];
  /**
   * The step that has to compute the decision, when one is needed. Null means
   * the router reads the preceding step's own result, so no step is added.
   */
  decisionImpl: string | null;
  /**
   * Whether the graph may name its own paths.
   *
   * True only where the deciding step can be told what to produce. The
   * `result.*` routers read the previous step's output text and can return
   * exactly two fixed strings each — renaming one of those arms gives a path
   * nothing ever takes, and nothing reports it. So those stay closed.
   */
  customOutcomes: boolean;
  why: string;
};

/** The half only a screen knows. Everything else comes from the contract. */
const ROUTER_WORDS: Record<string, { label: string; why: string }> = {
  branch_key: {
    label: "On a confidence score",
    why: "Adds a step that reads a score and decides. You choose the paths and where each one starts.",
  },
  switch: {
    label: "On a rule about the event",
    why: "Adds a step that reads the event and picks a path by rules you write — is this a requirement, did they say yes. Paths are named by the rules.",
  },
  "result.approved_or_end": {
    label: "On whether it was approved",
    why: "Reads the result of the step before it. No extra step is added.",
  },
  "result.continue_or_gate": {
    label: "On whether a person has answered yet",
    why: "For a human gate: carry on once it is resumed, otherwise wait.",
  },
  "result.has_duplicate_or_end": {
    label: "On whether a duplicate was found",
    why: "Reads the result of the step before it. No extra step is added.",
  },
};

/**
 * A router the contract names but nobody has written words for still gets
 * offered, under its key. Hiding it would be worse: the engine can run it, so
 * an author who cannot see it is being kept from something that works.
 */
export const ROUTERS: RouterSpec[] = ROUTER_DEFINITIONS.map((r) => ({
  key: r.key,
  outcomes: [...r.outcomes],
  decisionImpl: r.decisionImpl,
  customOutcomes: r.customOutcomes,
  label: ROUTER_WORDS[r.key]?.label ?? r.key,
  why: ROUTER_WORDS[r.key]?.why ?? "",
}));

/** One `conditionalEdges` entry: a step and where each of its outcomes goes. */
export type Fork = { from: string; router: string; map: Record<string, string> };

/** The fork on this step, if it has one. One per step is all the runtime reads. */
export function forkAt(def: GraphDefinition, id: string): Fork | null {
  return (def.conditionalEdges ?? []).find((ce) => ce.from === id) ?? null;
}

/**
 * Why a branch cannot be added on this edge, or null when it can.
 *
 * Returned as a sentence rather than a boolean because every one of these is
 * something a person would otherwise discover by saving and being refused.
 */
export function whyNoBranch(
  def: GraphDefinition,
  ref: EdgeRef,
  router: RouterSpec,
): string | null {
  if (router.decisionImpl === null) {
    // The fork hangs off the step that ran before it, so there has to be one.
    if (ref.from === "__start__") {
      return "A workflow cannot begin with a branch — the first step has to produce something to decide on.";
    }
    if (forkAt(def, ref.from)) {
      return `${ref.from} already branches. A step can only fork one way.`;
    }
    if (ref.kind === "conditional") {
      return `${ref.from} already branches. Put the new branch on a step further along instead.`;
    }
  }
  return null;
}

/**
 * Add a branch on an edge.
 *
 * The first outcome inherits wherever the edge was going, so the path that
 * already worked keeps working. Every other outcome ends the workflow until
 * somebody builds it out — a visible stub rather than a silent one.
 *
 * Note what is NOT created: a plain edge out of the forking step. A step with
 * both a plain edge and arms runs all of them at once, which is exactly the
 * corruption `insertOnEdge` exists to avoid.
 */
export function addBranch(
  def: GraphDefinition,
  ref: EdgeRef,
  router: RouterSpec,
): { def: GraphDefinition; newNodeId: string | null } {
  const arms: Record<string, string> = {};
  router.outcomes.forEach((name, i) => {
    arms[name] = i === 0 ? ref.to : "__end__";
  });

  // ── the router reads the previous step's result: no step to add ────────
  if (router.decisionImpl === null) {
    return {
      newNodeId: null,
      def: {
        ...def,
        edges: def.edges.filter(
          ([a, b]) => !(a === ref.from && b === ref.to),
        ),
        conditionalEdges: [
          ...(def.conditionalEdges ?? []),
          { from: ref.from, router: router.key, map: arms },
        ],
      },
    };
  }

  // ── the decision is its own step, inserted on the edge ─────────────────
  const id = nextStepId(def, router.decisionImpl);
  /**
   * No config is seeded. The decision's thresholds are declared on its node
   * contract, so the editor's settings panel projects them with their own
   * defaults — the same as every other step. They used to be copied in here
   * from a hardcoded list, which was a stopgap for that node having no
   * declaration at all.
   */
  const config: Record<string, unknown> = {};

  const edges =
    ref.kind === "plain"
      ? [
          ...def.edges.filter(([a, b]) => !(a === ref.from && b === ref.to)),
          [ref.from, id] as [string, string],
        ]
      : [...def.edges];

  const conditionalEdges = [
    // An incoming arm is repointed at the new decision, exactly as inserting a
    // plain step on an arm does.
    ...(def.conditionalEdges ?? []).map((ce) =>
      ref.kind === "conditional" &&
      ce.from === ref.from &&
      ce.map[ref.label] === ref.to
        ? { ...ce, map: { ...ce.map, [ref.label]: id } }
        : ce,
    ),
    { from: id, router: router.key, map: arms },
  ];

  return {
    newNodeId: id,
    def: {
      ...def,
      nodes: [...def.nodes, { id, impl: router.decisionImpl, config }],
      edges,
      conditionalEdges,
    },
  };
}

/** Point one outcome at a different step. */
export function setArmTarget(
  def: GraphDefinition,
  from: string,
  label: string,
  target: string,
): GraphDefinition {
  return {
    ...def,
    conditionalEdges: (def.conditionalEdges ?? []).map((ce) =>
      ce.from === from ? { ...ce, map: { ...ce.map, [label]: target } } : ce,
    ),
  };
}

/* ───────────────────────── editing a fork's paths ─────────────────────── */

/**
 * A name a branch may give one of its paths.
 *
 * The name is not decoration: it is the key the runtime matches on, so it has
 * to be something a decision can actually return. Lowercase, no spaces — the
 * same shape as the built-in names — and unique within the fork, because a
 * duplicate silently replaces the arm before it.
 */
export function whyNotArmName(
  fork: Fork,
  name: string,
  renamingFrom?: string,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Give the path a name.";
  if (!/^[a-z][a-z0-9_]*$/.test(trimmed)) {
    return "Lowercase letters, numbers and underscores, starting with a letter — it is the value the decision returns, not a caption.";
  }
  if (trimmed !== renamingFrom && trimmed in fork.map) {
    return `This branch already has a ${trimmed} path.`;
  }
  return null;
}

/**
 * Add a path to a fork.
 *
 * It ends the workflow until somebody points it somewhere — a visible stub,
 * the same as the paths `addBranch` creates.
 *
 * The band that makes the decision return this name is added alongside it, at
 * a threshold below every existing one, because a new path that can never be
 * reached is the failure this whole area keeps producing. The author moves the
 * threshold afterwards; they do not have to remember to create it.
 */
export function addArm(
  def: GraphDefinition,
  from: string,
  name: string,
): GraphDefinition {
  const node = def.nodes.find((n) => n.id === from);
  const bands = readBands(node);

  return {
    ...def,
    nodes: def.nodes.map((n) =>
      n.id === from && bands
        ? {
            ...n,
            config: {
              ...(n.config ?? {}),
              outcomes: [
                ...bands,
                { name, min: Math.min(...bands.map((b) => b.min)) - 0.1 },
              ],
            },
          }
        : n,
    ),
    conditionalEdges: (def.conditionalEdges ?? []).map((ce) =>
      ce.from === from ? { ...ce, map: { ...ce.map, [name]: "__end__" } } : ce,
    ),
  };
}

/** Remove a path, and the band that produced it. */
export function removeArm(
  def: GraphDefinition,
  from: string,
  name: string,
): GraphDefinition {
  return {
    ...def,
    nodes: def.nodes.map((n) => {
      const bands = n.id === from ? readBands(n) : null;
      if (!bands) return n;
      return {
        ...n,
        config: {
          ...(n.config ?? {}),
          outcomes: bands.filter((b) => b.name !== name),
        },
      };
    }),
    conditionalEdges: (def.conditionalEdges ?? []).map((ce) => {
      if (ce.from !== from) return ce;
      const map = { ...ce.map };
      delete map[name];
      return { ...ce, map };
    }),
  };
}

/**
 * Rename a path, in both places at once.
 *
 * The arm and the band have to move together. Renaming only the edge gives a
 * path nothing reaches; renaming only the band gives a decision returning a
 * name no edge matches, and the runtime falls through to whichever arm is
 * first. Neither reports anything.
 */
export function renameArm(
  def: GraphDefinition,
  from: string,
  oldName: string,
  newName: string,
): GraphDefinition {
  return {
    ...def,
    nodes: def.nodes.map((n) => {
      const bands = n.id === from ? readBands(n) : null;
      if (!bands) return n;
      return {
        ...n,
        config: {
          ...(n.config ?? {}),
          outcomes: bands.map((b) =>
            b.name === oldName ? { ...b, name: newName } : b,
          ),
        },
      };
    }),
    conditionalEdges: (def.conditionalEdges ?? []).map((ce) => {
      if (ce.from !== from) return ce;
      const map: Record<string, string> = {};
      // Rebuilt in order so the arm keeps its place in the list rather than
      // jumping to the end, which would reorder the paths on the canvas.
      for (const [label, target] of Object.entries(ce.map)) {
        map[label === oldName ? newName : label] = target;
      }
      return { ...ce, map };
    }),
  };
}

/** Move the score at or above which a path is taken. */
export function setArmThreshold(
  def: GraphDefinition,
  from: string,
  name: string,
  min: number,
): GraphDefinition {
  return {
    ...def,
    nodes: def.nodes.map((n) => {
      const bands = n.id === from ? readBands(n) : null;
      if (!bands) return n;
      return {
        ...n,
        config: {
          ...(n.config ?? {}),
          outcomes: bands.map((b) => (b.name === name ? { ...b, min } : b)),
        },
      };
    }),
  };
}

/**
 * The bands a decision step is configured with, filling in the defaults the
 * engine would have used.
 *
 * Returns null for a step that is not a score decision — the `result.*`
 * routers have no bands to read, and editing their arms is not offered.
 */
export function readBands(
  node: { impl: string; config?: Record<string, unknown> } | undefined,
): Array<{ name: string; min: number }> | null {
  if (!node || node.impl !== "orch.branch.decision") return null;
  const declared = (node.config ?? {}).outcomes;
  if (Array.isArray(declared)) {
    return declared.filter(
      (o): o is { name: string; min: number } =>
        Boolean(o) &&
        typeof o === "object" &&
        typeof (o as { name?: unknown }).name === "string" &&
        typeof (o as { min?: unknown }).min === "number",
    );
  }
  // Mirrors resolveOutcomes in packages/orchestrator/src/nodes/branch.ts.
  const cfg = node.config ?? {};
  const passMin = typeof cfg.passMin === "number" ? cfg.passMin : 0.6;
  const humanMin = typeof cfg.humanMin === "number" ? cfg.humanMin : 0.35;
  return [
    { name: "pass", min: passMin },
    { name: "human_review", min: humanMin },
    { name: "reject", min: 0 },
  ];
}

/**
 * The arms an `orch.switch` step can produce, from its rules — the switch's
 * counterpart of `readBands`. Null for any other step.
 */
export function readSwitchArms(
  node: { impl: string; config?: Record<string, unknown> } | undefined,
): string[] | null {
  if (!node || node.impl !== "orch.switch") return null;
  return resolveSwitchOutputLabels(node.config ?? {});
}
