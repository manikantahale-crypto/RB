export type PolicySummary = {
  status: string;
  version: number;
  updatedAt: string;
  author: string;
  checksum: string | null;
};

export type LastGeneratedSummary = {
  version: number;
  generatedAt: string;
  generatedBy: string;
  status: string;
};

export type AgentListItem = {
  id: string;
  name: string;
  purpose: string;
  canEdit: boolean;
  policy: PolicySummary | null;
  /** Authoring one-active version (§8.1), or null if none active yet. */
  activeVersion: number | null;
  activeUpdatedAt?: string | null;
  lastGenerated: LastGeneratedSummary | null;
  binding?: {
    eventType: string;
    graphKey: string;
    version: number | null;
    source: string;
  } | null;
};

export type BuilderOverviewAgent = {
  id: string;
  name: string;
  agentKey: string;
  purpose: string;
  policyStatus: string | null;
  policyVersion: number | null;
  policyText: string;
  triggerEventType: string | null;
  graphVersion: number | null;
  graphStatus: string | null;
  graphChecksum: string | null;
  graphKey: string | null;
  workflowSteps: Array<{
    order: number;
    id: string;
    impl: string;
    label: string;
    detail?: string;
  }>;
  workflowEmpty: boolean;
  definition: {
    graphKey: string;
    nodes: Array<{ id: string; impl: string; config?: Record<string, unknown> }>;
    edges: Array<[string, string]>;
  } | null;
  binding: {
    eventType: string;
    graphKey: string;
    version: number | null;
    moduleQueue: string;
    source: string;
  } | null;
};

export type BuilderOverview = {
  orgId: string | null;
  agents: BuilderOverviewAgent[];
  tools: Array<{
    key: string;
    description: string;
    triggeredBy: string;
    outputEvent: string;
    outputShape: string;
  }>;
  triggerEvents: Array<{
    eventType: string;
    label: string;
    description: string;
    defaultGraphKey: string;
  }>;
};

export type AgentDetail = {
  id: string;
  name: string;
  purpose: string;
  orgId: string | null;
  canEdit: boolean;
  template: {
    id: string;
    agentKey: string;
    displayName: string;
    version: number;
    policyExt: string;
    baseFields?: Array<{
      key: string;
      label: string;
      kind: string;
      options?: string[];
      min?: number;
      max?: number;
      hint?: string;
      defaultValue?: unknown;
    }>;
    policyExtFields?: Array<{
      key: string;
      label: string;
      kind: string;
      options?: string[];
      min?: number;
      max?: number;
      hint?: string;
      defaultValue?: unknown;
    }>;
    template: Record<string, unknown>;
  } | null;
  policy: {
    id: string;
    version: number;
    status: string;
    policy: Record<string, unknown>;
    checksum: string | null;
    updatedAt: string;
    createdBy: string;
  } | null;
  /** Latest stored graph artifact for this agent (if any). */
  workflow?: {
    definition: {
      graphKey: string;
      nodes: Array<{ id: string; impl: string; config?: Record<string, unknown> }>;
      edges: Array<[string, string]>;
    };
    version: number;
    checksum: string;
    status?: string;
    generatedAt?: string;
  } | null;
  generation?: {
    mode: "llm" | "template";
    model?: string | null;
    userRequest?: string | null;
    systemPrompt?: string | null;
    policyPrompt?: string | null;
    allowedTools: string[];
    triggerEventType?: string | null;
    toolsUsed: string[];
    graphKey?: string | null;
    builtSummary?: string | null;
    unsupported?: string[];
    generatedAt: string;
    triggerEventSchema?: {
      eventType: string;
      schemaVersion: string;
      description: string;
      payloadSchema: unknown;
      envelopeFields: unknown;
    } | null;
  } | null;
  triggerEventSchema?: {
    eventType: string;
    schemaVersion: string;
    description: string;
    payloadSchema: unknown;
    envelopeFields: unknown;
    producedWhen: string | null;
    primaryConsumer: string | null;
  } | null;
  runtime?: {
    binding: {
      eventType: string;
      graphKey: string;
      moduleQueue: string;
      version: number | null;
      source: string;
      status: string;
    } | null;
    activeCompiledGraph: {
      graphKey: string;
      version: number;
      checksum: string;
      status: string;
    } | null;
  };
};

export type FieldError = { path: string; message: string };

export type ApiErrorBody = {
  error?: string;
  message?: string;
  fields?: FieldError[];
  currentVersion?: number;
  status?: string;
  blockedBy?: string[];
  checks?: Array<{ id: string; ok: boolean; message: string }>;
  eventType?: string;
  existingAgentId?: string | null;
  existingGraphKey?: string | null;
};

