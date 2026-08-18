import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createAgent,
  deleteAgent,
  getBuilderOverview,
  listAgents,
  type AgentListItem,
  type BuilderOverview,
} from "../api";
import { AgentSummaryBar } from "../components/AgentSummaryBar";
import { PlatformPoliciesModal } from "../components/PlatformPoliciesModal";
import { PolicyEditorPage } from "./PolicyEditor";
import { filterBuilderAgents, canDeleteAgentFromBuilder } from "../lib/agent-filters";
import { friendlyAgentTitle } from "../lib/platform-narrative";
import { agentIngressStatus } from "../lib/agent-status";

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
  const [showAllPolicies, setShowAllPolicies] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState("");
  const [cloneFromId, setCloneFromId] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      setOverview({
        ...res.data,
        agents: filterBuilderAgents(res.data.agents),
      });
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
    setAgents(filterBuilderAgents(res.data.agents));
  }

  async function refreshAll() {
    await Promise.all([refreshAgents(), refreshOverview()]);
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  const selectedAgent = useMemo(
    () => overview?.agents.find((a) => a.id === id) ?? null,
    [overview, id],
  );

  useEffect(() => {
    if (!id || agents === null) return;
    if (!agents.some((a) => a.id === id)) {
      navigate("/builder", { replace: true });
    }
  }, [id, agents, navigate]);

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

  function onAgentDeleted() {
    void refreshAll();
    navigate("/builder");
  }

  async function onDeleteFromSidebar(agentId: string, agentName: string) {
    if (
      !window.confirm(
        `Delete "${friendlyAgentTitle(agentName)}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeletingId(agentId);
    const res = await deleteAgent(agentId);
    setDeletingId(null);
    if (!res.ok) {
      setError(res.body.message ?? res.body.error ?? "Delete failed");
      return;
    }
    if (id === agentId) {
      navigate("/builder");
    }
    await refreshAll();
  }

  return (
    <div className="builder-page-wrap">
      <div className="builder-shell">
        <aside className="builder-sidebar">
          <div className="builder-sidebar-card">
            <div className="builder-sidebar-head">
              <h1>Agents</h1>
              <div className="builder-sidebar-actions">
                <button
                  type="button"
                  className="btn secondary btn--compact"
                  onClick={() => setShowAllPolicies(true)}
                >
                  All policies
                </button>
                <button
                  type="button"
                  className="btn btn--compact"
                  onClick={() => {
                    setShowCreate(true);
                    setError(null);
                  }}
                >
                  + Create
                </button>
              </div>
            </div>

            {error ? (
              <div className="banner err builder-sidebar-error">{error}</div>
            ) : null}

            {showCreate ? (
              <div className="builder-create">
                <h2 className="builder-create-title">New agent</h2>
                <label className="field">
                  <span className="field-label">Copy from</span>
                  <select
                    value={cloneFromId}
                    onChange={(e) => setCloneFromId(e.target.value)}
                    disabled={creating}
                  >
                    <option value="">Default template</option>
                    {agents?.map((a) => (
                      <option key={a.id} value={a.id}>
                        {friendlyAgentTitle(a.name)}
                      </option>
                    ))}
                  </select>
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
                  <span className="field-label">What should it do?</span>
                  <textarea
                    rows={2}
                    value={newPurpose}
                    onChange={(e) => setNewPurpose(e.target.value)}
                    placeholder="Short description"
                    disabled={creating}
                  />
                </label>
                <div className="card-actions">
                  <button
                    type="button"
                    className="btn btn--compact"
                    disabled={creating}
                    onClick={() => void onCreate()}
                  >
                    {creating ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    className="btn secondary btn--compact"
                    disabled={creating}
                    onClick={() => setShowCreate(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {agents === null ? (
              <div className="loading">Loading…</div>
            ) : agents.length === 0 ? (
              <p className="muted">No agents yet.</p>
            ) : (
              <ul className="builder-agent-list">
                {agents.map((a) => {
                  const selected = a.id === id;
                  const ingress = agentIngressStatus(a);
                  const deletable = canDeleteAgentFromBuilder(a.id);
                  return (
                    <li key={a.id} className="builder-agent-row">
                      <button
                        type="button"
                        className={`builder-agent-item${selected ? " selected" : ""}`}
                        onClick={() => navigate(`/builder/${a.id}`)}
                      >
                        <span className="builder-agent-name">
                          {friendlyAgentTitle(a.name)}
                        </span>
                        <span className={`badge ${ingress.badgeClass}`}>
                          {ingress.label}
                        </span>
                      </button>
                      {deletable ? (
                        <button
                          type="button"
                          className="builder-agent-delete"
                          title="Delete agent"
                          disabled={deletingId === a.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void onDeleteFromSidebar(a.id, a.name);
                          }}
                        >
                          {deletingId === a.id ? "…" : "×"}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <main className="builder-main">
          {overviewError ? (
            <div className="banner err">{overviewError}</div>
          ) : null}

          {id && selectedAgent && !overviewLoading ? (
            <AgentSummaryBar
              agent={selectedAgent}
              onDeleted={onAgentDeleted}
            />
          ) : id && overviewLoading ? (
            <div className="loading">Loading…</div>
          ) : !id ? (
            <div className="builder-select-hint">
              <h2>Select an agent</h2>
              <p className="muted">
                Pick an agent from the list, or create a new one.
              </p>
            </div>
          ) : id && !overviewLoading && !selectedAgent ? (
            <div className="banner warn builder-missing-agent">
              Could not load this agent.{" "}
              <button
                type="button"
                className="btn secondary btn--compact"
                onClick={() => navigate("/builder")}
              >
                Back to list
              </button>
            </div>
          ) : null}

          {id ? (
            <PolicyEditorPage
              agentId={id}
              embedded
              onAgentUpdated={() => void refreshAll()}
            />
          ) : null}
        </main>
      </div>

      {showAllPolicies && overview ? (
        <PlatformPoliciesModal
          agents={overview.agents}
          onClose={() => setShowAllPolicies(false)}
        />
      ) : null}
    </div>
  );
}
