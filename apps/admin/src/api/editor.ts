/**
 * Screen 4 — the editor's API calls.
 *
 * In its own file rather than appended to `api.ts`, which is 834 lines and
 * shared by every screen. Four people appending to one file conflict daily.
 */
import { request } from "../api";

/** A node the editor may insert, and everything known about it. */
export type RegistryNode = {
  registryKey: string;
  key: string;
  module: string;
  shareable: boolean;
  title: string;
  description: string;
  sideEffect: string | null;
  /** JSON Schema. Null for nodes that have not declared themselves. */
  inputSchema: JsonSchema | null;
  outputSchema: JsonSchema | null;
  configSchema: JsonSchema | null;
  adminExposed: string[];
  idempotency: { strategy: string; keyPaths?: string[]; keyPath?: string } | null;
  execution: {
    timeoutMs: number;
    retry: { limit: number; backoff: string; baseMs: number };
    locks: string[];
  } | null;
  dependencies: string[];
  persistence: {
    storeInput: string;
    storeOutput: string;
    redactPaths: string[];
  } | null;
  fixtureNames: string[];
  /**
   * Where this node's declaration came from.
   *
   *   contract  declared, and the declaration is what runs
   *   declared  declared, but the engine runs its own implementation, so
   *             nothing checks one against the other
   *   legacy    an engine function with no declaration at all
   *
   * `declared` exists for the two platform control nodes — `human.gate` parks
   * a run, `orch.branch.decision` writes graph state — neither of which can
   * travel back through the contract bridge. Their schemas are real and worth
   * projecting; the guarantee is not, so the screens must not imply one.
   */
  source: "contract" | "declared" | "legacy";
  /** external / financial — needs written justification per graph. */
  requiresAllowlist: boolean;
  /** external / financial are never testable in the editor. */
  editorTestable: boolean;
};

/** Only the parts of JSON Schema the config form renders. */
export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  required?: string[];
  /**
   * What the node does when this is left unset.
   *
   * Rendered as the field's placeholder rather than its value: a blank box
   * cannot be reasoned about, but storing the default would freeze today's
   * answer into the definition and stop the node ever changing its mind.
   */
  default?: unknown;
  label?: string;
  adminExposed?: boolean;
  description?: string;
};

export type GraphNode = {
  id: string;
  impl: string;
  config?: Record<string, unknown>;
  visualType?: "ai_action" | "human_gate";
  /**
   * Where each of this step's inputs comes from: field name → source.
   *
   *     { "jobId": "trigger.requirement_id", "resumeId": "process.resumeId" }
   *
   * Absent on every version stored before input mapping existed, which read
   * the trigger payload and nothing else.
   */
  inputs?: Record<string, string>;
};

export type GraphDefinition = {
  graphKey: string;
  agentName?: string;
  entryInput?: string;
  nodes: GraphNode[];
  edges: Array<[string, string]>;
  conditionalEdges?: Array<{
    from: string;
    router: string;
    map: Record<string, string>;
  }>;
};

export type LoadedVersion = {
  graphKey: string;
  version: number;
  status: string;
  definition: GraphDefinition;
  checksum: string;
  createdBy: string;
  createdAt: string;
  /** Events with an active binding here — the canvas draws these as the chip. */
  triggers: string[];
  /**
   * Where `triggers` came from. `binding` means events reach this workflow
   * today; `draft` means a trigger has been chosen and the binding is created
   * at go-live — a draft binding cannot be stored. The canvas says which.
   */
  triggerSource?: "binding" | "draft" | "none";
  /**
   * Field names the trigger event's payload declares.
   *
   * Every step's input is built from the trigger payload, so this is what the
   * rail checks each step's required inputs against.
   */
  triggerFields?: string[];
  /**
   * Whether that payload was ever described.
   *
   * Eight event schemas hold a permissive placeholder written at boot so
   * ingress can accept an event nobody has documented. Reading those as
   * "carries nothing" would blame the workflow for a gap in the catalogue, so
   * the rail says it cannot check instead.
   */
  triggerDeclared?: boolean;
  editable: boolean;
};