const API_BASE = import.meta.env.VITE_ADMIN_API_URL ?? "/api";

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; body: ApiErrorBody }> {
  const headers: Record<string, string> = {
    "x-admin-id": "admin-local",
  };
  if (init?.headers) {
    for (const [key, value] of Object.entries(init.headers)) {
      if (value != null && value !== "") {
        headers[key] = String(value);
      }
    }
  }
  const hasBody = init?.body != null && init.body !== "";
  if (hasBody && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
    });
  } catch {
    return {
      ok: false,
      status: 0,
      body: {
        error: "NETWORK_ERROR",
        message:
          "Cannot reach the admin API on port 4200. Start it with: npm run dev:admin",
      },
    };
  }

  const body = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!res.ok) {
    if (res.status === 500 && !body.message && !body.error) {
      return {
        ok: false,
        status: res.status,
        body: {
          error: "SERVER_ERROR",
          message:
            "Admin API is unreachable or still starting (Vite proxy returned 500). Wait a few seconds and refresh, or check the api terminal — if you see ECONNREFUSED, the UI started before the API was ready.",
        },
      };
    }
    return { ok: false, status: res.status, body };
  }
  return { ok: true, data: body as T };
}

export function listCatalogTools() {
  return request<{
    tools: Array<{
      key: string;
      description: string;
      input: Record<string, string>;
      output: { event: string; shape: string };
      triggeredBy: string;
    }>;
  }>("/catalog/tools");
}

export function listCatalogEvents() {
  return request<{
    events: Array<{
      eventType: string;
      label: string;
      description: string;
      moduleQueue: string;
      defaultGraphKey: string;
    }>;
  }>("/catalog/events?kind=trigger");
}

export function createAgent(body: {
  name: string;
  purpose?: string;
  baseTemplateKey?: string;
  cloneFromAgentId?: string;
}) {
  return request<{
    id: string;
    name: string;
    agentKey: string;
    purpose: string;
    policyExt: string;
    status: string;
    version: number;
  }>("/agents", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getEventSchema(eventType: string, version = "1.0") {
  return request<{
    eventType: string;
    schemaVersion: string;
    description: string;
    payloadSchema: unknown;
    envelopeFields: unknown;
    producedWhen: string | null;
    primaryConsumer: string | null;
  }>(`/catalog/events/${encodeURIComponent(eventType)}/schema?version=${encodeURIComponent(version)}`);
}

export function listAgents() {
  return request<{ orgId: string | null; agents: AgentListItem[] }>("/agents");
}

export function getBuilderOverview() {
  return request<BuilderOverview>("/builder/overview");
}

export function getAgent(id: string) {
  return request<AgentDetail>(`/agents/${id}`);
}

export function deleteAgent(id: string) {
  return request<{ status: string; agentId: string }>(`/agents/${id}`, {
    method: "DELETE",
  });
}

export function savePolicy(
  id: string,
  policy: unknown,
  expectedVersion?: number,
) {
  return request<{
    status: string;
    agentId: string;
    version: number;
    policyId: string;
    updatedAt: string;
    policy: unknown;
  }>(`/agents/${id}/policy`, {
    method: "PUT",
    body: JSON.stringify({ policy, expectedVersion }),
  });
}

export function takeOffline(id: string, expectedVersion?: number) {
  return request<{
    status: string;
    agentId: string;
    version?: number;
    message?: string;
  }>(`/agents/${id}/take-offline`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  });
}

export type GenerateAgentOptions = {
  request?: string;
  mode?: "llm" | "template";
  /** Layer 3: run LLM + validate, do not store. */
  preview?: boolean;
  /** Layer 3: persist a previously previewed definition. */
  accept?: boolean;
  definition?: unknown;
  unsupported?: string[];
};

export type GenerateAgentResult = {
  status: string;
  agentId: string;
  agentKey?: string;
  graphKey?: string;
  version: number;
  checksum?: string;
  generatedAt?: string;
  artifactRef?: string;
  definition?: unknown;
  mode?: "llm" | "template";
  model?: string | null;
  request?: string | null;
  preview?: boolean;
  unsupported?: string[];
  builtSummary?: string | null;
  message?: string;
  generationTrace?: {
    mode: "llm" | "template";
    pipeline: string;
    userRequest?: string | null;
    systemPrompt?: string | null;
    rawText?: string | null;
    model?: string | null;
    extracted?: {
      matchThreshold?: number;
      rerank?: boolean;
      hardFilters?: string[];
    };
    codePaths: string[];
  } | null;
};

export function generateAgent(
  id: string,
  policy: unknown,
  expectedVersion?: number,
  options?: GenerateAgentOptions,
) {
  return request<GenerateAgentResult>(`/agents/${id}/generate`, {
    method: "POST",
    body: JSON.stringify({
      policy,
      expectedVersion,
      request: options?.request,
      mode: options?.mode,
      preview: options?.preview,
      accept: options?.accept,
      definition: options?.definition,
      unsupported: options?.unsupported,
    }),
  });
}

export function goLive(id: string, expectedVersion?: number) {
  return request<{
    status: string;
    agentId: string;
    version?: number;
    checksum?: string | null;
    graphKey?: string;
    message?: string;
    checks?: Array<{ id: string; ok: boolean; message: string }>;
    blockedBy?: string[];
    failedStep?: string;
  }>(`/agents/${id}/go-live`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  });
}

