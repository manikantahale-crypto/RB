import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { listAgents, type AgentListItem } from "../api";

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
  const [agents, setAgents] = useState<AgentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section>
      <div className="page-head">
        <h1>Agents</h1>
        <p>
          Describe what each agent should do, then make it live when you’re ready.
        </p>
      </div>

      {error ? <div className="banner err">{error}</div> : null}

      {agents === null ? (
        <div className="loading">Loading agents…</div>
      ) : agents.length === 0 ? (
        <div className="empty">No agents found.</div>
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
                  {a.canEdit ? "Open" : "View"}
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
