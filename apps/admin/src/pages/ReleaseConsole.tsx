/**
 * Screen 10 — the release console. One version, and what approving it does.
 *
 * THE QUEUE SAYS WHAT IS WAITING. THIS SAYS WHAT HAPPENS.
 *
 * Approving is the only act in the platform that changes production, and until
 * this screen the approver saw a graph key, a version number and a button. The
 * evidence existed — nine checks, a diff, a router that can be asked what it
 * would do — and none of it was in front of the person deciding.
 *
 * Four things, in the order somebody actually asks them:
 *
 *   what is this            the version, its steps, who asked and when
 *   what does it replace    the version going off the air, and since when
 *   what would change       routing, computed by the router's own resolver
 *   what have we checked    all nine, passes included
 *
 * PASSES ARE SHOWN, NOT JUST FAILURES. A list of problems cannot be read as
 * "this was reviewed" — with only failures on screen, a clean run and a gate
 * that never executed look identical. Each check says which it is, and a check
 * that could not run is drawn as neither green nor red, because "we looked and
 * it was fine" and "we could not look" are different claims.
 *
 * THE BUTTON CONSULTS THE SAME GATE. `approve-go-live` now evaluates it inside
 * the transaction and refuses with `blocked_by_checks` — so this screen and
 * the act agree. It was not always so: the gate ran on the agent path only,
 * and approving a workflow ran no checks at all. A console showing evidence
 * beside a button that ignored it would be theatre.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  approveGoLive,
  cancelGoLiveRequest,
  loadRelease,
  type ReleaseCheck,
  type ReleaseView,
} from "../api/editor";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Green, red, or neither. The third is the one most consoles get wrong. */
function CheckRow({ check }: { check: ReleaseCheck }) {
  const state = check.unchecked ? "unknown" : check.ok ? "ok" : "bad";
  return (
    <li className={`rc-check rc-check--${state}`}>
      <span className="rc-check-mark" aria-hidden="true">
        {state === "ok" ? "✓" : state === "bad" ? "✗" : "—"}
      </span>
      <span className="rc-check-body">
        <code className="rc-check-id">{check.id}</code>
        <span className="rc-check-msg">{check.message}</span>
      </span>
    </li>
  );
}

