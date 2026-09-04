/**
 * Screen 2 — describe a workflow, get one proposal.
 *
 * DECISIONS GATE ACCEPT. The trigger and the routing choice are cards, and
 * Accept stays disabled until every card is resolved. Nothing high-stakes
 * defaults silently: the suggestion is pre-filled, the confirmation is a click
 * a person makes.
 *
 * THE LEDGER IS CHECKABLE, NOT PROSE. Every line says what it rests on — the
 * catalogue sentence it matched, the words you wrote, the registry entry it
 * chose. A line with nothing behind it does not belong here, which is why the
 * matcher reports the terms it matched on rather than a confidence it cannot
 * justify.
 *
 * WHAT IS HONESTLY MISSING, AND SAID SO ON SCREEN:
 *   Fan-out cannot be offered — a unique index permits one active binding per
 *   event, so "also run mine" would fail on save.
 *   Accept creates a draft graph but NOT a draft binding — the bindings table
 *   permits only active and retired, and an active one would put an unreviewed
 *   workflow into production. The trigger travels inside the draft instead.
 */
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  acceptProposal,
  proposeWorkflow,
  type CatalogEvent,
  type Proposal,
} from "../api/editor";
import { EventCatalogDrawer } from "./EventCatalogDrawer";

const MODULES = ["syntra", "astra", "orbit"];

type RoutingChoice = "subscribe" | "priority" | "replace" | null;

