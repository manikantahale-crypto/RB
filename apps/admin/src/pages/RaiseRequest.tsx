/**
 * Screen 6 — raise an approval request.
 *
 * WHAT THIS REPLACED, AND WHAT IT DELIBERATELY IS NOT.
 *
 * The original screen 6 was going to export a draft to a GitHub branch, show a
 * diff there and take webhooks back. That was cancelled on 2026-09-14 — see §6
 * of `Orchestrator_Decisions.md`. A workflow is data, not code: rows in
 * `authoring.graph_versions`, authored by somebody who will never open an
 * editor, and every guarantee a pull request is reached for is already
 * enforced here — an immutable numbered version, a second approver as a
 * database constraint, the go-live gate, and a full attribution trail.
 *
 * What was NOT cancelled is the reviewing. Asking somebody to put something
 * into production deserves a screen: you should see what you are sending
 * before you send it, and so should they.
 *
 * It was briefly a panel inside screen 5. That was wrong for the same reason
 * the test page should not have been the editor — this is a distinct act with
 * its own content, reached deliberately, and a section that unfolds under a
 * button reads as a confirmation rather than a decision.
 *
 * WHAT IT SHOWS, AND WHY EACH PART EARNS ITS PLACE
 *
 *   the version      what is actually being asked about, and what it replaces
 *   what changed     screen 8's diff, structured — `matchThreshold 90 → 80`,
 *                    not a JSON blob nobody reads
 *   the checks       the go-live gate, which runs at APPROVAL and answers 409.
 *                    Without it here, a request bounces off somebody else's
 *                    screen and the refusal reaches the author second-hand
 *   the runs         of THIS VERSION, from the database. The panel used
 *                    in-session state and said "nothing yet" for a version
 *                    with three runs behind it
 *   the note         the only thing here the platform cannot work out, and the
 *                    approver is never the author
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  loadApprovalRequest,
  loadDiff,
  loadGoLiveChecks,
  sendForApprovalRequest,
  type ApprovalRequestReview,
  type DiffResponse,
  type GoLiveChecks,
} from "../api/editor";

function formatWhen(iso: string | null): string {
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

export function RaiseRequestPage() {
  const { graphKey = "" } = useParams();
  const navigate = useNavigate();

  const [review, setReview] = useState<ApprovalRequestReview | null>(null);
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [checks, setChecks] = useState<GoLiveChecks | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, d, c] = await Promise.all([
      loadApprovalRequest(graphKey),
      loadDiff(graphKey),
      loadGoLiveChecks(graphKey),
    ]);
    if (r.ok) setReview(r.data);
    else setError(r.body.message ?? r.body.error ?? "Could not load the request");
    if (d.ok) setDiff(d.data);
    if (c.ok) setChecks(c.data);
    setLoading(false);
  }, [graphKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const raise = async () => {
    setBusy(true);
    setError(null);
    const res = await sendForApprovalRequest(graphKey, note);
    setBusy(false);
    if (!res.ok) {
      setError(res.body.message ?? res.body.error ?? "Could not raise the request");
      return;
    }
    setSaid(res.data.note ?? `v${res.data.version} is waiting for approval.`);
    await load();
  };

  /**
   * The gate runs at approval and refuses with a 409. Refusing here instead
   * means the author finds out while they can still do something about it.
   */
  const blocked = checks?.applicable === true && checks.ok === false;

  return (
    <div className="rq-page" data-testid="raise-request">
      <header className="rq-head">
        <p className="rq-crumb">
          <Link to={`/workflows/${encodeURIComponent(graphKey)}/edit`} className="run-back">
            ← Back to {graphKey}
          </Link>
        </p>
        <h1 className="rq-title">Raise approval request</h1>
        <p className="ge-muted">
          Somebody other than you puts it live. What they see is below.
        </p>
      </header>

      {error ? (
        <div className="rq-error" role="alert">
          {error}
        </div>
      ) : null}
      {said ? (
        <div className="rq-said" role="status">
          {said} <Link to="/go-live-requests">See it on Go-live</Link>
        </div>
      ) : null}

      {loading ? (
        <p className="ge-muted">Working it out…</p>
      ) : !review ? null : (
        <div className="rq-body">
          <section className="rq-block">
            <h2 className="rq-h">The version</h2>
            <dl className="rq-facts">
              <div className="rq-fact">
                <dt>workflow</dt>
                <dd>{graphKey}</dd>
              </div>
              <div className="rq-fact">
                <dt>version</dt>
                <dd>
                  {review.version != null ? `v${review.version}` : "—"}
                  {review.wouldCompile
                    ? " · frozen when you raise this"
                    : " · already frozen"}
                </dd>
              </div>
              <div className="rq-fact">
                <dt>replaces</dt>
                <dd>
                  {review.liveVersion != null
                    ? `v${review.liveVersion}, live now`
                    : "nothing — this workflow has never been live"}
                </dd>
              </div>
              <div className="rq-fact">
                <dt>starts on</dt>
                <dd>{review.trigger ?? "no trigger chosen"}</dd>
              </div>
              <div className="rq-fact">
                <dt>steps</dt>
                <dd>{review.steps.map((s) => s.id).join(" → ") || "none"}</dd>
              </div>
            </dl>
          </section>

          {/*
            Runs of this VERSION, read from the database.

            Testing is not compulsory, and this does not pretend otherwise —
            but "never run" and "run three times, one of them failed" are very
            different things to ask somebody to approve, and only one of them
            was previously visible.
          */}
          <section className="rq-block">
            <h2 className="rq-h">What it has done</h2>
            {review.tested.total === 0 ? (
              <p className="ge-muted">
                This version has never run.{" "}
                <Link to={`/workflows/${encodeURIComponent(graphKey)}/test`}>
                  Try it first
                </Link>{" "}
                — not required, but the approver will wonder.
              </p>
            ) : (
              <ul className="rq-runs">
                {review.tested.byStatus.map((r) => (
                  <li
                    key={r.status}
                    className={`rq-run rq-run--${r.status.toLowerCase()}`}
                  >
                    <strong>{r.count}</strong> {r.status.toLowerCase()}
                    {r.count === 1 ? "" : " runs"} · last {formatWhen(r.last)}
                    {r.latestRunId ? (
                      <>
                        {" · "}
                        <Link to={`/runs/${r.latestRunId}`}>open the latest</Link>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rq-block">
            <h2 className="rq-h">What changed</h2>
            {!diff?.diff ? (
              <p className="ge-muted">
                {diff?.note ?? "Nothing to compare — this is the first version."}
              </p>
            ) : diff.diff.identical ? (
              <p className="ge-muted">
                Identical to v{diff.from}. Raising this asks somebody to approve
                a change that is not there.
              </p>
            ) : (
              <>
                <p className="rq-sum">{diff.diff.summary}</p>
                <ul className="rq-changes">
                  {diff.diff.trigger.changed ? (
                    <li>
                      starts on <code>{diff.diff.trigger.to ?? "nothing"}</code>
                      {diff.diff.trigger.from ? (
                        <>
                          {" "}
                          — was <code>{diff.diff.trigger.from}</code>
                        </>
                      ) : null}
                    </li>
                  ) : null}
                  {diff.diff.nodes.map((n) => (
                    <li key={`${n.kind}-${n.id}`}>
                      <strong>{n.kind}</strong> {n.id} · <code>{n.impl}</code>
                      {n.config.length > 0 ? (
                        <ul className="rq-changes">
                          {n.config.map((cf) => (
                            <li key={cf.field}>
                              {cf.field}: <code>{JSON.stringify(cf.from)}</code> →{" "}
                              <code>{JSON.stringify(cf.to)}</code>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                  {diff.diff.edgesAdded.map(([a, b]) => (
                    <li key={`ea-${a}-${b}`}>
                      new path {a} → {b}
                    </li>
                  ))}
                  {diff.diff.edgesRemoved.map(([a, b]) => (
                    <li key={`er-${a}-${b}`}>
                      path removed {a} → {b}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="rq-block">
            <h2 className="rq-h">The checks the approver will run</h2>
            {!checks ? (
              <p className="ge-muted">Could not run them from here.</p>
            ) : !checks.applicable ? (
              <p className="ge-muted">{checks.reason}</p>
            ) : (
              <ul className="rq-checks">
                {checks.checks.map((c) => (
                  <li key={c.id} className={c.ok ? "rq-check--ok" : "rq-check--bad"}>
                    <span aria-hidden="true">{c.ok ? "✓" : "✗"}</span> {c.message}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rq-block">
            <h2 className="rq-h">What changed, and why</h2>
            <textarea
              className="ge-input rq-note"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Raised the match threshold to 80 — too many weak matches were reaching recruiters."
              disabled={review.alreadyPending}
            />
            <p className="ge-muted">
              Optional, and the only thing on this page the platform cannot work
              out for itself. The person approving is never you.
            </p>
          </section>

          <div className="rq-actions">
            {review.alreadyPending ? (
              <p className="ge-muted">
                v{review.version} is already waiting for approval.{" "}
                <Link to="/go-live-requests">See it on Go-live</Link>
              </p>
            ) : (
              <>
                <button
                  type="button"
                  className="wf-btn wf-btn--primary"
                  disabled={busy || blocked || review.version == null}
                  title={
                    blocked
                      ? "The gate would refuse this at approval. Fix it first."
                      : undefined
                  }
                  onClick={() => void raise()}
                >
                  {busy ? "Raising…" : "Raise the request"}
                </button>
                <button
                  type="button"
                  className="wf-btn"
                  disabled={busy}
                  onClick={() => navigate(-1)}
                >
                  Not yet
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