export function ReleaseConsolePage() {
  const { graphKey = "" } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<ReleaseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!graphKey) return;
    const res = await loadRelease(graphKey);
    if (res.ok) {
      setView(res.data);
      setError(null);
    } else {
      setView(null);
      setError(res.body.message ?? res.body.error ?? "Could not load this release");
    }
  }, [graphKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onApprove() {
    if (!view) return;
    const replacing =
      view.replaces === null
        ? "Nothing is live for this workflow yet."
        : `This takes v${view.replaces.version} off the air, live since ${formatWhen(view.replaces.since)}.`;
    const moving =
      view.routing && view.routing.losing.length > 0
        ? `\n\n${view.routing.eventType} stops going to ${view.routing.losing.join(", ")}.`
        : "";
    if (!window.confirm(`Put ${view.graphKey} v${view.version} live?\n\n${replacing}${moving}`)) {
      return;
    }

    setBusy(true);
    setBanner(null);
    const res = await approveGoLive(view.graphKey);
    setBusy(false);
    if (!res.ok) {
      /*
       * A refusal from the gate arrives with every check attached, so the page
       * can show WHY rather than only that. Reloading picks those up alongside
       * the rest of the evidence.
       */
      setBanner(res.body.message ?? res.body.error ?? "Approve failed — nothing changed.");
      await load();
      return;
    }
    navigate("/go-live-requests");
  }

  async function onWithdraw() {
    if (!view) return;
    if (
      !window.confirm(
        `Withdraw the request for ${view.graphKey} v${view.version}?\n\nThe compiled version is kept — only the request is cancelled.`,
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await cancelGoLiveRequest(view.graphKey);
    setBusy(false);
    if (res.ok) navigate("/go-live-requests");
    else setBanner(res.body.message ?? "Could not withdraw the request.");
  }

  if (error) {
    return (
      <section className="rc-page">
        <Link className="back-link" to="/go-live-requests">
          ← Go-live
        </Link>
        <div className="wf-error" role="alert">
          {error}
        </div>
      </section>
    );
  }

  if (!view) return <p className="wf-empty">Loading…</p>;

  const failing = view.checks.filter((c) => !c.ok);

  return (
    <section className="rc-page" data-testid="release-console">
      <Link className="back-link" to="/go-live-requests">
        ← Go-live
      </Link>

      <header className="rc-head">
        <div>
          <h1 className="rc-title">{view.graphKey}</h1>
          <p className="muted">
            v{view.version} requested {formatWhen(view.requestedAt)}
            {view.requestedBy ? ` by ${view.requestedBy}` : ""}
            {view.compiledBy ? ` · compiled by ${view.compiledBy}` : ""}
          </p>
        </div>
        <div className="rc-actions">
          <Link
            className="btn secondary btn--compact"
            to={`/workflows/${encodeURIComponent(view.graphKey)}/edit?version=${view.version}`}
          >
            Open
          </Link>
          <button
            type="button"
            className="btn secondary btn--compact"
            disabled={busy}
            onClick={() => void onWithdraw()}
          >
            Withdraw
          </button>
          <button
            type="button"
            className="btn btn--compact"
            disabled={busy || view.blocked}
            onClick={() => void onApprove()}
            title={
              view.blocked
                ? `Blocked by ${view.blockedBy.join(", ")}`
                : "Put this version live"
            }
          >
            {busy ? "Approving…" : `Approve v${view.version}`}
          </button>
        </div>
      </header>

      {banner ? (
        <div className="wf-error" role="alert">
          {banner}
        </div>
      ) : null}

      {/*
        The refusal, stated once and plainly. A disabled button with a tooltip
        is not an explanation — somebody has to be able to read why without
        hovering.
      */}
      {view.blocked ? (
        <div className="rc-blocked" role="alert">
          <strong>This cannot go live yet.</strong>{" "}
          {failing[0]?.message ?? `Blocked by ${view.blockedBy.join(", ")}.`}
        </div>
      ) : null}

      <div className="rc-grid">
        <section className="rc-card">
          <h2>What this is</h2>
          <dl className="rc-facts">
            <div>
              <dt>Starts on</dt>
              <dd>{view.trigger ?? <span className="rc-warn">nothing chosen</span>}</dd>
            </div>
            <div>
              <dt>Steps</dt>
              <dd>
                {view.steps.length === 0
                  ? "none"
                  : view.steps.map((s) => s.impl).join(" → ")}
              </dd>
            </div>
            <div>
              <dt>Replaces</dt>
              <dd>
                {view.replaces === null ? (
                  "nothing — this is the first version to go live"
                ) : (
                  <>
                    v{view.replaces.version}, live since{" "}
                    {formatWhen(view.replaces.since)} ({view.replaces.stepCount}{" "}
                    step{view.replaces.stepCount === 1 ? "" : "s"})
                  </>
                )}
              </dd>
            </div>
          </dl>
        </section>

        {/*
          THE SIMULATION. Not an estimate — `resolveRoutes` is the function the
          router itself uses, run twice: against the bindings as they are, and
          as approval would leave them.
        */}
        <section className="rc-card">
          <h2>What would change</h2>
          {view.routing === null ? (
            <p className="muted">
              No trigger is chosen, so nothing would route to this workflow.
            </p>
          ) : (
            <>
              <p className="muted rc-event">
                when <code>{view.routing.eventType}</code> arrives
              </p>
              <div className="rc-routes">
                <div>
                  <h3>now</h3>
                  {view.routing.before.length === 0 ? (
                    <p className="muted">nothing answers it</p>
                  ) : (
                    <ul>
                      {view.routing.before.map((r) => (
                        <li key={r.workflowKey}>
                          {r.workflowKey}
                          {r.gatedOn.length > 0 ? (
                            <span className="rc-gate"> · only with {r.gatedOn.join(", ")}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3>after approving</h3>
                  <ul>
                    {view.routing.after.map((r) => (
                      <li
                        key={r.workflowKey}
                        className={
                          view.routing!.gaining.includes(r.workflowKey)
                            ? "rc-gaining"
                            : undefined
                        }
                      >
                        {r.workflowKey}
                        {r.gatedOn.length > 0 ? (
                          <span className="rc-gate"> · only with {r.gatedOn.join(", ")}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {view.routing.losing.length > 0 ? (
                <p className="rc-losing" role="status">
                  {view.routing.losing.join(", ")} stops receiving this event.
                </p>
              ) : null}
              {view.routing.losing.length === 0 &&
              view.routing.gaining.length === 0 ? (
                <p className="muted">
                  Routing does not change — this replaces a version of the same
                  workflow.
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>

      <section className="rc-card">
        <h2>
          What we checked{" "}
          <span className="muted">
            {view.checks.filter((c) => c.ok && !c.unchecked).length} passed ·{" "}
            {failing.length} failed ·{" "}
            {view.checks.filter((c) => c.unchecked).length} not checked
          </span>
        </h2>
        <ul className="rc-checks">
          {view.checks.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </ul>
      </section>
    </section>
  );
}
