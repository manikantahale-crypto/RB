/**
 * Screen 12 — every run of one workflow.
 *
 * Reached from the registry's health cell, and bookmarkable on its own, which
 * is how on-call will actually reach it.
 *
 * Three things the deck is specific about, and why they are built this way:
 *
 *   WAITING IS NOT A FAILURE. It gets its own colour, well away from red. A
 *   run parked at a human gate for three days is the system working exactly as
 *   designed, and colouring it like an error teaches people to ignore errors.
 *
 *   THE TRIGGER EVENT IS A COLUMN, not a detail. One workflow can be started
 *   by several different events, and "which door fired" is usually the first
 *   question when one run behaves differently from its neighbours.
 *
 *   THE PINNED VERSION IS A COLUMN. Two versions running side by side is
 *   normal, not a problem — v2 runs finish as v2 after v3 ships. Older runs
 *   show "unknown" rather than a guess: the version they executed was not
 *   recorded at the time and is genuinely unrecoverable.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { listWorkflowRuns, type WorkflowRun } from "../api";
import { WorkflowOutlinePanel } from "./workflow-outline-panel";

/** Terminal states first — the ones people filter to most. */
const STATUS_ORDER = [
  "COMPLETED",
  "FAILED",
  "RUNNING",
  "PARKED",
  "CANCELLED",
];

/** PARKED is the word; WAITING_APPROVAL is what runs said before V20260909.72. */
const isParked = (status: string) => status === "PARKED" || status === "WAITING_APPROVAL";

function statusClass(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "run-status run-status--ok";
    case "FAILED":
      return "run-status run-status--failed";
    case "PARKED":
    case "WAITING_APPROVAL":
      return "run-status run-status--waiting";
    case "CANCELLED":
      return "run-status run-status--cancelled";
    default:
      return "run-status run-status--running";
  }
}

function statusLabel(status: string): string {
  if (isParked(status)) return "Waiting on a person";
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString();
}

