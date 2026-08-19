import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getBuilderOverview,
  getRuntimeOverview,
  getRuntimeTrace,
  type BuilderOverview,
} from "../api";
import {
  detectHandoff,
  friendlyAgentRole,
  friendlyEventLabel,
  friendlyToolTitle,
} from "../lib/friendly-labels";

type RuntimeOverview = {
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
};

/**
 * BenchSales ops home — plain-language map of agents, live bindings,
 * run counts, and ASTRA → SYNTRA handoffs.
 */
export function BenchSalesOverviewPage() {
  const [overview, setOverview] = useState<BuilderOverview | null>(null);
  const [runtime, setRuntime] = useState<RuntimeOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [traceNote, setTraceNote] = useState<string | null>(null);

  async function load() {
    setError(null);
    const [b, r] = await Promise.all([
      getBuilderOverview(),
      getRuntimeOverview(),
    ]);
    if (!b.ok) {
      setError(b.body.message ?? "Builder overview failed");
      return;
    }
    setOverview(b.data);
    if (r.ok) setRuntime(r.data);
    else
      setError(
        r.body.message ??
          "Runtime overview failed — is orch.runs available?",
      );
  }

  useEffect(() => {
    void load();
  }, []);

  async function peekRun(eventId: string | null | undefined) {
    if (!eventId) return;
    setSelectedEvent(eventId);
    setTraceNote(null);
    const t = await getRuntimeTrace(String(eventId));
    if (!t.ok) {
      setTraceNote(t.body.message ?? "Trace failed");
      return;
    }
    const types = (t.data.outbox ?? []).map((e) => String(e.event_type));
    const h = detectHandoff(types);
    const steps = (t.data.steps ?? [])
      .map(
        (s) =>
          `${friendlyToolTitle(String(s.tool_name ?? s.node))} (${s.status})`,
      )
      .join(" → ");
    setTraceNote(
      [
        h.astraWorked ? "ASTRA ran" : "ASTRA did not run",
        h.calledSyntra
          ? "then called SYNTRA (ready for matching)"
          : h.rejected
            ? "ASTRA rejected — SYNTRA not called"
            : h.humanAsked
              ? "waiting on human review"
              : "SYNTRA bridge not seen yet",
        steps ? `Steps: ${steps}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }

  const stats = runtime?.stats;
  const handoffs = stats?.handoffs14d ?? {};

  return (
    <div className="page benchsales-ops">
      <header className="page-head">
        <div>
          <h1>BenchSales flow</h1>
          <p className="muted">
            See which agents are live, how many runs happened, and whether ASTRA
            handed work to SYNTRA. Open an agent to update workflow steps; Make
            live connects them to the orchestrator.
          </p>
        </div>
        <button type="button" className="btn secondary" onClick={() => void load()}>
          Refresh
        </button>
      </header>

      {error ? <p className="error-banner">{error}</p> : null}

      <section className="ops-stats">
        <div className="ops-stat">
          <span className="ops-stat-n">{stats?.runsTotal ?? "—"}</span>
          <span className="ops-stat-l">Orchestrator runs</span>
        </div>
        <div className="ops-stat">
          <span className="ops-stat-n">{stats?.graphsGenerated ?? "—"}</span>
          <span className="ops-stat-l">Graphs generated</span>
        </div>
        <div className="ops-stat">
          <span className="ops-stat-n">{stats?.graphsActive ?? "—"}</span>
          <span className="ops-stat-l">Active graphs</span>
        </div>
        <div className="ops-stat">
          <span className="ops-stat-n">{handoffs.bridge_to_syntra ?? 0}</span>
          <span className="ops-stat-l">ASTRA → SYNTRA (14d)</span>
        </div>
        <div className="ops-stat">
          <span className="ops-stat-n">{handoffs.astra_rejected ?? 0}</span>
          <span className="ops-stat-l">ASTRA rejected (14d)</span>
        </div>
        <div className="ops-stat">
          <span className="ops-stat-n">{handoffs.human_gates ?? 0}</span>
          <span className="ops-stat-l">Human reviews (14d)</span>
        </div>
      </section>

      <section className="card-block">
        <h2>How the orchestrator plays a go-live agent</h2>
        <ol className="ops-howto">
          <li>You describe policy and generate (or edit) workflow steps.</li>
          <li>
            <strong>Make live / Activate</strong> saves the graph and writes a
            binding: which event starts which graph version.
          </li>
          <li>
            When that event arrives (upload, email, etc.), the orch worker runs
            those tools in order.
          </li>
          <li>
            ASTRA’s last step can emit ready-for-matching — that event is bound
            to SYNTRA, so matching tools run next.
          </li>
        </ol>
        {runtime?.howOrchPicksUp ? (
          <p className="muted ops-howto-tech">{runtime.howOrchPicksUp}</p>
        ) : null}
      </section>

      <section className="card-block">
        <h2>Live event → agent map</h2>
        <p className="muted">
          These bindings are what the orchestrator uses after go-live.
        </p>
        <table className="data-table">
          <thead>
            <tr>
              <th>When this happens</th>
              <th>Workflow that runs</th>
              <th>Version</th>
            </tr>
          </thead>
          <tbody>
            {(runtime?.liveBindings ?? []).map((b) => (
              <tr key={`${b.event_type}-${b.graph_key}-${b.version}`}>
                <td>{friendlyEventLabel(b.event_type)}</td>
                <td>
                  <code>{b.graph_key}</code>
                </td>
                <td>v{b.version}</td>
              </tr>
            ))}
            {(runtime?.liveBindings ?? []).length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  No live bindings yet — open an agent and Make live.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="card-block">
        <h2>Agents</h2>
        <div className="ops-agent-grid">
          {(overview?.agents ?? []).map((a) => (
            <Link
              key={a.id}
              to={`/agents/${a.id}`}
              className="ops-agent-card"
            >
              <div className="ops-agent-card-top">
                <strong>{a.name}</strong>
                <span className="muted">{friendlyAgentRole(a.agentKey)}</span>
              </div>
              <p className="ops-agent-status">
                {a.binding
                  ? `Live — ${friendlyEventLabel(a.binding.eventType)}`
                  : a.workflowEmpty
                    ? "No workflow yet"
                    : "Workflow saved — not live"}
              </p>
              {!a.workflowEmpty && a.workflowSteps.length > 0 ? (
                <ol className="ops-agent-steps">
                  {a.workflowSteps.slice(0, 5).map((s) => (
                    <li key={s.order}>
                      {friendlyToolTitle(s.impl || s.label)}
                    </li>
                  ))}
                </ol>
              ) : null}
              <span className="ops-agent-cta">Open · edit steps · Make live →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card-block">
        <div className="row-actions">
          <h2 style={{ flex: 1 }}>Recent orchestrator runs</h2>
          <Link to="/runs" className="btn secondary btn--compact">
            Full run inspector
          </Link>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Graph</th>
              <th>Status</th>
              <th>Trigger event</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(runtime?.recentRuns ?? []).map((r) => (
              <tr key={String(r.id)}>
                <td className="muted">
                  {r.created_at
                    ? new Date(String(r.created_at)).toLocaleString()
                    : "—"}
                </td>
                <td>
                  <code>{String(r.graph_key ?? "")}</code>
                </td>
                <td>{String(r.status)}</td>
                <td className="mono-sm">{String(r.trigger_event_id ?? "")}</td>
                <td>
                  <button
                    type="button"
                    className="btn secondary btn--compact"
                    onClick={() =>
                      void peekRun(
                        r.trigger_event_id
                          ? String(r.trigger_event_id)
                          : null,
                      )
                    }
                  >
                    See handoff
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {selectedEvent ? (
          <div className="ops-peek">
            <p>
              <strong>Event</strong> <code>{selectedEvent}</code>{" "}
              <Link to={`/runs?event=${selectedEvent}`}>Open in Runs →</Link>
            </p>
            {traceNote ? <p>{traceNote}</p> : null}
          </div>
        ) : null}
      </section>

      <section className="card-block">
        <h2>Runs by graph (audit)</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Graph</th>
              <th>Runs</th>
              <th>Last run</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.runsByGraph ?? []).map((g) => (
              <tr key={g.graph_key}>
                <td>
                  <code>{g.graph_key}</code>
                </td>
                <td>{g.n}</td>
                <td className="muted">
                  {g.last_run_at
                    ? new Date(g.last_run_at).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
