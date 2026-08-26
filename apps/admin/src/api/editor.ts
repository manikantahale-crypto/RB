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
  source: "contract" | "legacy";
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
  /** Orders candidates. Not a probability, and not shown as one. */
  score: number;
  /** The words that made it rank — what the ledger cites. */
  matchedOn: string[];
};

export type LedgerEntry = {
  kind: "READ" | "MATCHED" | "CHOSE" | "SET" | "SKIPPED";
  text: string;
  citation?: string;
  action?: "trigger" | "config" | "graph";
};

export type Proposal = {
  module: string;
  description: string;
  triggerCandidates: TriggerCandidate[];
  suggestedTrigger: string | null;
  availableNodes: Array<{
    key: string;
    title: string;
    description: string;
    sideEffect: string | null;
    source: "contract" | "legacy";
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