export function WorkflowRunsPage() {
  const { graphKey = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "all";
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [runs, setRuns] = useState<WorkflowRun[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!graphKey) return;
    setFetching(true);
    setError(null);
    const res = await listWorkflowRuns(graphKey, {
      status: statusFilter,
      q: searchParams.get("q") ?? undefined,
    });
    if (res.ok) {
      setRuns(res.data.runs);
      setCounts(res.data.counts);
      setTotal(res.data.total);
      setLastLoadedAt(new Date());
    } else {
      setError(res.body.message ?? res.body.error ?? "Could not load runs");
    }
    setFetching(false);
  }, [graphKey, statusFilter, searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = (status: string) => {
    const next = new URLSearchParams(searchParams);
    if (status === "all") next.delete("status");
    else next.set("status", status);
    setSearchParams(next, { replace: true });
  };

  const applySearch = () => {
    const next = new URLSearchParams(searchParams);
    if (query.trim()) next.set("q", query.trim());
    else next.delete("q");
    setSearchParams(next, { replace: true });
  };

  const statuses = useMemo(() => {
    const present = Object.keys(counts);
    const ordered = STATUS_ORDER.filter((s) => present.includes(s));
    const extra = present.filter((s) => !STATUS_ORDER.includes(s)).sort();
    return [...ordered, ...extra];
  }, [counts]);

  return (
    <div className="wf-registry" data-testid="workflow-runs">
      <header className="wf-registry-head">
        <div>
          <Link to="/workflows" className="run-back">
            ← All workflows
          </Link>
          <h1 className="wf-registry-title">{graphKey}</h1>
          <p className="wf-registry-sub">
            {total} run{total === 1 ? "" : "s"} recorded. Newest first.
          </p>
        </div>
      </header>

      {/*
        What the workflow IS, above the list of times it ran.

        Somebody arriving here from a search needs to know whether this is the
        workflow they meant before any of these runs are worth reading, and
        until now the only way to find out was to open a run — which answers a
        different question, at much greater length.
      */}
      <WorkflowOutlinePanel graphKey={graphKey} />

      <div className="wf-controls">
        <button
          type="button"
          className={
            statusFilter === "all" ? "run-chip run-chip--on" : "run-chip"
          }
          onClick={() => setStatus("all")}
        >
          All {total}
        </button>
        {statuses.map((s) => (
          <button
            key={s}
            type="button"
            className={
              statusFilter === s ? "run-chip run-chip--on" : "run-chip"
            }
            onClick={() => setStatus(s)}
          >
            {statusLabel(s)} {counts[s]}
          </button>
        ))}
        <input
          className="wf-search"
          placeholder="Run id, trigger event, or correlation id…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applySearch();
          }}
          onBlur={applySearch}
          aria-label="Search runs"
        />
        <button
          type="button"
          className="wf-btn"
          onClick={() => void load()}
          disabled={fetching}
          data-testid="runs-refresh"
        >
          {fetching ? "Refreshing…" : "Refresh"}
        </button>
        {lastLoadedAt ? (
          <span className="wf-updated">
            updated {lastLoadedAt.toLocaleTimeString()}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="wf-error" role="alert">
          {error}
          {String(error).includes("graph_version") ? (
            <>
              {" "}
              — the run table has no version column yet. Start the worker once,
              or run:{" "}
              <code>
                ALTER TABLE orch.runs ADD COLUMN IF NOT EXISTS graph_version int;
              </code>
            </>
          ) : null}
        </div>
      ) : null}

      {runs === null && !error ? <p className="wf-empty">Loading runs…</p> : null}
      {runs !== null && runs.length === 0 ? (
        <p className="wf-empty">
          No runs match. {statusFilter !== "all" ? "Try All." : ""}
        </p>
      ) : null}

      {runs && runs.length > 0 ? (
        <div className="wf-table-wrap">
          <table className="wf-table">
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Started by</th>
                <th scope="col">Version</th>
                <th scope="col">Status</th>
                <th scope="col">Steps</th>
                <th scope="col">Took</th>
                <th scope="col">When</th>
                <th scope="col"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                  <tr
                    key={run.runId}
                    className="wf-row wf-row--clickable"
                    data-testid="run-row"
                    onClick={(e) => {
                      // The whole row is a target for convenience, but the
                      // anchors stay real so middle-click, keyboard and
                      // open-in-new-tab all still work.
                      if ((e.target as HTMLElement).closest("a")) return;
                      navigate(`/runs/${run.runId}`);
                    }}
                  >
                    <td>
                      {/* Row into screen 13 — the deck's feedback loop. */}
                      <Link className="run-id-link" to={`/runs/${run.runId}`} title={run.runId}>
                        <span className="run-id">{run.runId.slice(0, 8)}</span>
                      </Link>
                      {run.correlationId ? (
                        <span className="wf-health-sub">
                          corr {run.correlationId.slice(0, 8)}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {run.triggerEvent ? (
                        <span className="wf-trigger">{run.triggerEvent}</span>
                      ) : (
                        <span className="wf-muted">—</span>
                      )}
                    </td>
                    <td>
                      {run.pinnedVersion != null ? (
                        <span
                          className={
                            run.versionSource === "inferred"
                              ? "wf-version-chip wf-version-chip--inferred"
                              : "wf-version-chip"
                          }
                          title={
                            run.versionSource === "inferred"
                              ? "This workflow has only ever had one version, so this run cannot have used any other."
                              : "Recorded by the runtime when this run started."
                          }
                        >
                          v{run.pinnedVersion}
                          {run.versionSource === "inferred" ? "*" : ""}
                        </span>
                      ) : (
                        <span
                          className="wf-muted"
                          title="This workflow has several versions and the pin was not recorded, so which one ran is genuinely unknown."
                        >
                          unknown
                        </span>
                      )}
                    </td>
                    <td>
                      {/*
                        The status pill alone. A truncated error string used to
                        sit under it, which was noise at best and wrong at
                        worst: a COMPLETED run keeps the last transient error
                        from a retry that then SUCCEEDED, so the line made
                        healthy runs look broken. The full message lives on the
                        run detail screen, where there is room to say what
                        actually happened.
                      */}
                      <span className={statusClass(run.status)}>
                        {statusLabel(run.status)}
                      </span>
                    </td>
                    <td className="run-num">{run.stepCount}</td>
                    <td className="run-num">{formatDuration(run.durationMs)}</td>
                    <td className="wf-muted">{formatWhen(run.startedAt)}</td>
                    <td>
                      <Link className="run-open" to={`/runs/${run.runId}`}>
                        View run →
                      </Link>
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
