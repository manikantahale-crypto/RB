/**
 * Screen 1 — Workflows registry. "Find everything, start anything."
 *
 * One row per graph key, and every column is derived from the system itself:
 * triggers from the bindings table, health from the run tables, versions from
 * the definitions table. Nothing here is hand-maintained, so nothing here can
 * quietly go stale.
 *
 * Two deliberate choices worth knowing:
 *
 *   WAITING is not a failure. A run parked at a human gate for three days is
 *   the system working. It gets its own colour, away from the failure count,
 *   because showing it as a problem trains people to ignore real problems.
 *
 *   An unreachable workflow is called out. A graph can be active and have no
 *   binding, which means it can never run — and that is invisible everywhere
 *   else, because the graph looks perfectly healthy right up until you notice
 *   it has never fired.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listWorkflows, type WorkflowRegistryRow } from "../api";

type SortKey = "activity" | "name" | "module";

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/** "v3 global · v4 @org" — one cell, because it is one fact about one key. */
function VersionCell({ row }: { row: WorkflowRegistryRow }) {
  if (row.activeVersion == null && row.orgActiveVersion == null) {
    return (
      <span className="wf-version wf-version--none" title="No active version">
        not released
      </span>
    );
  }
  return (
    <span className="wf-version">
      {row.activeVersion != null ? (
        <span className="wf-version-chip">v{row.activeVersion} global</span>
      ) : null}
      {row.orgActiveVersion != null ? (
        <span className="wf-version-chip wf-version-chip--org">
          v{row.orgActiveVersion} this org
        </span>
      ) : null}
    </span>
  );
}

function HealthCell({ row }: { row: WorkflowRegistryRow }) {
  const { runs24h, failed24h, waiting, lastRunAt } = row.health;

  if (runs24h === 0 && waiting === 0) {
    return (
      <span className="wf-health wf-health--idle">
        no runs in 24h
        <span className="wf-health-sub">last {relativeTime(lastRunAt)}</span>
      </span>
    );
  }

  return (
    <span className="wf-health">
      <span className="wf-health-counts">
        <span className="wf-pill wf-pill--neutral">{runs24h} in 24h</span>
        {failed24h > 0 ? (
          <span className="wf-pill wf-pill--danger">{failed24h} failed</span>
        ) : null}
        {waiting > 0 ? (
          <span
            className="wf-pill wf-pill--waiting"
            title="Parked at a human gate. This is a healthy state, not a failure."
          >
            {waiting} waiting
          </span>
        ) : null}
      </span>
      <span className="wf-health-sub">last {relativeTime(lastRunAt)}</span>
    </span>
  );
}

