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
import { Link, useNavigate } from "react-router-dom";
import { RowMenu } from "../lib/row-menu";
import { listWorkflows, type WorkflowRegistryRow } from "../api";
import { startDraft } from "../api/editor";

type SortKey = "activity" | "name" | "module";

/**
 * The one thing to do next, and nothing else.
 *
 * A workflow moves working copy -> compiled -> requested -> live, and at any
 * moment exactly one of those transitions is available. Four buttons of which
 * three are disabled teaches people to ignore the row; one button that says
 * what it does is readable at a glance and cannot be clicked in the wrong
 * order.
 *
 * Approval deliberately gets a different look. It is the only step here that
 * changes what runs in production, and it is the only one somebody other than
 * the author should be pressing.
 */
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
  const navigate = useNavigate();
  const [opening, setOpening] = useState<string | null>(null);
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

  /**
   * Where a row goes when you click it, and what History opens.
   *
   * The same destination from both, deliberately. Clicking the row is the
   * gesture people reach for; the menu item is for whoever looks for a named
   * action instead. Sending them to two different screens to be tidy would
   * mean one of the two is wrong.
   */
  const openRuns = (graphKey: string) =>
    navigate(`/workflows/${encodeURIComponent(graphKey)}/runs`);

  /**
   * Open the flow for editing, which means a NEW DRAFT — never a change to the
   * live version.
   *
   * A working copy that already exists is opened as it is. Only a workflow
   * without one needs a draft made from its live version — and asking for one
   * regardless would either fail (there is nothing to copy from for a
   * brand-new workflow) or quietly overwrite the edits somebody had in
   * progress.
   */
  const editWorkflow = async (graphKey: string) => {
    const row = (rows ?? []).find((r) => r.graphKey === graphKey);

    if (row?.lifecycle.hasWorkingCopy) {
      navigate(`/workflows/${encodeURIComponent(graphKey)}/edit?version=0`);
      return;
    }

    setOpening(graphKey);
    setError(null);
    const res = await startDraft(graphKey);
    setOpening(null);
    if (res.ok) {
      navigate(
        `/workflows/${encodeURIComponent(graphKey)}/edit?version=${res.data.version}`,
      );
    } else {
      setError(res.body.message ?? res.body.error ?? "Could not open an editable draft");
    }
  };

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
        <button
          type="button"
          className="wf-btn wf-btn--primary"
          onClick={() => navigate("/workflows/new")}
        >
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
                <th scope="col"><span className="sr-only">More actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                /*
                  THE ROW IS THE CONTROL.

                  It used to carry an Open button and a History link, which put
                  two targets on a row whose whole purpose is "show me this
                  workflow". Clicking the row now goes where people were going
                  anyway — its runs — and everything that acts on the workflow
                  moved behind the three-dot menu, always in the same column.

                  `role="link"` and the key handler are not decoration: a <tr>
                  with an onClick is invisible to the keyboard, and this screen
                  is the way in to every other one.
                */
                <tr
                  key={row.graphKey}
                  data-testid="workflow-row"
                  className={`wf-row wf-row--clickable${row.orphan ? " wf-row--orphan" : ""}`}
                  onClick={() => openRuns(row.graphKey)}
                >
                  <td>
                    {/*
                      A REAL LINK, not just the row's onClick.

                      Making the <tr> itself the control needs role="link" and
                      tabIndex, and that takes the row out of the table's
                      accessibility tree — it stops being a row, so the column
                      headers stop being announced with the cells. The row
                      handler above is the convenience for a mouse; this is the
                      thing a keyboard tabs to and a screen reader reads, and
                      it points at the same place.

                      stopPropagation because otherwise the click is handled
                      twice — once here and once by the row.
                    */}
                    <Link
                      className="wf-key"
                      to={`/workflows/${encodeURIComponent(row.graphKey)}/runs`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.graphKey}
                    </Link>
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
                    {/*
                      No link of its own any more — the row is the link, and a
                      link inside a clickable row is two targets doing one job.
                    */}
                    <HealthCell row={row} />
                  </td>
                  <td className="wf-actions-cell">
                    {/*
                      Everything that acts on a workflow, in one place that is
                      the same on every row.

                      Edit is disabled rather than hidden when there is nothing
                      to open: a menu whose items move depending on the row is
                      a menu you have to read every time, and the reason is
                      worth saying.
                    */}
                    <RowMenu
                      label={`More actions for ${row.graphKey}`}
                      testId={`row-menu-${row.graphKey}`}
                      items={[
                        {
                          label:
                            opening === row.graphKey ? "Opening…" : "Edit",
                          onSelect: () => void editWorkflow(row.graphKey),
                          disabledReason:
                            opening === row.graphKey
                              ? "Opening…"
                              : row.activeVersion == null &&
                                  !row.lifecycle.hasWorkingCopy
                                ? "No version and no draft to open yet"
                                : null,
                        },
                        {
                          label: "History",
                          onSelect: () => openRuns(row.graphKey),
                        },
                      ]}
                    />
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