export function requestGoLive(id: string, expectedVersion?: number) {
  return request<{
    status: string;
    agentId: string;
    version: number;
    message?: string;
    alreadyPending?: boolean;
  }>(`/agents/${id}/request-go-live`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  });
}

export function cancelGoLiveRequest(id: string, expectedVersion?: number) {
  return request<{
    status: string;
    agentId: string;
    version: number;
    message?: string;
  }>(`/agents/${id}/cancel-go-live-request`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  });
}

export function listGoLiveRequests() {
  return request<{
    requests: Array<{
      agentId: string;
      name: string;
      purpose: string;
      version: number;
      status: string;
      requestedAt: string;
      requestedBy: string;
      checksum: string | null;
    }>;
  }>("/go-live-requests");
}

export function approveGoLive(id: string, expectedVersion?: number) {
  return request<{
    status: string;
    agentId: string;
    version?: number;
    checksum?: string | null;
    message?: string;
    failedStep?: string;
  }>(`/agents/${id}/approve-go-live`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  });
}

export function compileAgent(id: string, expectedVersion?: number) {
  return request<{
    status: string;
    agentId: string;
    agentKey?: string;
    graphKey: string;
    version: number;
    checksum: string;
  }>(`/agents/${id}/compile`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  });
}

export function publishAgent(id: string, expectedVersion?: number) {
  return request<{
    status: string;
    agentId: string;
    agentKey?: string;
    graphKey: string;
    version: number;
    checksum: string;
  }>(`/agents/${id}/publish`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  });
}

export function activateAgent(id: string, expectedVersion?: number) {
  return request<{
    status: string;
    agentId: string;
    agentKey?: string;
    graphKey: string;
    version: number;
    checksum: string;
    graphId?: string;
  }>(`/agents/${id}/activate`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  });
}

export function rollbackAgent(id: string, targetVersion: number) {
  return request<{
    status: string;
    rolledBackTo: number;
    agentId: string;
    agentKey?: string;
    graphKey: string;
    version: number;
    checksum: string;
    graphId?: string;
  }>(`/agents/${id}/rollback`, {
    method: "POST",
    body: JSON.stringify({ targetVersion }),
  });
}

export function getRuntimeTrace(eventId: string) {
  return request<{
    eventId: string;
    outbox_count: number;
    runs_count: number;
    steps_count: number;
    outbox: Array<Record<string, unknown>>;
    runs: Array<Record<string, unknown>>;
    steps: Array<Record<string, unknown>>;
  }>(`/runtime/trace/${encodeURIComponent(eventId)}`);
}

export function listRuntimeRuns(limit = 40) {
  return request<{ runs: Array<Record<string, unknown>> }>(
    `/runtime/runs?limit=${limit}`,
  );
}

export function getRuntimeRunSteps(runId: string) {
  return request<{
    runId: string;
    steps: Array<Record<string, unknown>>;
  }>(`/runtime/runs/${encodeURIComponent(runId)}/steps`);
}

