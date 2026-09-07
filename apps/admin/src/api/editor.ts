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
  return request<{ graphKey: string; version: number; checksum: string; saved: true }>(
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
    source: "model" | "placeholder";
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
      }>
    | null;
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