export function listRegistryNodes(module?: string) {
  const qs = module ? `?module=${encodeURIComponent(module)}` : "";
  return request<{ nodes: RegistryNode[]; module: string | null }>(
    `/node-registry${qs}`,
  );
}

export function loadVersion(graphKey: string, version: number) {
  return request<LoadedVersion>(
    `/workflows/${encodeURIComponent(graphKey)}/versions/${version}`,
  );
}

/** Copy the active version into a draft, or return the draft that exists. */
export function startDraft(graphKey: string) {
  return request<{
    graphKey: string;
    version: number;
    created: boolean;
    copiedFrom?: number;
    note?: string;
  }>(`/workflows/${encodeURIComponent(graphKey)}/draft`, { method: "POST" });
}

export function saveDraft(
  graphKey: string,
  version: number,
  definition: GraphDefinition,
) {
  return request<{
    graphKey: string;
    version: number;
    /** The STORED checksum — the save fills in input maps, so it can differ. */
    checksum: string;
    saved: true;
    /** One sentence per step whose input map the save worked out. */
    wiring?: string[];
  }>(
    `/workflows/${encodeURIComponent(graphKey)}/versions/${version}`,
    { method: "PUT", body: JSON.stringify({ definition }) },
  );
}

/* ───────────────────────── TEST THIS NODE ─────────────────────────────── */

export type NodeTestResult = {
  ok: boolean;
  /** How far it got: input · config · run · output · done. */
  stage: "input" | "config" | "run" | "output" | "done";
  nodeKey: string;
  input?: Record<string, unknown>;
  config?: Record<string, unknown>;
  output?: unknown;
  schemaOk?: boolean;
  issues?: Array<{ path: string; message: string }>;
  emitted?: Array<{ event_type: string; payload: unknown }>;
  logs?: string[];
  error?: string;
  errorClass?: string | null;
  ms: number;
  /** The throwaway records it created and then deleted. */
  scratch?: { jobId?: string; resumeId?: string; candidateId?: string };
};

/**
 * Run one node for real.
 *
 * `input` is optional: without it the node runs against throwaway records the
 * server creates and deletes. With it, those values win — which is how a
 * fixture or an earlier attempt gets replayed.
 */
