import { Link } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import {
  approveGoLive,
  listGoLiveRequests,
} from "../api";

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

function friendlyTitle(raw: string): string {
  let t = raw.trim();
  if (!t) return "Agent";
  t = t.replace(/^SYNTRA\s*[—–-]\s*/i, "");
  t = t.replace(/^matching-agent$/i, "Candidate matching");
  t = t.replace(/^intake-agent$/i, "Intake");
  t = t.replace(/^copilot$/i, "Recruiter assistant");
  t = t.replace(/-agent$/i, "");
  return t.trim() || "Agent";
}

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

/**
 * Technical review queue — Approve runs compile → publish → activate.
 * Business admins only Request; they never see this page's Approve action
 * as their primary path (linked from nav for reviewers).
 */
export function GoLiveRequestsPage() {
  const [requests, setRequests] = useState<GoLiveRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await listGoLiveRequests();
    if (!res.ok) {
      setError(res.body.message ?? res.body.error ?? "Failed to load requests");
      setRequests([]);
      return;
    }
    setError(null);
    setRequests(res.data.requests);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onApprove(row: GoLiveRequest) {
    const ok = window.confirm(
      `Approve go-live for “${friendlyTitle(row.name)}” (v${row.version})?\n\nThis will make that workflow live after safety checks.`,
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
          "Approve failed — production was not changed if the last step failed.",
      );
      await reload();
      return;
    }
    setBanner(res.data.message ?? "Approved — agent is now live.");
    await reload();
  }

  return (
    <section>
      <Link className="back-link" to="/">
        ← Agents
      </Link>

      <div className="page-head">
        <h1>Go-live requests</h1>
        <p>
          Technical backlog of older “request to go live” items. Prefer{" "}
          <strong>Make this live</strong> on the agent page — it runs automatic
          safety checks and goes live without a separate approval step.
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

      {requests === null ? (
        <div className="loading">Loading requests…</div>
      ) : requests.length === 0 ? (
        <div className="empty">No go-live requests waiting.</div>
      ) : (
        <div className="agent-list">
          {requests.map((r) => (
            <article key={`${r.agentId}-${r.version}`} className="agent-card">
              <div className="agent-card-main">
                <h2 className="agent-name">{friendlyTitle(r.name)}</h2>
                <p className="agent-purpose">{r.purpose}</p>
                <div className="agent-meta">
                  <div className="agent-meta-item">
                    <span className="agent-meta-label">Version</span>
                    <span>v{r.version}</span>
                  </div>
                  <div className="agent-meta-item">
                    <span className="agent-meta-label">Requested</span>
                    <span>{formatWhen(r.requestedAt)}</span>
                  </div>
                  <div className="agent-meta-item">
                    <span className="agent-meta-label">By</span>
                    <span>{r.requestedBy || "—"}</span>
                  </div>
                </div>
              </div>
              <div className="agent-card-actions">
                <Link className="btn secondary" to={`/agents/${r.agentId}`}>
                  Open
                </Link>
                <button
                  type="button"
                  className="btn"
                  disabled={busyId === r.agentId}
                  onClick={() => void onApprove(r)}
                >
                  {busyId === r.agentId ? "Approving…" : "Approve & make live"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