export function WorkflowsRegistryPage() {
  const [rows, setRows] = useState<WorkflowRegistryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("activity");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  /**
   * Refresh needs to be visibly doing something. Without this the button
   * fetched correctly and looked broken: the request went out, the data came
   * back identical, and nothing on screen moved — which is indistinguishable
   * from a dead control. The fetching state plus the timestamp below are what
   * make a successful refresh legible.
   */
  const [fetching, setFetching] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setFetching(true);
    setError(null);
    const res = await listWorkflows();
    if (res.ok) {
      setRows(res.data.workflows);
      setLastLoadedAt(new Date());
    } else {
      setError(res.body.message ?? res.body.error ?? "Could not load workflows");
    }
    setFetching(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const modules = useMemo(() => {
    const set = new Set((rows ?? []).map((r) => r.module));
    return ["all", ...[...set].sort()];
  }, [rows]);

  const visible = useMemo(() => {
    let list = rows ?? [];
    if (moduleFilter !== "all") list = list.filter((r) => r.module === moduleFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.graphKey.toLowerCase().includes(q) ||
          r.triggers.some((t) => t.toLowerCase().includes(q)),
      );
    }
    const sorted = [...list];
    if (sort === "name") sorted.sort((a, b) => a.graphKey.localeCompare(b.graphKey));
    else if (sort === "module")
      sorted.sort(
        (a, b) =>
          a.module.localeCompare(b.module) || a.graphKey.localeCompare(b.graphKey),
      );
    else
      sorted.sort(
        (a, b) =>
          b.health.runs24h - a.health.runs24h ||
          a.graphKey.localeCompare(b.graphKey),
      );
    return sorted;
  }, [rows, query, sort, moduleFilter]);

  const orphans = (rows ?? []).filter((r) => r.orphan);

  return (
    <div className="wf-registry" data-testid="workflows-registry">
      <header className="wf-registry-head">
        <div>
          <h1 className="wf-registry-title">Workflows</h1>
          <p className="wf-registry-sub">
            Every workflow on the platform, what starts it, and how it has been
            doing.
          </p>
        </div>
        <button type="button" className="wf-btn wf-btn--primary" disabled>
          + New workflow
        </button>
      </header>

      {orphans.length > 0 ? (
        <div className="wf-warning" role="status">
          <strong>
            {orphans.length} workflow{orphans.length === 1 ? "" : "s"} cannot run.
          </strong>{" "}
          {orphans.length === 1 ? "It has" : "They have"} an active version but
          nothing bound to start {orphans.length === 1 ? "it" : "them"}:{" "}
          {orphans.map((o) => o.graphKey).join(", ")}.
        </div>
      ) : null}

      <div className="wf-controls">
        <input
          className="wf-search"
          placeholder="Search by workflow or trigger…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search workflows"
        />
        <select
          className="wf-select"
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          aria-label="Filter by module"
        >
          {modules.map((m) => (
            <option key={m} value={m}>
              {m === "all" ? "All modules" : m}
            </option>
          ))}
        </select>
        <select
          className="wf-select"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort workflows"
        >
          <option value="activity">Busiest first</option>
          <option value="name">Name</option>
          <option value="module">Module</option>
        </select>
        <button
          type="button"
          className="wf-btn"
          onClick={() => void load()}
          disabled={fetching}
          data-testid="workflows-refresh"
        >
          {fetching ? "Refreshing…" : "Refresh"}
        </button>
        {lastLoadedAt ? (
          <span className="wf-updated" data-testid="workflows-updated">
            updated {lastLoadedAt.toLocaleTimeString()}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="wf-error" role="alert">
          {error}
        </div>
      ) : null}

      {rows === null && !error ? (
        <p className="wf-empty">Loading workflows…</p>
      ) : null}

      {rows !== null && visible.length === 0 ? (
        <p className="wf-empty">No workflows match that search.</p>
      ) : null}

      {visible.length > 0 ? (
        <div className="wf-table-wrap">
          <table className="wf-table">
            <thead>
              <tr>
                <th scope="col">Workflow</th>
                <th scope="col">Starts when</th>
                <th scope="col">Live version</th>
                <th scope="col">Drafts</th>
                <th scope="col">Last 24 hours</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.graphKey}
                  data-testid="workflow-row"
                  className={row.orphan ? "wf-row wf-row--orphan" : "wf-row"}
                >
                  <td>
                    <span className="wf-key">{row.graphKey}</span>
                    <span className="wf-module">{row.module}</span>
                  </td>
                  <td>
                    {row.triggers.length === 0 ? (
                      <span className="wf-trigger wf-trigger--none">
                        nothing starts this
                      </span>
                    ) : (
                      <span className="wf-triggers">
                        {row.triggers.map((t) => (
                          <span key={t} className="wf-trigger">
                            {t}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td>
                    <VersionCell row={row} />
                  </td>
                  <td>
                    {row.draftCount > 0 ? (
                      <span className="wf-pill wf-pill--info">
                        {row.draftCount} draft{row.draftCount === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="wf-muted">—</span>
                    )}
                    <span className="wf-versions-total">
                      {row.versionCount} version
                      {row.versionCount === 1 ? "" : "s"} total
                    </span>
                  </td>
                  <td>
                    {/* The deck makes this cell the way into screen 12. */}
                    <Link
                      className="wf-health-link"
                      to={`/workflows/${encodeURIComponent(row.graphKey)}/runs`}
                      aria-label={`See runs of ${row.graphKey}`}
                    >
                      <HealthCell row={row} />
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