export function runNodeTest(body: {
  nodeKey: string;
  config: Record<string, unknown>;
  input?: Record<string, unknown> | null;
}) {
  return request<NodeTestResult>("/node-test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/* ─────────────────────── Screen 3 · Event catalogue ───────────────────── */

export type CatalogEvent = {
  eventType: string;
  module: string;
  entity: string;
  /** The one hand-written sentence. */
  description: string;
  /** Informal phrases. Empty until the catalogue has a column for them. */
  aliases: string[];
  payloadSchema: unknown;
  producedWhen: string | null;
  status: string;
  /** Derived from the outbox — who has actually published this. */
  producedBy: Array<{ producer: string; count: number }>;
  /** Derived from active bindings — which workflows answer it. */
  consumedBy: Array<{ graphKey: string; moduleQueue: string | null }>;
  everPublished: boolean;
};

export function listCatalogEvents() {
  return request<{ events: CatalogEvent[]; aliasesSupported: boolean }>("/events");
}

/** Registering an event creates a platform contract — so it lands as a draft. */
export function registerDraftEvent(body: {
  eventType: string;
  description: string;
  payloadSchema?: unknown;
}) {
  return request<{ eventType: string; status: string; created: true }>(
    "/events/draft",
    { method: "POST", body: JSON.stringify(body) },
  );
}

/* ────────────────────── Screen 2 · New workflow ───────────────────────── */

export type TriggerCandidate = {
  eventType: string;
  description: string;
  /** The catalogue's own answer to "when is this published". */
  producedWhen: string;
  /**
   * Orders candidates. NOT RENDERED ANYWHERE, deliberately — it is not a
   * probability and its denominator is the length of the description, so it
   * cannot be compared across two proposals. It travels for tests.
   */
  score: number;
  /** The words that made it rank — what the ledger cites. */
  matchedOn: string[];
  /** How many times anything has actually published it. */
  publishCount: number;
  /** False means a workflow triggered on this could never run. */
  everPublished: boolean;
  /**
   * Workflows that already answer this event.
   *
   * Per candidate rather than once per proposal: the author can change the
   * trigger, and the routing question — "somebody already answers this, do you
   * mean to take it from them" — has to be about the event they actually chose.
   */
  answeredBy: Array<{ graphKey: string; moduleQueue: string | null }>;
  /**
   * A step in the proposed workflow publishes this event.
   *
   * Ordered last and never dropped — an author who disagrees has to be able to
   * see it and pick it anyway. The screen's job is to say why it lost.
   */
  selfTriggering: boolean;
  /**
   * How much of what the first step reads this event carries, 0–1.
   *
   * Null when it cannot be known: an undescribed payload, or a first step that
   * declares no inputs. Null is not zero — eight schemas are placeholders
   * written at boot, and scoring those zero would punish a gap in the
   * catalogue harder than a real mismatch.
   */
  satisfies: number | null;
  /** Plain English for the ledger and the picker. Null before a shape exists. */
  why: string | null;
};

export type LedgerEntry = {
  kind:
    | "READ"
    | "SEARCHED"
    | "MATCHED"
    | "REJECTED"
    | "CHOSE"
    | "SET"
    | "SKIPPED"
    /** One sentence turned out to describe two workflows. */
    | "SPLIT";
  text: string;
  citation?: string;
  /**
   * Computed by code, or reasoned by a model. Rendered as a flag so the two
   * are never read with the same trust: a `system` line can be checked against
   * the artifact it cites, a `model` line needs the citation verified first.
   */
  source: "system" | "model";
};

export type Proposal = {
  module: string;
  description: string;
  triggerCandidates: TriggerCandidate[];
  /** Events that shared no wording at all, so were never ranked. */
  notRanked: number;
  /**
   * The proposed shape.
   *
   * `source` is not decoration: `model` is a suggestion built from the whole
   * description, `placeholder` is one arbitrary step shown because generation
   * did not happen. Rendering them the same way would present an apology as
   * advice.
   */
  graph: {
    /**
     * `resolved` means no model was called: the request was answered from
     * the workflow that already runs, with the settings it asked for changed.
     */
    source: "model" | "placeholder" | "resolved";
    nodes: Array<{ id: string; impl: string; config?: Record<string, unknown> }>;
    edges: Array<[string, string]>;
    /** What the model said it could not build. Never silently dropped. */
    unsupported: string[];
    model: string | null;
    summary: string | null;
    fallbackReason: string | null;
  };
  /**
   * The workflows this description becomes, in the order work flows through
   * them. Null when it stayed inside one application — the ordinary case,
   * which should cost the reader no attention.
   *
   * An author may describe work that crosses applications; what cannot cross
   * is the stored graph, so one flow is split into a chain joined by events.
   */
  chain:
    | Array<{
        module: string;
        /** True for the application the author was working in. */
        yours: boolean;
        steps: string[];
        /** The steps themselves — `graph` only carries the first link's. */
        nodes: Array<{ id: string; impl: string; config?: Record<string, unknown> }>;
        edges: Array<[string, string]>;
        /** The handoff that starts this link. Null for the first. */
        startsWith: {
          fromModule: string;
          toModule: string;
          eventType: string;
          /** False when this event would have to be registered first. */
          exists: boolean;
          handledBy: string | null;
        } | null;
        /** A live workflow already answers this link's trigger. */
        alreadyBuilt: string | null;
        /**
         * Whether the previous half publishes the joining event.
         *
         * "no" is only ever returned when EVERY step in that half has declared
         * what it publishes — a fact, not an absence of evidence. "unknown"
         * means at least one step has not declared and may publish it from
         * inside its own code.
         */
        handoffEmitted: "yes" | "no" | "unknown" | null;
      }>
    | null;
  /**
   * The whole outcome the description resolved to — workflow boxes joined by
   * named events, each marked exists / new / blocked. Null for a placeholder
   * proposal, where there is nothing to resolve.
   */

  /** True when the flow crosses applications, split into a chain or not. */
  spansModules: boolean;
  /**
   * Steps owned by another application and not marked shareable. Buildable and
   * testable now; go-live needs the owner to share them first.
   */
  borrowedSteps: Array<{ step: string; ownedBy: string }>;
  /**
   * Workflows this flow sets running by publishing an event. `alsoRunsHere`
   * non-empty means the same work happens twice — once here, once there.
   */
  triggeredWorkflows: Array<{
    stepId: string;
    impl: string;
    eventType: string;
    graphKey: string;
    alsoRunsHere: string[];
  /**
   * The overlap the platform will absorb, and the overlap it will not.
   *
   * A shared step is only truly run twice when its declared idempotency key
   * cannot be built from BOTH payloads involved — the trigger feeding this
   * flow, and the emitted event feeding the other one. Otherwise the runtime
   * skips the second copy and the shape is merely redundant.
   */
  absorbed?: string[];
  unabsorbed?: string[];
  }>;
  /**
   * A step publishes the very event that starts this flow.
   *
   * Every run would start another, and nothing would stop it — the router has
   * no depth guard and the go-live gate's other eight checks never compared the
   * trigger against what the steps publish. Null is the ordinary case.
   */
  selfTriggering: {
    eventType: string;
    steps: Array<{ stepId: string; impl: string }>;
  } | null;
  /**
   * Why it was stored as one workflow or as several. Null when the flow never
   * left one application and there was nothing to decide.
   */
  chainDecision: { chain: boolean; reason: string } | null;
  suggestedTrigger: string | null;
  availableNodes: Array<{
    key: string;
    title: string;
    description: string;
    sideEffect: string | null;
    source: "contract" | "declared" | "legacy";
    hasSchemas: boolean;
  }>;
  extractedConfig: Array<{ field: string; value: number; phrase: string }>;
  routing: {
    existing: Array<{ graphKey: string; moduleQueue: string | null }>;
    /** False today — one active binding per event is enforced by an index. */
    fanoutPossible: boolean;
  };
  ledger: LedgerEntry[];
};

export function proposeWorkflow(body: { module: string; description: string }) {
  return request<Proposal>("/workflows/propose", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function acceptProposal(body: {
  graphKey: string;
  module: string;
  triggerEventType: string;
  nodes: Array<{ id: string; impl: string; config?: Record<string, unknown> }>;
}) {
  return request<{
    graphKey: string;
    version: number;
    status: string;
    triggerEventType: string;
    bindingCreated: boolean;
    note: string;
  }>("/workflows/accept", { method: "POST", body: JSON.stringify(body) });
}

/**
 * The workflows either side of this one.
 *
 * A cross-application flow is stored as a chain, and the editor edits one
 * link. Without this the canvas would show no sign the others exist.
 */
export type ChainNeighbours = {
  graphKey: string;
  upstream: Array<{ graphKey: string; via: string }>;
  downstream: Array<{ graphKey: string; via: string }>;
};

export function loadChain(graphKey: string) {
  return request<ChainNeighbours>(
    `/workflows/${encodeURIComponent(graphKey)}/chain`,
  );
}

/**
 * Accept a flow that crosses applications: one draft per application, plus any
 * handoff event that does not exist yet.
 *
 * Separate from `acceptProposal` because it is a different promise — it writes
 * to the shared event catalogue and creates workflows in applications the
 * author does not own, and all of it happens or none of it does.
 */
export function acceptChain(body: {
  links: Array<{
    graphKey: string;
    module: string;
    fromModule?: string;
    triggerEventType: string;
    /** True when that trigger has to be added to the catalogue first. */
    registerTrigger?: boolean;
    nodes: Array<{ id: string; impl: string; config?: Record<string, unknown> }>;
  }>;
}) {
  return request<{
    created: Array<{ graphKey: string; module: string }>;
    createdEvents: string[];
    status: string;
    note: string;
  }>("/workflows/accept-chain", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type GoLiveCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type GoLiveChecks = {
  graphKey: string;
  version: number;
  status: string;
  /**
   * False for a runtime workflow key. The gate refuses those by design — they
   * are seeded by migration and an authored workflow must not collide with one
   * — so judging them would produce failures that mean nothing.
   */
  applicable: boolean;
  reason: string | null;
  ok?: boolean;
  checks: GoLiveCheck[];
};

/**
 * What the go-live gate would say, asked while there is still time to act.
 *
 * Read-only, and deliberately so: asking the question must never be the thing
 * that answers it. These are the same checks that run at release — the only
 * thing that was missing was somewhere to see them beforehand.
 */
export function loadGoLiveChecks(graphKey: string, version?: number) {
  const q = version ? `?version=${version}` : "";
  return request<GoLiveChecks>(
    `/workflows/${encodeURIComponent(graphKey)}/checks${q}`,
  );
}

export type GraphDiff = {
  trigger: { from: string | null; to: string | null; changed: boolean };
  nodes: Array<{
    id: string;
    kind: "added" | "removed" | "changed";
    impl: string;
    implFrom?: string;
    config: Array<{ field: string; from: unknown; to: unknown }>;
  }>;
  edgesAdded: Array<[string, string]>;
  edgesRemoved: Array<[string, string]>;
  identical: boolean;
  summary: string;
};

export type DiffResponse = {
  graphKey: string;
  from: number | null;
  to: number;
  versions: Array<{ version: number; status: string }>;
  diff: GraphDiff | null;
  /** Set when there is nothing to compare — a first version. */
  note: string | null;
};

/**
 * What changed between two versions.
 *
 * With no arguments it compares the two most recent, because that is the
 * question nine times in ten: what did I just do.
 */
export function loadDiff(graphKey: string, from?: number, to?: number) {
  const q = new URLSearchParams();
  if (from != null) q.set("from", String(from));
  if (to != null) q.set("to", String(to));
  const qs = q.toString();
  return request<DiffResponse>(
    `/workflows/${encodeURIComponent(graphKey)}/diff${qs ? `?${qs}` : ""}`,
  );
}

/**
 * Stop a workflow running, without deleting anything.
 *
 * Retires its active binding and nothing else — the definition and every
 * version stay exactly as they are. `expectedEventType` guards against a screen
 * that has been open a while: if the binding has changed underneath you, this
 * refuses rather than taking the wrong event offline.
 */
export function takeWorkflowOffline(
  graphKey: string,
  expectedEventType?: string,
) {
  return request<{
    graphKey: string;
    offline: boolean;
    retired: string[];
    rowsChanged: number;
    note: string;
  }>(`/workflows/${encodeURIComponent(graphKey)}/take-offline`, {
    method: "POST",
    body: JSON.stringify(expectedEventType ? { expectedEventType } : {}),
  });
}

/**
 * Make an earlier version the active one.
 *
 * A binding names a workflow, not a version, so rolling back changes which
 * version is active rather than re-pointing anything. Omit `toVersion` for the
 * version below the current one — which is not `active - 1`, since version
 * numbers have gaps.
 */
export function rollbackWorkflow(graphKey: string, toVersion?: number) {
  return request<{
    graphKey: string;
    from: number;
    to: number;
    note: string;
  }>(`/workflows/${encodeURIComponent(graphKey)}/rollback`, {
    method: "POST",
    body: JSON.stringify(toVersion != null ? { toVersion } : {}),
  });
}

/**
 * The lifecycle, one call per verb.
 *
 * Each is a POST with no body: the server decides which version it means —
 * the only compiled one, the one waiting longest — because a client that
 * picks the version can pick a stale one between a refresh and a click.
 */
export function compileDraft(graphKey: string) {
  return request<{
    graphKey: string;
    version: number;
    checksum: string;
    status: string;
    note?: string;
  }>(`/workflows/${encodeURIComponent(graphKey)}/compile`, { method: "POST" });
}

/** One step, as the outline describes it — no config, no payloads. */
export type OutlineStep = {
  id: string;
  impl: string;
  /** The human name from the node registry, when the node declares one. */
  title: string | null;
  sideEffect: string | null;
  /** On a step that splits: the names of its outcomes. */
  outcomes: string[] | null;
  /** The node registry has never heard of this impl. */
  unknown: boolean;
};

/**
 * What a workflow IS, at a glance — the shape of it and nothing else.
 *
 * Deliberately small: the order of the steps, what each one is, what starts
 * it, which version is live. No timings, no payloads, no per-run anything.
 * Those belong to a run, and putting them on the history page would make it
 * the cluttered screen this is meant to save people from.
 */
export type WorkflowOutline = {
  graphKey: string;
  version: number;
  status: string;
  live: boolean;
  compiledAt: string | null;
  triggers: string[];
  triggerSource: "binding" | "draft" | "none";
  /** How many places the flow splits. */
  branchCount: number;
  /**
   * The connections, so the panel can draw the workflow rather than list it.
   * `label` is the arm name on a branch edge, null on an ordinary one.
   * `__start__` and `__end__` appear here but not in `steps`.
   */
  edges: Array<{ from: string; to: string; label: string | null }>;
  steps: OutlineStep[];
};

export function loadOutline(graphKey: string) {
  return request<WorkflowOutline>(
    `/workflows/${encodeURIComponent(graphKey)}/outline`,
  );
}

/** One workflow version waiting for a second person to approve it. */
export type PendingGoLive = {
  graphKey: string;
  module: string;
  version: number;
  checksum: string | null;
  requestedAt: string | null;
  requestedBy: string | null;
  /**
   * What the author said this version changes and why.
   *
   * The approver is never the author — `graph_versions_two_person_ck` refuses
   * that — so without this they open the queue and decide from a key, a number
   * and a checksum. Null for a request made before notes existed, and for a
   * change somebody judged spoke for itself.
   */
  requestNote: string | null;
  compiledAt: string | null;
  compiledBy: string | null;
  /** What approving would replace, or null when nothing is live yet. */
  liveVersion: number | null;
  liveSince: string | null;
  /** What starts it — already bound, or chosen and bound at go-live. */
  triggers: string[];
  triggerSource: "binding" | "draft" | "none";
  stepCount: number;
  /** No active binding — it would go live and nothing would route to it. */
  unreachable: boolean;
};

/**
 * Everything awaiting approval, oldest request first.
 *
 * The request half of this has existed since V20260909.48 and the queue has
 * not, so a go-live could be asked for and seen by nobody.
 */
export function listPendingGoLive() {
  return request<{ requests: PendingGoLive[]; orgId: string | null }>(
    "/workflows/pending-go-live",
  );
}

/**
 * Freeze the working copy and ask for approval, in one call.
 *
 * Was two — compile, then request — and compiling always inserts, so pressing
 * send twice produced two versions of an identical definition and the panel
 * that said "v1" sent "v2". The server reuses a version whose checksum matches
 * the draft, which is the same rule the test pin uses, so what you tested and
 * what you send are the same version by construction.
 */
/**
 * Everything needed to decide whether to ask somebody to put this live.
 *
 * Read-only, including the version: opening the screen must not compile, or
 * looking at it twice leaves two versions behind. `wouldCompile` says whether
 * raising the request will freeze a new one.
 */
export type ApprovalRequestReview = {
  graphKey: string;
  version: number | null;
  wouldCompile: boolean;
  liveVersion: number | null;
  alreadyPending: boolean;
  trigger: string | null;
  steps: Array<{ id: string; impl: string }>;
  /**
   * Runs of THIS VERSION.
   *
   * A fact about the version rather than about the browser tab — the inline
   * panel used in-session state, so testing and then reloading reported
   * "nothing yet" for a version with three runs behind it.
   */
  tested: {
    total: number;
    byStatus: Array<{
      status: string;
      count: number;
      last: string | null;
      latestRunId: string | null;
    }>;
  };
};

export function loadApprovalRequest(graphKey: string) {
  return request<ApprovalRequestReview>(
    `/workflows/${encodeURIComponent(graphKey)}/approval-request`,
  );
}

export function sendForApprovalRequest(graphKey: string, note?: string) {
  return request<{
    graphKey: string;
    version: number;
    status: string;
    compiled: boolean;
    note?: string;
  }>(`/workflows/${encodeURIComponent(graphKey)}/send-for-approval`, {
    method: "POST",
    body: JSON.stringify({ note: note ?? null }),
  });
}

export function requestGoLive(graphKey: string, note?: string) {
  return request<{ graphKey: string; version: number; status: string; note?: string }>(
    `/workflows/${encodeURIComponent(graphKey)}/request-go-live`,
    { method: "POST", body: JSON.stringify({ note: note ?? null }) },
  );
}

export function approveGoLive(graphKey: string) {
  return request<{
    graphKey: string;
    version: number;
    previousLive: number | null;
    boundTo: string | null;
    live: boolean;
    note?: string;
  }>(`/workflows/${encodeURIComponent(graphKey)}/approve-go-live`, {
    method: "POST",
  });
}

export function cancelGoLiveRequest(graphKey: string) {
  return request<{ graphKey: string; version: number; status: string; note?: string }>(
    `/workflows/${encodeURIComponent(graphKey)}/cancel-go-live-request`,
    { method: "POST" },
  );
}

export function takeOffline(graphKey: string) {
  return request<{
    graphKey: string;
    offline: boolean;
    retired: string[];
    note?: string;
  }>(`/workflows/${encodeURIComponent(graphKey)}/take-offline`, { method: "POST" });
}

/* ───────────────────── Screen 10 · Release console ─────────────────────── */

/** One go-live check, as the console shows it. */
export type ReleaseCheck = {
  id: string;
  ok: boolean;
  message: string;
  /**
   * The check could not run. Distinct from a pass, and shown differently:
   * "we looked and it was fine" and "we could not look" must not read alike.
   */
  unchecked: boolean;
};

export type ReleaseRouting = {
  eventType: string;
  before: Array<{ workflowKey: string; group: string; gatedOn: string[] }>;
  after: Array<{ workflowKey: string; group: string; gatedOn: string[] }>;
  /** Workflows that stop receiving the event if this is approved. */
  losing: string[];
  /** Workflows that start receiving it. */
  gaining: string[];
};

/** Everything the approver needs, in one call. */
export type ReleaseView = {
  graphKey: string;
  version: number;
  checksum: string | null;
  requestedAt: string | null;
  requestedBy: string | null;
  compiledAt: string | null;
  compiledBy: string | null;
  trigger: string | null;
  steps: Array<{ id: string; impl: string }>;
  /** What goes off the air. Null when nothing is live yet. */
  replaces: { version: number; since: string | null; stepCount: number } | null;
  checks: ReleaseCheck[];
  blocked: boolean;
  blockedBy: string[];
  routing: ReleaseRouting | null;
};

export function loadRelease(graphKey: string) {
  return request<ReleaseView>(
    `/workflows/${encodeURIComponent(graphKey)}/release`,
  );
}

/** An application a workflow might be authored for. */
export type AuthorableApplication = {
  key: string;
  name: string;
  status: string;
  nodes: number;
  triggers: number;
  /**
   * It has both steps to use and an event that can start them.
   *
   * ASTRA is the case this exists for: six node contracts in git, and no
   * events left in this project. Offering it produced a workflow with steps,
   * no trigger, and nothing able to start it.
   */
  authorable: boolean;
};

export function listApplications() {
  return request<{ applications: AuthorableApplication[] }>("/applications");
}