export function NewWorkflowPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"describe" | "clone">("describe");
  const [module, setModule] = useState("syntra");
  const [description, setDescription] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* ── the settings ─────────────────────────────────────────────────────
   *
   * ARRIVE ANSWERED, NOT ASKED.
   *
   * Everything here is chosen for you and changeable. Nothing on this screen
   * is committed: Accept creates a DRAFT, a draft cannot run, and the binding
   * is not made until go-live — which has its own gate. Asking someone to
   * confirm a pre-filled answer teaches them to click past it, so the one
   * warning that survives is the one whose mistake is invisible later: a
   * trigger nothing has ever published.
   */
  const [trigger, setTrigger] = useState<string | null>(null);
  /**
   * Default: leave existing routing alone. It is what accepting a draft
   * already does — no binding is touched — so it is the only option that is
   * both safe and true. Replacing is opt-in, because it retires somebody
   * else's live binding.
   */
  const [routingChoice, setRoutingChoice] = useState<RoutingChoice>("priority");
  const [routingOpen, setRoutingOpen] = useState(false);
  /** Both pickers start folded: the answer is the point, not the options. */
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [graphKey, setGraphKey] = useState("");
  const [ledgerOpen, setLedgerOpen] = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setProposal(null);
    setRoutingChoice("priority");
    setRoutingOpen(false);
    setTriggerOpen(false);
    const res = await proposeWorkflow({ module, description });
    setBusy(false);
    if (res.ok) {
      setProposal(res.data);
      setTrigger(res.data.suggestedTrigger);
      setGraphKey(`${module}.${(description.split(/\s+/)[1] ?? "new").toLowerCase().replace(/[^a-z0-9]/g, "")}.workflow`);
    } else {
      setError(res.body.message ?? res.body.error ?? "Could not build a proposal");
    }
  }, [module, description]);

  const existingConsumers = proposal?.routing.existing ?? [];
  const routingNeeded = existingConsumers.length > 0;

  /**
   * Three, not the whole ranked list. Word overlap is weak, so the runner-ups
   * are worth showing — but a long list reads as "the system does not know",
   * and past the third the ordering is noise. Anything further down is the
   * catalogue's job.
   */
  const topCandidates = (proposal?.triggerCandidates ?? []).slice(0, 3);

  const pickTrigger = (eventType: string) => setTrigger(eventType);

  /**
   * The one thing worth interrupting for.
   *
   * A trigger nothing has ever published produces a workflow that is created,
   * looks correct, and is never started by anything. No error, no failed run —
   * it simply never happens, and somebody finds out weeks later by asking why.
   * Every other choice on this screen announces itself.
   */
  const triggerNeverFired = useMemo(() => {
    if (!trigger) return false;
    const c = proposal?.triggerCandidates.find((x) => x.eventType === trigger);
    return c ? !c.everPublished : false;
  }, [trigger, proposal]);

  /**
   * The steps the proposal actually contains.
   *
   * These come from the API's `graph`, which is either generated by the model
   * or a single placeholder step when generation did not happen. This used to
   * be computed here — "take the module's first contract node" — because the
   * generator was not wired in. It is now, so the screen shows what was built
   * rather than a stand-in the person had to notice was a stand-in.
   */
  const chosenNodes = useMemo(() => proposal?.graph.nodes ?? [], [proposal]);

  const accept = async () => {
    if (!proposal || !trigger) return;
    setBusy(true);
    setError(null);
    const res = await acceptProposal({
      graphKey,
      module,
      triggerEventType: trigger,
      nodes: chosenNodes,
    });
    setBusy(false);
    if (res.ok) {
      navigate(
        `/workflows/${encodeURIComponent(res.data.graphKey)}/edit?version=${res.data.version}`,
      );
    } else {
      setError(res.body.message ?? res.body.error ?? "Could not create the draft");
    }
  };

  return (
    <div className="nw-page" data-testid="new-workflow">
      <header className="ge-header">
        <div>
          <p className="nw-crumb">workflows / new</p>
          <h1 className="ge-title">New workflow</h1>
        </div>
      </header>

      <div className="nw-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "describe"}
          className={tab === "describe" ? "rd-tab rd-tab--on" : "rd-tab"}
          onClick={() => setTab("describe")}
        >
          ✦ Describe
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "clone"}
          className={tab === "clone" ? "rd-tab rd-tab--on" : "rd-tab"}
          onClick={() => setTab("clone")}
        >
          ⧉ Clone
        </button>
      </div>

      {tab === "clone" ? (
        <div className="wf-warning" role="status">
          Cloning an existing workflow is not built yet. Describing produces the
          same proposal, and the registry's <strong>Edit</strong> action already
          copies a live version into a draft.
        </div>
      ) : (
        <>
          <div className="nw-compose">
            <label className="ge-field-label" htmlFor="nw-module">
              Module
            </label>
            <select
              id="nw-module"
              className="wf-select"
              value={module}
              onChange={(e) => setModule(e.target.value)}
            >
              {MODULES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <textarea
              className="nw-textarea"
              rows={4}
              placeholder={'Start with "when…" — for example: When a new job requirement finishes intake, match it against our available candidates and pause for review when confidence is low. Accept at 92.'}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label="Describe the workflow"
            />
            <button
              type="button"
              className="wf-btn wf-btn--primary"
              onClick={() => void generate()}
              disabled={busy || description.trim().length < 15}
              data-testid="nw-generate"
            >
              {busy ? "Building…" : "Build a proposal"}
            </button>
          </div>

          {error ? (
            <div className="wf-error" role="alert">
              {error}
            </div>
          ) : null}

          {proposal ? (
            <>
              {/* THE SEAM.

                  Shown only when one sentence turned out to describe two
                  workflows. Drawn top to bottom, in the order the work actually
                  happens, because the most useful thing here is seeing WHERE
                  your half starts — and, very often, that the other half
                  already exists and there is nothing to build.
              */}
              {proposal.handoff ? (
                <section className="nw-block">
                  <h2 className="nw-block-title">
                    <span>✂ This describes two workflows</span>
                  </h2>
                  <div className="nw-card nw-seam">
                    <p className="nw-seam-lead">
                      {proposal.handoff.theirSteps.length === 1
                        ? "One step you asked for belongs"
                        : `${proposal.handoff.theirSteps.length} of the steps you asked for belong`}{" "}
                      to{" "}
                      <strong>{proposal.handoff.otherModule.toUpperCase()}</strong>
                      , not to {proposal.module.toUpperCase()}. Applications hand
                      work to each other by publishing an event — two runs, two
                      versions, either side can change without breaking the other.
                    </p>

                    {(
                      [
                        proposal.handoff.yourHalf === "before"
                          ? { mine: true, steps: proposal.handoff.yourSteps }
                          : { mine: false, steps: proposal.handoff.theirSteps },
                        proposal.handoff.yourHalf === "after"
                          ? { mine: true, steps: proposal.handoff.yourSteps }
                          : { mine: false, steps: proposal.handoff.theirSteps },
                      ] as const
                    ).map((half, i) => (
                      <div key={i}>
                        {i === 1 && proposal.handoff?.viaEvent ? (
                          <div className="nw-seam-join">
                            <span className="nw-seam-rail" aria-hidden="true" />
                            <span className="nw-seam-event">
                              ⚡ {proposal.handoff.viaEvent}
                            </span>
                            <span className="nw-seam-rail" aria-hidden="true" />
                          </div>
                        ) : null}
                        <div
                          className={`nw-seam-half${half.mine ? " nw-seam-half--mine" : ""}`}
                        >
                          <span className="nw-seam-owner">
                            {half.mine
                              ? `${proposal.module.toUpperCase()} · yours`
                              : `${proposal.handoff?.otherModule.toUpperCase()} · theirs`}
                          </span>
                          <span className="nw-seam-steps">
                            {half.steps.join(" → ")}
                          </span>
                        </div>
                      </div>
                    ))}

                    {/*
                      The payoff. When something is already bound to the handoff
                      event, the correct answer to half the request is "somebody
                      already built that" — better than anything that could have
                      been generated for it.
                    */}
                    {proposal.handoff.handledBy.length > 0 ? (
                      <p className="nw-seam-done" role="status">
                        <strong>That half already exists.</strong>{" "}
                        {proposal.handoff.handledBy.map((h) => h.graphKey).join(", ")}{" "}
                        {proposal.handoff.handledBy.length === 1 ? "is" : "are"} already
                        live and bound to {proposal.handoff.viaEvent}. Nothing to build
                        there — the proposal below is only your half.
                      </p>
                    ) : proposal.handoff.viaEvent ? (
                      <p className="nw-seam-open" role="status">
                        Nothing is bound to {proposal.handoff.viaEvent} yet, so that half
                        still has to be built — as its own workflow, by whoever owns{" "}
                        {proposal.handoff.otherModule.toUpperCase()}.
                      </p>
                    ) : (
                      <p className="nw-seam-open" role="status">
                        No published event joining the two halves was named, so the
                        handoff has to be chosen by hand before either side can run.
                      </p>
                    )}
                  </div>
                </section>
              ) : null}

              {/* ── ONE SECTION, NOT THREE ───────────────────────────

                  Settings and the proposed build used to be two numbered
                  blocks with the seam between them, so reading the screen meant
                  holding "① is decided, ② is what it built" in your head while
                  scrolling past a third thing. There is only one object here —
                  a workflow — and every line of it now reads the same way:

                      what it is        the value        [ Change ]

                  Anything changeable is changed in place, and the choices stay
                  folded away until asked for. The trigger's runners-up used to
                  be listed permanently, which made a decided thing look
                  undecided.
              */}
              <section className="nw-block">
                <h2 className="nw-block-title">
                  <span>Your workflow</span>
                  <span className="ge-muted">
                    all of it is chosen already — change what you disagree with
                  </span>
                </h2>

                <div className="nw-card nw-rows">
                  {/* ── starts when ───────────────────────────────── */}
                  <div className="nw-row">
                    <span className="nw-row-kind">⚡ Starts when</span>
                    <span className="nw-row-body">
                      <code className="nw-row-value">
                        {trigger ?? "nothing chosen"}
                      </code>
                      <span className="nw-row-why">
                        {trigger
                          ? proposal.triggerCandidates.find(
                              (c) => c.eventType === trigger,
                            )?.description ?? "chosen from the event catalogue"
                          : "Nothing in the catalogue matched your description."}
                      </span>
                      {triggerNeverFired ? (
                        <span className="ge-flag ge-flag--warn">never fired</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className="wf-btn nw-row-change"
                      onClick={() => setTriggerOpen((v) => !v)}
                      aria-expanded={triggerOpen}
                    >
                      {triggerOpen ? "close" : "Change"}
                    </button>
                  </div>

                  {triggerOpen ? (
                    <div className="nw-row-expand">
                      {/*
                        THE TOP THREE. Ranking on word overlap is weak enough
                        that the second choice is often the right one, so the
                        runners-up are one click away rather than one search
                        away — but folded, because a decided thing should not
                        look like a list of options.
                      */}
                      {topCandidates.length > 1 ? (
                        <ul className="nw-cands" aria-label="Suggested triggers">
                          {topCandidates.map((c, i) => (
                            <li key={c.eventType}>
                              <button
                                type="button"
                                className={`nw-cand${
                                  c.eventType === trigger ? " nw-cand--on" : ""
                                }`}
                                onClick={() => pickTrigger(c.eventType)}
                                aria-pressed={c.eventType === trigger}
                              >
                                <span className="nw-cand-rank">{i + 1}</span>
                                <span className="nw-cand-body">
                                  <code className="nw-cand-type">
                                    {c.eventType}
                                  </code>
                                  <span className="nw-cand-why">
                                    matched{" "}
                                    {c.matchedOn.map((w) => `“${w}”`).join(", ")}
                                  </span>
                                </span>
                                {c.everPublished ? (
                                  <span
                                    className="nw-cand-live"
                                    title={`Published ${c.publishCount} times.`}
                                  >
                                    live
                                  </span>
                                ) : (
                                  <span
                                    className="ge-flag ge-flag--warn"
                                    title="Nothing has ever published this event, so a workflow triggered on it would never run."
                                  >
                                    never fired
                                  </span>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="nw-card-actions">
                        <button
                          type="button"
                          className="wf-btn"
                          onClick={() => setDrawerOpen(true)}
                        >
                          Browse all events…
                        </button>
                        {proposal.notRanked > 0 ? (
                          <span className="ge-muted nw-notranked">
                            {proposal.notRanked} more shared no wording with your
                            description and were not ranked
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* ── routing ───────────────────────────────────── */}
                  {routingNeeded ? (
                    <>
                      <div className="nw-row">
                        <span className="nw-row-kind">⇄ Routing</span>
                        <span className="nw-row-body">
                          <span className="nw-row-value">
                            {routingChoice === "replace"
                              ? "replaces what answers this today"
                              : "leaves existing routing alone"}
                          </span>
                          <span className="nw-row-why">
                            {existingConsumers.map((e) => e.graphKey).join(", ")}{" "}
                            already answers this event.{" "}
                            {routingChoice === "replace"
                              ? "At go-live it is retired and stops receiving the event."
                              : "Nothing about routing changes until go-live."}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="wf-btn nw-row-change"
                          onClick={() => setRoutingOpen((v) => !v)}
                          aria-expanded={routingOpen}
                        >
                          {routingOpen ? "close" : "Change"}
                        </button>
                      </div>

                      {routingOpen ? (
                        <div className="nw-row-expand">
                          <div className="nw-radios">
                            <label
                              className={
                                proposal.routing.fanoutPossible
                                  ? "nw-radio"
                                  : "nw-radio nw-radio--off"
                              }
                            >
                              <input
                                type="radio"
                                name="routing"
                                disabled={!proposal.routing.fanoutPossible}
                                checked={routingChoice === "subscribe"}
                                onChange={() => setRoutingChoice("subscribe")}
                              />
                              <span>
                                Subscribe as well (fan-out)
                                {!proposal.routing.fanoutPossible ? (
                                  <span className="nw-radio-why">
                                    not possible yet — one active binding per
                                    event is enforced by an index
                                  </span>
                                ) : null}
                              </span>
                            </label>
                            <label className="nw-radio">
                              <input
                                type="radio"
                                name="routing"
                                checked={routingChoice === "priority"}
                                onChange={() => setRoutingChoice("priority")}
                              />
                              <span>
                                Leave it alone
                                <span className="nw-radio-why">
                                  the draft is created without touching routing
                                </span>
                              </span>
                            </label>
                            <label className="nw-radio">
                              <input
                                type="radio"
                                name="routing"
                                checked={routingChoice === "replace"}
                                onChange={() => setRoutingChoice("replace")}
                              />
                              <span>
                                Replace it
                                <span className="nw-radio-why">
                                  retires the existing binding at go-live
                                </span>
                              </span>
                            </label>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {/* ── called ────────────────────────────────────── */}
                  <div className="nw-row">
                    <span className="nw-row-kind">✎ Called</span>
                    <span className="nw-row-body">
                      <input
                        className="ge-input nw-key"
                        value={graphKey}
                        onChange={(e) => setGraphKey(e.target.value)}
                        aria-label="Workflow name"
                      />
                    </span>
                  </div>

                  {/* ── does ──────────────────────────────────────── */}
                  <div className="nw-row">
                    <span className="nw-row-kind">▤ Does</span>
                    <span className="nw-row-body">
                      <span className="nw-steps">
                        {chosenNodes.length
                          ? chosenNodes.map((n) => n.impl).join(" → ")
                          : "no step could be chosen"}
                      </span>
                      <span className="nw-row-why">
                        {proposal.graph.source === "model" ? (
                          <>
                            built by {proposal.graph.model} · every step checked
                            against the node registry · reshape it in the editor
                            after you accept
                          </>
                        ) : (
                          <>
                            one placeholder step · {proposal.graph.fallbackReason}{" "}
                            · build it out in the editor after you accept
                          </>
                        )}
                      </span>
                    </span>
                  </div>

                  {/* ── settings lifted out of the description ─────── */}
                  {proposal.extractedConfig.length ? (
                    <div className="nw-row">
                      <span className="nw-row-kind">⚙ Set to</span>
                      <span className="nw-row-body">
                        <span className="nw-config">
                          {proposal.extractedConfig.map((c) => (
                            <span key={c.field} className="nw-config-item">
                              {c.field} {c.value}
                              <span className="nw-provenance">from your text</span>
                            </span>
                          ))}
                        </span>
                      </span>
                    </div>
                  ) : null}

                  {/*
                    THE GAP REPORT. The model is required to declare what it
                    could not build rather than quietly dropping it, and that
                    declaration is worth more than the graph itself — a missing
                    step you know about is a task, a missing step you do not is
                    a bug found in production.
                  */}
                  {proposal.graph.unsupported.length > 0 ? (
                    <div className="nw-gaps" role="status">
                      <strong>
                        Not built —{" "}
                        {proposal.graph.unsupported.length === 1
                          ? "one part"
                          : `${proposal.graph.unsupported.length} parts`}{" "}
                        of your description could not be turned into steps:
                      </strong>
                      <ul>
                        {proposal.graph.unsupported.map((u, i) => (
                          <li key={i}>{u}</li>
                        ))}
                      </ul>
                      <span className="ge-muted">
                        Add these by hand in the editor, or reword and generate
                        again.
                      </span>
                    </div>
                  ) : null}
                </div>
              </section>

              {/* ── ledger ──────────────────────────────────────────── */}
              <section className="nw-block">
                <button
                  type="button"
                  className="nw-ledger-toggle"
                  onClick={() => setLedgerOpen((v) => !v)}
                  aria-expanded={ledgerOpen}
                >
                  {ledgerOpen ? "▲" : "▼"} how this was built — reasoning ledger
                </button>
                {ledgerOpen ? (
                  <>
                    {/*
                      WHO SAID THIS. Every line is computed by the API today,
                      and the flag says so rather than letting the prose imply
                      a judgement nothing made. The flag earns its place the day
                      a model contributes lines: a reader has to be able to see,
                      without reading carefully, which claims were derived and
                      which were reasoned — and hold the second to the harder
                      standard. Adding it afterwards means re-reading every line
                      already on screen.
                    */}
                    <p className="ge-muted nw-ledger-note">
                      Every line below is computed from the catalogue and the
                      outbox. Nothing here was written by a model.
                    </p>
                    <ol className="nw-ledger">
                      {proposal.ledger.map((l, i) => (
                        <li
                          key={i}
                          className={`nw-ledger-row nw-ledger-row--${l.kind}`}
                        >
                          <span className="nw-ledger-kind">{l.kind}</span>
                          <span>
                            <span className="nw-ledger-text">{l.text}</span>
                            {l.citation ? (
                              <span className="nw-ledger-cite">{l.citation}</span>
                            ) : null}
                          </span>
                          <span
                            className={`nw-ledger-src nw-ledger-src--${l.source}`}
                            title={
                              l.source === "system"
                                ? "Computed by the API — check it against the cited artifact."
                                : "Reasoned by a model — check the citation resolves before trusting it."
                            }
                          >
                            {l.source}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </>
                ) : null}
              </section>

              {/*
                ACCEPT IS NOT GATED ON AGREEMENT.
                It used to be disabled until a counter said every decision was
                resolved. Nothing here is committed — a draft cannot run — so
                the only real precondition is having something to save. The one
                warning that survives is beside the button, where it is read.
              */}
              <div className="nw-accept">
                <button
                  type="button"
                  className="wf-btn wf-btn--primary"
                  onClick={() => void accept()}
                  disabled={busy || chosenNodes.length === 0}
                  data-testid="nw-accept"
                  title={
                    chosenNodes.length === 0
                      ? "There are no steps to save yet."
                      : undefined
                  }
                >
                  Accept → editor
                </button>
                <span className="ge-muted">
                  creates a draft that cannot run · the binding is created at
                  go-live
                </span>
              </div>
              {triggerNeverFired ? (
                <p className="nw-never-fired" role="status">
                  <strong>Nothing has ever published {trigger}.</strong> This
                  workflow would be created correctly and then never start,
                  because no event reaches it. Pick a different trigger, or make
                  sure something will publish this one before go-live.
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}

      {drawerOpen ? (
        <EventCatalogDrawer
          selected={trigger}
          moduleHint={module}
          onPick={(e: CatalogEvent) => {
            setTrigger(e.eventType);
            setDrawerOpen(false);
          }}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
    </div>
  );
}
