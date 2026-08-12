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
};

export type FieldError = { path: string; message: string };

export type ApiErrorBody = {
  error?: string;
  message?: string;
  fields?: FieldError[];
  currentVersion?: number;
  status?: string;
};

const API_BASE = import.meta.env.VITE_ADMIN_API_URL ?? "/api";

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; body: ApiErrorBody }> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-admin-id": "admin-local",
      ...(init?.headers ?? {}),
    },
  });

  const body = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!res.ok) {
    return { ok: false, status: res.status, body };
  }
  return { ok: true, data: body as T };
}

export function listAgents() {
  return request<{ orgId: string | null; agents: AgentListItem[] }>("/agents");
}

export function getAgent(id: string) {
  return request<AgentDetail>(`/agents/${id}`);
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

export function generateAgent(
  id: string,
  policy: unknown,
  expectedVersion?: number,
) {
  return request<{
    status: string;
    agentId: string;
    agentKey?: string;
    graphKey?: string;
    version: number;
    checksum: string;
    generatedAt: string;
    artifactRef: string;
    definition?: unknown;
  }>(`/agents/${id}/generate`, {
    method: "POST",
    body: JSON.stringify({ policy, expectedVersion }),
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
