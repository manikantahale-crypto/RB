import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { createAgent, listAgents, type AgentListItem } from "../api";

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

function friendlyListStatus(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "generated":
    case "compiled":
    case "published":
    case "pending_go_live":
      return "Ready to make live";
    case "active":
      return "Live";
    default:
      return status;
  }
}

function friendlyAgentTitle(raw: string): string {
  let t = raw.trim();
  if (!t) return "Agent";
  t = t.replace(/^SYNTRA\s*[—–-]\s*/i, "");
  t = t.replace(/^matching-agent$/i, "Candidate matching");
  t = t.replace(/^intake-agent$/i, "Intake");
  t = t.replace(/^copilot$/i, "Recruiter assistant");
  t = t.replace(/-agent$/i, "");
  return t.trim() || "Agent";
}

function statusBadgeClass(status: string): string {
  if (status === "generated" || status === "compiled" || status === "published") {
    return "generated";
  }
  if (status === "pending_go_live") return "published";
  if (status === "active") return "active";
  return "";
}

export function AgentListPage() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState("");

  async function refresh() {
    const res = await listAgents();
    if (!res.ok) {
      setError(res.body.message ?? res.body.error ?? `Failed (${res.status})`);
      setAgents([]);
      return;
    }
    setError(null);
    setAgents(res.data.agents);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listAgents();
      if (cancelled) return;
      if (!res.ok) {
        setError(res.body.message ?? res.body.error ?? `Failed (${res.status})`);
        setAgents([]);
        return;
      }
      setAgents(res.data.agents);
    })();
    return () => {
      cancelled = true;
    };
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
    });
    setCreating(false);
    if (!res.ok) {
      setError(res.body.message ?? res.body.error ?? "Could not create agent");
      return;
    }
    setShowCreate(false);
    setNewName("");
    setNewPurpose("");
    navigate(`/agents/${res.data.id}`);
  }

  return (
    <section>
      <div className="page-head page-head--row">
        <div>
          <h1>Agent Builder</h1>
          <p>
            Create a new agent or open an existing one. Describe what it should do,
            create a workflow, then make it live so uploads use that agent.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setShowCreate(true);
            setError(null);
          }}
        >
          + Create Agent
        </button>
      </div>

      {error ? <div className="banner err">{error}</div> : null}

      {showCreate ? (
        <div className="section-card create-card">
          <h2>New agent</h2>
          <p className="muted">
            Creates a brand-new agent id (version 1 draft). Does not change any
            live agent.
          </p>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. JD intake for Client X"
              disabled={creating}
            />
          </label>
          <label className="field">
            <span className="field-label">Purpose (optional)</span>
            <input
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
              {creating ? "Creating…" : "Create & open builder"}
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
        <div className="empty">
          No agents yet. Click <strong>+ Create Agent</strong> to start.
        </div>
      ) : (
        <div className="agent-list">
          {agents.map((a) => (
            <article key={a.id} className="agent-card">
              <div className="agent-card-main">
                <h2 className="agent-name">{friendlyAgentTitle(a.name)}</h2>
                <p className="agent-purpose">{a.purpose}</p>
                <div className="agent-meta">
                  <div className="agent-meta-item">
                    <span className="agent-meta-label">Status</span>
                    {a.policy ? (
                      <span
                        className={`badge ${statusBadgeClass(a.policy.status)}`}
                      >
                        {friendlyListStatus(a.policy.status)}
                        {a.policy.version != null
                          ? ` · v${a.policy.version}`
                          : ""}
                      </span>
                    ) : (
                      <span className="muted">Not set up</span>
                    )}
                  </div>
                  <div className="agent-meta-item">
                    <span className="agent-meta-label">Live version</span>
                    {a.activeVersion != null ? (
                      <span className="badge active">v{a.activeVersion}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>
                  <div className="agent-meta-item">
                    <span className="agent-meta-label">Last saved</span>
                    <span>
                      {a.lastGenerated
                        ? formatWhen(a.lastGenerated.generatedAt)
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="agent-card-actions">
                <Link className="btn" to={`/agents/${a.id}`}>
                  {a.canEdit ? "Open builder" : "View"}
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      {agents && agents.length > 0 ? (
        <p className="muted" style={{ marginTop: "1rem" }}>
          <button type="button" className="btn secondary" onClick={() => void refresh()}>
            Refresh list
          </button>
        </p>
      ) : null}
    </section>
  );
}
