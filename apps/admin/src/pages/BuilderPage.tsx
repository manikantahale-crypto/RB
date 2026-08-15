import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import {
  createAgent,
  getBuilderOverview,
  listAgents,
  type AgentListItem,
  type BuilderOverview,
} from "../api";
import { PlatformOrchestrationPanel } from "../components/PlatformOrchestrationPanel";
import { PolicyEditorPage } from "./PolicyEditor";
import { friendlyAgentTitle } from "../lib/platform-narrative";
import { agentIngressStatus } from "../lib/agent-status";

function formatWhen(iso: string | undefined | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function BuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentListItem[] | null>(null);
  const [overview, setOverview] = useState<BuilderOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState("");
  const [cloneFromId, setCloneFromId] = useState("");

  const refreshOverview = useCallback(async () => {
    setOverviewLoading(true);
    const res = await getBuilderOverview();
    if (!res.ok) {
      setOverviewError(
        res.status === 0
          ? (res.body.message ?? "Cannot reach admin API")
          : (res.body.message ?? res.body.error ?? `Failed (${res.status})`),
      );
      setOverview(null);
    } else {
      setOverviewError(null);
      setOverview(res.data);
    }
    setOverviewLoading(false);
  }, []);

  async function refreshAgents() {
    const res = await listAgents();
    if (!res.ok) {
      setError(
        res.status === 0
          ? (res.body.message ?? "Cannot reach admin API")
          : (res.body.message ?? res.body.error ?? `Failed (${res.status})`),
      );
      setAgents([]);
      return;
    }
    setError(null);
    setAgents(res.data.agents);
  }

  async function refreshAll() {
    await Promise.all([refreshAgents(), refreshOverview()]);
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  async function onCreate() {
    const name = newName.trim();
    if (!name) {
      setError("Enter a name for the new agent.");
      return;
    }
    setCreating(true);
    setError(null);
    const res = await createAgent({
      name,
      purpose: newPurpose.trim() || undefined,
      cloneFromAgentId: cloneFromId.trim() || undefined,
    });
    setCreating(false);
    if (!res.ok) {
      setError(res.body.message ?? res.body.error ?? "Could not create agent");
      return;
    }
    setShowCreate(false);
    setNewName("");
    setNewPurpose("");
    setCloneFromId("");
    await refreshAll();
    navigate(`/builder/${res.data.id}`);
  }

  return (
    <div className="builder-page-wrap">
      <div className="builder-shell">
        <aside className="builder-sidebar">
          <div className="builder-sidebar-card">
            <div className="builder-sidebar-head">
              <h1>Agents</h1>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setShowCreate(true);
                  setError(null);
                }}
              >
                + Create agent
              </button>
            </div>
            <p className="muted builder-sidebar-hint">
              Pick an agent to edit what it does, build its workflow, and make it
              active on the platform.
            </p>

            {error ? (
              <div className="banner err builder-sidebar-error">{error}</div>
            ) : null}

            {showCreate ? (
              <div className="builder-create">
                <h2 className="builder-create-title">New agent</h2>
                <label className="field">
                  <span className="field-label">Clone from existing agent</span>
                  <select
                    value={cloneFromId}
                    onChange={(e) => setCloneFromId(e.target.value)}
                    disabled={creating}
                  >
                    <option value="">Start from default template</option>
                    {agents?.map((a) => (
                      <option key={a.id} value={a.id}>
                        {friendlyAgentTitle(a.name)}
                      </option>
                    ))}
                  </select>
                  <span className="hint">
                    Copies policy + workflow shape. The original agent stays unchanged.
                  </span>
                </label>
                <label className="field">
                  <span className="field-label">Name</span>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Visa-only matching"
                    disabled={creating}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Purpose (optional)</span>
                  <textarea
                    rows={3}
                    value={newPurpose}
                    onChange={(e) => setNewPurpose(e.target.value)}
                    placeholder="What should this agent do?"
                    disabled={creating}
                  />
                </label>
                <div className="card-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={creating}
                    onClick={() => void onCreate()}
                  >
                    {creating ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={creating}
                    onClick={() => setShowCreate(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {agents === null ? (
              <div className="loading">Loading agents…</div>
            ) : agents.length === 0 ? (
              <p className="muted">No agents yet. Click + Create agent.</p>
            ) : (
              <ul className="builder-agent-list">
                {agents.map((a) => {
                  const selected = a.id === id;
                  const ingress = agentIngressStatus(a);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        className={`builder-agent-item${selected ? " selected" : ""}`}
                        onClick={() => navigate(`/builder/${a.id}`)}
                      >
                        <span className="builder-agent-name">
                          {friendlyAgentTitle(a.name)}
                        </span>
                        <span
                          className={`badge ${ingress.badgeClass}`}
                          title={ingress.detail ?? undefined}
                        >
                          {ingress.label}
                        </span>
                        <span className="builder-agent-meta">
                          {a.lastGenerated
                            ? formatWhen(a.lastGenerated.generatedAt)
                            : "No graph yet"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <main className="builder-main">
          <PlatformOrchestrationPanel
            overview={overview}
            loading={overviewLoading}
            error={overviewError}
            selectedId={id}
            onSelectAgent={(agentId) => navigate(`/builder/${agentId}`)}
          />

          <div className="builder-editor-section">
            {id ? (
              <PolicyEditorPage
                agentId={id}
                embedded
                onAgentUpdated={() => void refreshAll()}
              />
            ) : (
              <div className="builder-select-hint">
                <h2>Edit one agent&apos;s policy</h2>
                <p>
                  Click an agent card above or in the sidebar to open its{" "}
                  <strong>editable Policy box</strong>, then{" "}
                  <strong>Create workflow</strong> and <strong>Make live</strong>.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
