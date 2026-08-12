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

function statusBadgeClass(status: string): string {
  if (status === "generated") return "generated";
  if (status === "active") return "active";
  if (status === "published") return "published";
  if (status === "compiled") return "compiled";
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
          Configure policy, generate a graph, then compile and publish. Active
          is the authored one-active version — not production traffic.
        </p>
      </div>

      {error ? <div className="banner err">{error}</div> : null}

      {agents === null ? (
        <div className="loading">Loading agents…</div>
      ) : agents.length === 0 ? (
        <div className="empty">No active agents found.</div>
      ) : (
        <div className="agent-list">
          {agents.map((a) => (
            <article key={a.id} className="agent-card">
              <div className="agent-card-main">
                <h2 className="agent-name">{a.name}</h2>
                <p className="agent-purpose">{a.purpose}</p>
                <div className="agent-meta">
                  <div className="agent-meta-item">
                    <span className="agent-meta-label">Status</span>
                    {a.policy ? (
                      <span
                        className={`badge ${statusBadgeClass(a.policy.status)}`}
                      >
                        {a.policy.status}
                        {a.policy.version != null
                          ? ` · v${a.policy.version}`
                          : ""}
                      </span>
                    ) : (
                      <span className="muted">no policy</span>
                    )}
                  </div>
                  <div className="agent-meta-item">
                    <span className="agent-meta-label">Active</span>
                    {a.activeVersion != null ? (
                      <span className="badge active">v{a.activeVersion}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>
                  <div className="agent-meta-item">
                    <span className="agent-meta-label">Last gen</span>
                    <span>
                      {a.lastGenerated
                        ? `v${a.lastGenerated.version} · ${formatWhen(a.lastGenerated.generatedAt)}`
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="agent-card-actions">
                {a.canEdit ? (
                  <Link className="btn" to={`/agents/${a.id}`}>
                    Open editor
                  </Link>
                ) : (
                  <span className="muted">view only</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
