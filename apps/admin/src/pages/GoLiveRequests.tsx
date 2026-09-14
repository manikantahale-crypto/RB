/**
 * Screen 10 — the go-live queue.
 *
 * WORKFLOWS ONLY. The agent half of this screen is gone.
 *
 * It was written for the trial-era model where an agent owned a workflow, and
 * it listed agent policies waiting at `pending_go_live`. That model is being
 * retired: the unit of authorship is a workflow, nine active workflows have no
 * agent at all and run fine, and no step has ever been skipped by an agent
 * policy decision — zero, across 1,522 recorded steps.
 *
 * What it was actually showing made the case on its own. Every one of the ten
 * agent policies queued here was a test fixture (`custom.phase2-approve-*`),
 * so the screen that governs what reaches production listed ten things nobody
 * should approve and nothing anybody should. A queue that is always full of
 * noise is a queue people stop reading.
 *
 * The workflow queue is the real one. `authoring.graph_versions` has had a
 * `pending_go_live` status since V20260909.48, and until recently nothing
 * displayed it: an author could click "Request v7" in the editor and the
 * request would be seen by nobody. That made the two-person rule unusable
 * while it was enforced — `graph_versions_two_person_ck` refuses an approval
 * from the person who asked, so the one person who knew about a request was
 * the one person forbidden from acting on it.
 *
 * The agent TABLES and the runtime policy engine are untouched. The
 * orchestrator reads `builder.agent_definitions` before each node to decide
 * whether an actor may act unattended, and removing a screen must not change
 * what runs.
 *
 * This is not the finished Screen 10. The guide specifies a release console —
 * version card, evidence, scope editor, embedded routing simulation, and graph
 * plus binding activated in one transaction — and names this file as the one
 * screen to evolve rather than replace. This is the queue it starts from.
 */
import { Link } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import {
  approveGoLive,
  cancelGoLiveRequest,
  listPendingGoLive,
  type PendingGoLive,
} from "../api/editor";

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
  const [pending, setPending] = useState<PendingGoLive[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  /** graphKey of the workflow currently being approved or withdrawn. */
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await listPendingGoLive();
    if (res.ok) {
      setPending(res.data.requests);
      setError(null);
    } else {
      setPending([]);
      setError(
        res.body.message ?? res.body.error ?? "Could not load the queue",
      );
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Approve a version, and say what it replaced.
   *
   * The confirmation names the version going off the air as well as the one
   * going on. "Approve v7?" is not the decision being taken — replacing a v6
   * that has been live for a year is.
   */
  async function onApprove(row: PendingGoLive) {
    const replacing =
      row.liveVersion === null
        ? "Nothing is live for this workflow yet."
        : `This replaces v${row.liveVersion}, live since ${formatWhen(row.liveSince)}.`;
    const warning = row.unreachable
      ? "\n\nWARNING: nothing starts this workflow, so it will go live and never run."
      : "";
    if (
      !window.confirm(
        `Put ${row.graphKey} v${row.version} live?\n\n${replacing}${warning}`,
      )
    ) {
      return;
    }

    setBusyKey(row.graphKey);
    setBanner(null);
    const res = await approveGoLive(row.graphKey);
    setBusyKey(null);
    if (!res.ok) {
      // The refusals here explain themselves — "you asked for this one", "that
      // version is already live" — and rewording them would lose the reason.
      setBanner(
        res.body.message ??
          res.body.error ??
          "Approve failed — nothing was changed.",
      );
      await reload();
      return;
    }
    setBanner(
      res.data.note ??
        `${row.graphKey} v${res.data.version} is live` +
          (res.data.previousLive !== null
            ? `, replacing v${res.data.previousLive}.`
            : ".") +
          (res.data.boundTo ? ` Bound to ${res.data.boundTo}.` : ""),
    );
    await reload();
  }

  /** Send it back to the author. The build survives; only the request goes. */
  async function onWithdraw(row: PendingGoLive) {
    if (
      !window.confirm(
        `Withdraw the request for ${row.graphKey} v${row.version}?\n\nThe compiled version is kept — only the request is cancelled, and the author can ask again.`,
      )
    ) {
      return;
    }
    setBusyKey(row.graphKey);
    setBanner(null);
    const res = await cancelGoLiveRequest(row.graphKey);
    setBusyKey(null);
    setBanner(
      res.ok
        ? `Request for ${row.graphKey} v${row.version} withdrawn.`
        : (res.body.message ??
            res.body.error ??
            "Could not withdraw the request."),
    );
    await reload();
  }

  return (
    <section className="go-live-page">
      <Link className="back-link" to="/workflows">
        ← Workflows
      </Link>

      <div className="page-head">
        <h1>Go-live</h1>
        <p className="muted">
          Workflow versions waiting for a second person to approve them.
          Approving puts that version on the air and takes the current one off,
          in one step — whoever asked cannot be the one who approves.
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

      {pending === null ? (
        <div className="loading">Loading…</div>
      ) : pending.length === 0 ? (
        <p className="muted go-live-empty">
          Nothing is waiting. A request appears here when someone opens a
          workflow, compiles a draft and clicks <strong>Request</strong>.
        </p>
      ) : (
        <ul className="go-live-agent-list" data-testid="pending-workflows">
          {pending.map((r) => (
            <li
              key={`${r.graphKey}-${r.version}`}
              className="go-live-agent-card"
              data-graph-key={r.graphKey}
            >
              <div>
                <h3>{r.graphKey}</h3>
                <p className="muted">
                  v{r.version} · {r.stepCount} step
                  {r.stepCount === 1 ? "" : "s"}
                  {r.liveVersion === null
                    ? " · nothing live yet"
                    : ` · replaces v${r.liveVersion}, live since ${formatWhen(r.liveSince)}`}
                </p>
                <p className="go-live-agent-meta muted">
                  Requested {formatWhen(r.requestedAt)}
                  {r.requestedBy ? ` by ${r.requestedBy}` : ""}
                  {r.compiledBy ? ` · compiled by ${r.compiledBy}` : ""}
                </p>
                {/*
                  A version nothing can start goes live and never runs. It is
                  the one failure this screen can catch BEFORE it happens,
                  rather than leaving somebody to wonder later why a live
                  workflow has no runs.
                */}
                {r.unreachable ? (
                  <p className="go-live-agent-trigger muted" role="status">
                    ⚠ Nothing starts this workflow — no event is bound and none
                    is chosen. Approving it would put it live and it would never
                    run.
                  </p>
                ) : (
                  <p className="go-live-agent-trigger muted">
                    Starts on {r.triggers.join(", ")}
                    {r.triggerSource === "draft"
                      ? " — the binding is created when you approve"
                      : ""}
                  </p>
                )}
              </div>
              <div className="go-live-card-actions">
                {/*
                  Into the console, not the editor.

                  The queue is for finding the thing; the console is for
                  deciding about it. Sending an approver to the editor put them
                  in the one screen built for changing a workflow rather than
                  judging it, with none of the evidence and the same button.
                */}
                <Link
                  className="btn secondary btn--compact"
                  to={`/go-live-requests/${encodeURIComponent(r.graphKey)}`}
                >
                  Review
                </Link>
                <button
                  type="button"
                  className="btn secondary btn--compact"
                  disabled={busyKey === r.graphKey}
                  onClick={() => void onWithdraw(r)}
                >
                  Withdraw
                </button>
                <button
                  type="button"
                  className="btn btn--compact"
                  disabled={busyKey === r.graphKey}
                  onClick={() => void onApprove(r)}
                >
                  {busyKey === r.graphKey ? "Approving…" : `Approve v${r.version}`}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
