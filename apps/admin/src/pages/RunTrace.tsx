import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  getRuntimeRunSteps,
  getRuntimeTrace,
  listRuntimeRuns,
  resumeRuntimeThread,
} from "../api";
import {
  detectHandoff,
  friendlyEventLabel,
  friendlyToolTitle,
} from "../lib/friendly-labels";

/**
 * Multi-agent run inspector — plain-language ASTRA → SYNTRA audit.
 */
export function RunTracePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [eventId, setEventId] = useState(searchParams.get("event") ?? "");
  const [runs, setRuns] = useState<Array<Record<string, unknown>>>([]);
  const [trace, setTrace] = useState<{
    outbox: Array<Record<string, unknown>>;
    runs: Array<Record<string, unknown>>;
    steps: Array<Record<string, unknown>>;
  } | null>(null);
  const [selectedSteps, setSelectedSteps] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resumeNote, setResumeNote] = useState<string | null>(null);

  const handoff = useMemo(() => {
    if (!trace) return null;
    const types = trace.outbox.map((e) => String(e.event_type));
    return detectHandoff(types);
  }, [trace]);

  async function refreshRuns() {
    const res = await listRuntimeRuns(30);
    if (res.ok) setRuns(res.data.runs);
    else setError(res.body.message ?? res.body.error ?? "Failed to load runs");
  }

  useEffect(() => {
    void refreshRuns();
  }, []);

  useEffect(() => {
    const fromUrl = searchParams.get("event");
    if (!fromUrl || fromUrl === eventId) return;
    setEventId(fromUrl);
    void lookupTrace(fromUrl);
    // Intentional: re-load when Ops links here with ?event=
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function lookupTrace(idOverride?: string) {
    setError(null);
    setTrace(null);
    setSelectedSteps([]);
    const id = (idOverride ?? eventId).trim();
    if (!id) {
      setError("Paste a trigger event id (UUID) from an orchestrator run");
      return;
    }
    setBusy(true);
    const res = await getRuntimeTrace(id);
    setBusy(false);
    if (!res.ok) {
      setError(res.body.message ?? res.body.error ?? "Trace failed");
      return;
    }
    setEventId(id);
    setSearchParams({ event: id }, { replace: true });
    setTrace({
      outbox: res.data.outbox,
      runs: res.data.runs,
      steps: res.data.steps,
    });
  }

  async function openRunSteps(runId: string) {
    setBusy(true);
    const res = await getRuntimeRunSteps(runId);
    setBusy(false);
    if (!res.ok) {
      setError(res.body.message ?? "Steps unavailable");
      return;
    }
    setSelectedSteps(res.data.steps);
  }

  async function resume(run: Record<string, unknown>, approved: boolean) {
    setResumeNote(null);
    setError(null);
    const threadId = String(
      run.langgraph_thread_id ?? run.thread_id ?? "",
    );
    const graphKey = String(run.graph_key ?? "");
    const orgId = String(run.organization_id ?? "");
    if (!threadId || !graphKey || !orgId) {
      setError(
        "Run is missing thread / graph / organization — cannot resume",
      );
      return;
    }
    setBusy(true);
    const res = await resumeRuntimeThread({
      thread_id: threadId,
      graph_key: graphKey,
      organization_id: orgId,
      graph_version:
        typeof run.graph_version === "number" ? run.graph_version : undefined,
      decision: { approved },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.body.message ?? res.body.error ?? "Resume failed");
      return;
    }
    setResumeNote(
      `Human review ${approved ? "approved" : "rejected"} — run will continue`,
    );
    await refreshRuns();
    if (eventId) await lookupTrace(eventId);
  }

  return (
    <div className="page run-trace-page">
      <header className="page-head">
        <div>
          <h1>Run audit</h1>
          <p className="muted">
            See what the orchestrator did for each event: which graph version
            ran, step outputs, and whether ASTRA called SYNTRA.{" "}
            <Link to="/ops">← BenchSales overview</Link>
          </p>
        </div>
      </header>

      <section className="card-block">
        <h2>Lookup by trigger event</h2>
        <div className="row-actions">
          <input
            className="input"
            style={{ flex: 1, minWidth: 280 }}
            placeholder="event id (UUID)"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          />
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void lookupTrace()}
          >
            Load trace
          </button>
        </div>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}
      {resumeNote ? <p className="ok-banner">{resumeNote}</p> : null}

      {trace && handoff ? (
        <section
          className={`ops-handoff-banner${
            handoff.calledSyntra
              ? " ops-handoff-banner--ok"
              : handoff.rejected
                ? " ops-handoff-banner--warn"
                : ""
          }`}
        >
          <strong>
            {handoff.calledSyntra
              ? "ASTRA finished and called SYNTRA"
              : handoff.rejected
                ? "ASTRA rejected — SYNTRA was not called"
                : handoff.humanAsked
                  ? "Waiting on a person (human review)"
                  : handoff.astraWorked
                    ? "ASTRA ran — SYNTRA bridge not seen yet"
                    : "No ASTRA / SYNTRA handoff events in this outbox"}
          </strong>
          <p className="muted" style={{ margin: "0.35rem 0 0" }}>
            {trace.runs.length} graph run(s) · {trace.steps.length} step(s) ·{" "}
            {trace.outbox.length} event(s)
          </p>
        </section>
      ) : null}

      {trace ? (
        <section className="card-block">
          <h2>What happened</h2>
          <h3>Events produced</h3>
          <ul className="trace-list">
            {trace.outbox.map((e) => (
              <li key={String(e.event_id)}>
                <strong>{friendlyEventLabel(String(e.event_type))}</strong>{" "}
                <span className="muted mono-sm">
                  {String(e.event_type)} · {String(e.event_id)}
                </span>
              </li>
            ))}
          </ul>
          <h3>Graph versions that ran</h3>
          <ul className="trace-list">
            {trace.runs.map((r) => (
              <li key={String(r.id)}>
                <strong>
                  {String(r.graph_key)} · v{String(r.graph_version ?? "?")}
                </strong>{" "}
                — {String(r.status)}{" "}
                <button
                  type="button"
                  className="btn secondary btn--compact"
                  onClick={() => void openRunSteps(String(r.id))}
                >
                  Step outputs
                </button>
                {String(r.status).includes("INTERRUPT") ||
                String(r.status) === "PAUSED" ||
                r.langgraph_thread_id ? (
                  <>
                    <button
                      type="button"
                      className="btn primary btn--compact"
                      onClick={() => void resume(r, true)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn secondary btn--compact"
                      onClick={() => void resume(r, false)}
                    >
                      Reject
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <h3>All steps (audit)</h3>
          <StepsTable steps={trace.steps} />
        </section>
      ) : null}

      {selectedSteps.length > 0 ? (
        <section className="card-block">
          <h2>Selected run — step outputs</h2>
          <StepsTable steps={selectedSteps} />
        </section>
      ) : null}

      <section className="card-block">
        <div className="row-actions">
          <h2 style={{ flex: 1 }}>Recent orchestrator runs</h2>
          <button
            type="button"
            className="btn secondary btn--compact"
            onClick={() => void refreshRuns()}
          >
            Refresh
          </button>
        </div>
        <ul className="trace-list">
          {runs.map((r) => (
            <li key={String(r.id)}>
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  const tid = String(r.trigger_event_id ?? "");
                  if (tid) {
                    setEventId(tid);
                    void lookupTrace(tid);
                  } else {
                    void openRunSteps(String(r.id));
                  }
                }}
              >
                {String(r.graph_key)} · v{String(r.graph_version ?? "?")} ·{" "}
                {String(r.status)}
              </button>
              <span className="muted">
                {" "}
                · {String(r.trigger_event_id ?? r.id)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function branchPlain(key: unknown): string {
  const k = String(key ?? "");
  if (k === "pass") return "good enough → continue";
  if (k === "human_review") return "ask a person";
  if (k === "reject") return "stop / reject";
  return k || "—";
}

function StepsTable({ steps }: { steps: Array<Record<string, unknown>> }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>What ran</th>
          <th>Status</th>
          <th>ms</th>
          <th>Decision / output</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s) => {
          const out =
            typeof s.output_ref === "object" && s.output_ref
              ? (s.output_ref as Record<string, unknown>)
              : {};
          const tool = String(s.tool_name ?? s.node ?? "");
          const branch = out.branch_key ?? out.result ?? "";
          return (
            <tr key={String(s.id)}>
              <td>{String(s.seq)}</td>
              <td>
                <strong>{friendlyToolTitle(tool)}</strong>
                <div className="muted mono-sm">{tool}</div>
              </td>
              <td>{String(s.status)}</td>
              <td>{s.latency_ms != null ? String(s.latency_ms) : "—"}</td>
              <td>
                {branch ? branchPlain(branch) : "—"}
                {out.confidence_score != null ? (
                  <span className="muted">
                    {" "}
                    · score {String(out.confidence_score)}
                  </span>
                ) : null}
                {Array.isArray(out.emitted) && out.emitted.length > 0 ? (
                  <div className="muted mono-sm">
                    emitted:{" "}
                    {(out.emitted as string[])
                      .map((t) => friendlyEventLabel(t))
                      .join(", ")}
                  </div>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
