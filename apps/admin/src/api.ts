import { authHeader } from "./lib/session.js";
/**
 * Shared API plumbing, and the calls that have not moved to their own file yet.
 *
 * THE AGENT MODEL IS NO LONGER HERE.
 *
 * This file opened with 200 lines of types describing agents, their policies
 * and the Builder overview — PolicySummary, AgentListItem, BuilderOverview,
 * AgentDetail — followed by the twenty-odd calls that read and wrote them.
 * Every screen that used them has been removed: an agent owned a workflow in
 * the trial-era model, and the unit of authorship is a workflow now.
 *
 * The TABLES are untouched, and so is the runtime. The orchestrator reads
 * builder.agent_definitions before each node to decide whether an actor may
 * act unattended (packages/orchestrator/src/policy/engine.ts), and the
 * admin-api routes those screens called are still mounted. What went is the
 * client for a UI that no longer exists.
 */
/** A field the server rejected, and why. Rendered next to the input. */
export type FieldError = { path: string; message: string };

/**
 * The shape every failing response is read through.
 *
 * Two fields here belong to the removed agent screens — `existingAgentId` and
 * `blockedBy` — and they stay because the admin-api routes that send them are
 * still mounted. Narrowing this to what the current screens read would make
 * the client quietly drop information the server is still sending.
 */
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

const rawBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
const API_BASE = rawBaseUrl
  ? `${rawBaseUrl.replace(/\/$/, "")}/admin-api`
  : (import.meta.env.VITE_ADMIN_API_URL ?? "/api");

/**
 * Exported so each screen can keep its own API file (see src/api/) instead of
 * appending to this one. The shared bits — base URL, headers, error shape —
 * stay in one place; the calls live with their screen.
 */
export async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; body: ApiErrorBody }> {
  /**
   * Who is calling. This was the constant `admin-local`, which is why no
   * go-live request could ever be approved — the two-person rule saw the same
   * identity on both sides. It is now the signed-in person's token, verified
   * by admin-api against the same secret node-api signs with (src/lib/session.ts).
   */
  const headers: Record<string, string> = { ...authHeader() };
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
          "Cannot reach the admin API. Please ensure the backend service is running and accessible.",
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

export type FlowEvent = {
  eventId: string;
  eventType: string;
  occurredAt: string | null;
  publishedAt: string | null;
  published: boolean;
  producer: string | null;
  aggregate: { type: string | null; id: string | null };
  causationId: string | null;
  payload: unknown;
  startedRuns: string[];
  announcedByRun: string | null;
};

export type FlowRun = {
  id: string;
  graphKey: string;
  graphVersion: number | null;
  status: string;
  parked: boolean;
  triggerEventId: string | null;
  threadId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  heartbeatAt: string | null;
  error: unknown;
  announced: string[];
  steps: Array<{
    seq: number;
    node: string;
    tool: string | null;
    status: string;
    latencyMs: number | null;
    at: string | null;
    emitted: string[];
    output: unknown;
  }>;
};

export type Flow = {
  correlationId: string;
  events: FlowEvent[];
  runs: FlowRun[];
  rootEventId: string | null;
  warnings: string[];
  truncated: boolean;
};

/** The whole chain a run belongs to — every event and run in its correlation. */
export function getFlowForRun(runId: string) {
  return request<Flow>(`/runtime/flow/by-run/${encodeURIComponent(runId)}`);
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
  /**
   * Where this workflow is in the lifecycle.
   *
   * `draftCount` cannot answer this: the registry view reports both a numbered
   * compiled build and the unnumbered working copy as "draft", and the next
   * thing to do differs between them.
   */
  lifecycle: {
    hasWorkingCopy: boolean;
    compiledVersion: number | null;
    pendingVersion: number | null;
  };
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