export function resumeRuntimeThread(body: {
  thread_id: string;
  graph_key: string;
  organization_id: string;
  graph_version?: number;
  decision?: { approved?: boolean; note?: string };
}) {
  return request<{ status: string; thread_id?: string }>(
    "/runtime/threads/resume",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function getRuntimeOverview() {
  return request<{
    stats: {
      runsTotal: number;
      graphsGenerated: number;
      graphsActive: number;
      runsByStatus: Array<{ status: string; n: number }>;
      runsByGraph: Array<{
        graph_key: string;
        n: number;
        last_run_at: string | null;
      }>;
      handoffs14d: {
        bridge_to_syntra?: number;
        astra_rejected?: number;
        astra_scored?: number;
        syntra_parsed?: number;
        human_gates?: number;
      };
    };
    liveBindings: Array<{
      event_type: string;
      graph_key: string;
      version: number;
      agent_id: string | null;
      module_queue: string;
      source: string;
      status: string;
    }>;
    recentRuns: Array<Record<string, unknown>>;
    howOrchPicksUp: string;
  }>("/runtime/overview");
}

export type AgentArtifacts = {
  agentId: string;
  agentName: string | null;
  agentKey: string | null;
  liveNow?: {
    eventType: string;
    graphKey: string;
    version: number;
    status: string;
    summary: string;
  } | null;
  liveBinding: {
    eventType: string;
    graphKey: string;
    version: number;
    status: string;
  } | null;
  versions: Array<{
    id: string;
    version: number;
    status: string;
    generatedAt: string | null;
    generatedBy: string | null;
    checksum: string | null;
    graphKey: string | null;
    isLive: boolean;
    label: string;
    policyText?: string | null;
    triggerEventType?: string | null;
    workflowSteps?: Array<{
      order: number;
      title: string;
      impl: string;
      description?: string | null;
      config?: Record<string, unknown>;
    }>;
    unsupported?: string[];
    toolsUsed?: string[];
    builtSummary?: string | null;
  }>;
  runs: Array<{
    id: string;
    graphKey: string;
    status: string;
    statusLabel?: string;
    currentAction?: string;
    triggerEventId: string | null;
    createdAt: string | null;
    completedAt: string | null;
    error: unknown;
    needsHuman: boolean;
    threadId: string | null;
    organizationId: string | null;
    inputEventType?: string | null;
    outputEventTypes?: string[];
    events?: Array<{
      eventType: string;
      eventId: string;
      producer: string | null;
      occurredAt: string | null;
      role: "input" | "output";
    }>;
    policyText?: string | null;
    workflowSteps?: Array<{ order: number; title: string; impl: string }>;
    graphVersion?: number | null;
    steps: Array<{
      seq: number;
      node: string;
      tool: string | null;
      status: string;
      latencyMs: number | null;
      branchKey: unknown;
      result: unknown;
      confidence: unknown;
      output: Record<string, unknown>;
    }>;
  }>;
};

export function getAgentArtifacts(agentId: string) {
  return request<AgentArtifacts>(
    `/runtime/agent-artifacts/${encodeURIComponent(agentId)}`,
  );
}

/* ─────────────────────── Screen 1 · Workflows registry ─────────────────── */

export type WorkflowRegistryRow = {
  graphKey: string;
  module: string;
  /** Events with an ACTIVE binding here. Empty means nothing can start it. */
  triggers: string[];
  activeVersion: number | null;
  orgActiveVersion: number | null;
  draftCount: number;
  versionCount: number;
  health: {
    runs24h: number;
    failed24h: number;
    waiting: number;
    lastRunAt: string | null;
  };
  /** Active, but no binding points at it — it can never fire. */
  orphan: boolean;
};

export function listWorkflows() {
  return request<{ workflows: WorkflowRegistryRow[]; orgId: string | null }>(
    "/workflows",
  );
}

/* ───────────────────────── Screen 12 · Runs list ───────────────────────── */

export type WorkflowRun = {
  runId: string;
  graphKey: string;
  /** Which door fired — matters when several events start one workflow. */
  triggerEvent: string | null;
  triggerEventId: string | null;
  orgId: string | null;
  /** Version this run executed, when knowable. */
  pinnedVersion: number | null;
  /** "recorded" by the runtime, or "inferred" from a single-version graph. */
  versionSource: "recorded" | "inferred" | null;
  status: string;
  agentName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  correlationId: string | null;
  error: unknown;
  stepCount: number;
};

export function listWorkflowRuns(
  graphKey: string,
  opts?: { status?: string; q?: string; limit?: number },
) {
  const params = new URLSearchParams();
  if (opts?.status && opts.status !== "all") params.set("status", opts.status);
  if (opts?.q) params.set("q", opts.q);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request<{
    graphKey: string;
    runs: WorkflowRun[];
    counts: Record<string, number>;
    total: number;
    limit: number;
  }>(`/workflows/${encodeURIComponent(graphKey)}/runs${qs ? `?${qs}` : ""}`);
}

/* ──────────────────────── Screen 13 · Run detail ───────────────────────── */

export type RunStep = {
  seq: number;
  node: string;
  tool: string | null;
  status: string;
  latencyMs: number | null;
  output: Record<string, unknown> | null;
  at: string | null;
};

export type RunPathNode = {
  node: string;
  tool: string | null;
  attempts: number;
  /** Outcome of the LAST attempt — a node that retried and succeeded is OK. */
  status: string;
  totalLatencyMs: number;
  firstAt: string | null;
  errorClass: string | null;
};

export type RunDetail = {
  runId: string;
  graphKey: string;
  pinnedVersion: number | null;
  status: string;
  agentName: string | null;
  orgId: string | null;
  triggerEvent: string | null;
  triggerEventId: string | null;
  triggerPayload: unknown;
  correlationId: string | null;
  threadId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  error: unknown;
};

export function getRunDetail(runId: string) {
  return request<{ run: RunDetail; path: RunPathNode[]; steps: RunStep[] }>(
    `/runs/${encodeURIComponent(runId)}`,
  );
}
