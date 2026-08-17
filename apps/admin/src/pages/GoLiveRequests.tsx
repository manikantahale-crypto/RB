import { Link } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import {
  approveGoLive,
  listAgents,
  listGoLiveRequests,
  type AgentListItem,
} from "../api";
import { filterBuilderAgents } from "../lib/agent-filters";
import { agentIngressStatus } from "../lib/agent-status";
import { friendlyAgentTitle } from "../lib/platform-narrative";

type GoLiveRequest = {
  agentId: string;
  name: string;
  purpose: string;
  version: number;
  status: string;
  requestedAt: string;
  requestedBy: string;
  checksum: string | null;
};

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

export function GoLiveRequestsPage() {
  const [liveAgents, setLiveAgents] = useState<AgentListItem[] | null>(null);
  const [requests, setRequests] = useState<GoLiveRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [agentsRes, reqRes] = await Promise.all([
      listAgents(),
      listGoLiveRequests(),
    ]);

    if (!agentsRes.ok) {
      setError(
        agentsRes.body.message ?? agentsRes.body.error ?? "Failed to load agents",
      );
      setLiveAgents([]);
    } else {
      setError(null);
      const visible = filterBuilderAgents(agentsRes.data.agents);
      setLiveAgents(
        visible.filter((a) => {
          const ingress = agentIngressStatus(a);
          return ingress.label === "Live" || a.policy?.status === "active";
        }),
      );
    }

    if (!reqRes.ok) {
      setRequests([]);
    } else {
      setRequests(reqRes.data.requests);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onApprove(row: GoLiveRequest) {
    const ok = window.confirm(
      `Approve go-live for “${friendlyAgentTitle(row.name)}” (v${row.version})?`,
    );
    if (!ok) return;

    setBusyId(row.agentId);
    setBanner(null);
    const res = await approveGoLive(row.agentId, row.version);
    setBusyId(null);
    if (!res.ok) {
      setBanner(
        res.body.message ??
          res.body.error ??
          "Approve failed — production was not changed.",
      );
      await reload();
      return;
    }
    setBanner(res.data.message ?? "Approved — agent is now live.");
    await reload();
  }

  return (
    <section className="go-live-page">
      <Link className="back-link" to="/builder">
        ← Builder
      </Link>

      <div className="page-head">
        <h1>Go-live</h1>
        <p className="muted">
          Agents that are live on the platform, and any older requests waiting for
          approval.
        </p>
      </div>

      {error ? <div className="banner err">{error}</div> : null}
      {banner ? (
        <div
          className={`banner ${banner.toLowerCase().includes("fail") ? "err" : "ok"}`}
        >
          {banner}
        </div>
      ) : null}

      <h2 className="go-live-section-title">Live agents</h2>
      {liveAgents === null ? (
        <div className="loading">Loading…</div>
      ) : liveAgents.length === 0 ? (
        <p className="muted go-live-empty">
          No agents are live yet. Open an agent in Builder and click{" "}
          <strong>Make it live</strong>.
        </p>
      ) : (
        <ul className="go-live-agent-list">
          {liveAgents.map((a) => {
            const ingress = agentIngressStatus(a);
            return (
              <li key={a.id} className="go-live-agent-card">
                <div>
                  <h3>{friendlyAgentTitle(a.name)}</h3>
                  <p className="muted">{a.purpose}</p>
                  <span className={`badge ${ingress.badgeClass}`}>
                    {ingress.label}
                  </span>
                  {a.binding ? (
                    <p className="go-live-agent-trigger muted">
                      {ingress.detail}
                    </p>
                  ) : null}
                </div>
                <Link className="btn secondary btn--compact" to={`/builder/${a.id}`}>
                  Open in Builder
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="go-live-section-title">Waiting for approval</h2>
      {requests === null ? (
        <div className="loading">Loading…</div>
      ) : requests.length === 0 ? (
        <p className="muted go-live-empty">No requests waiting.</p>
      ) : (
        <ul className="go-live-agent-list">
          {requests.map((r) => (
            <li key={`${r.agentId}-${r.version}`} className="go-live-agent-card">
              <div>
                <h3>{friendlyAgentTitle(r.name)}</h3>
                <p className="muted">{r.purpose}</p>
                <p className="go-live-agent-meta muted">
                  Version {r.version} · requested {formatWhen(r.requestedAt)}
                </p>
              </div>
              <div className="go-live-card-actions">
                <Link
                  className="btn secondary btn--compact"
                  to={`/builder/${r.agentId}`}
                >
                  Open
                </Link>
                <button
                  type="button"
                  className="btn btn--compact"
                  disabled={busyId === r.agentId}
                  onClick={() => void onApprove(r)}
                >
                  {busyId === r.agentId ? "Approving…" : "Approve"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
