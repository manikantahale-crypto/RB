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
  acceptChain,
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

  /**
   * Links that still need building.
   *
   * A link whose event already starts a live workflow is skipped: creating a
   * second workflow for work somebody already did is the opposite of the
   * answer. Nothing is created for it and the screen says so.
   */
  const toBuild = useMemo(
    () => (proposal?.chain ?? []).filter((l) => !l.alreadyBuilt),
    [proposal],
  );
  const isChain = toBuild.length > 1;

  const accept = async () => {
    if (!proposal || !trigger) return;
    setBusy(true);
    setError(null);

    if (isChain) {
      /**
       * Each link is named for its own application, from the workflow name
       * the author typed. `syntra.match.workflow` authored as a chain becomes
       * `astra.match.workflow` and `syntra.match.workflow` — the same
       * intention, once per owner.
       */
      const suffix = graphKey.split(".").slice(1).join(".") || "authored";
      const res = await acceptChain({
        links: toBuild.map((link, i) => ({
          graphKey: `${link.module}.${suffix}`,
          module: link.module,
          fromModule: link.startsWith?.fromModule,
          // The first link keeps the trigger the author chose; every later one
          // starts at the handoff, which is what joins them.
          triggerEventType: i === 0 ? trigger : (link.startsWith?.eventType ?? trigger),
          registerTrigger: i > 0 && link.startsWith?.exists === false,
          // From the link itself. Reading these out of `graph.nodes` used to
          // work only for the first link, because that is all `graph` keeps.
          nodes: link.nodes,
        })),
      });
      setBusy(false);
      if (res.ok) {
        const first = res.data.created[0];
        if (first) {
          navigate(
            `/workflows/${encodeURIComponent(first.graphKey)}/edit?version=1`,
          );
        }
      } else {
        setError(res.body.message ?? res.body.error ?? "Could not create the chain");
      }
      return;
    }

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
              {/* THE CHAIN.

                  Shown when one description turned out to describe work in
                  more than one application. An author may write that in one
                  sentence — what cannot cross is the stored graph, so it
                  becomes a workflow per application joined by events.

                  Drawn top to bottom in the order the work flows, because the
                  most useful thing here is seeing WHERE your part sits and,
                  very often, that a neighbouring half already exists.
              */}
              {/* ── THE PLAN ─────────────────────────────────────────

                  What the author asked for, whole.

                  A request is an outcome, and an outcome is a chain of
                  workflows joined by events. Answering it with one
                  application's graph and an apology in `unsupported[]` is the
                  wrong answer: `unsupported` means "no node in the system can
                  do this", and a handoff to another application is the
                  opposite — it means "this is already handled, over there".

                  Boxes rather than one continuous canvas, deliberately. The
                  workflows version independently, fail independently, and may
                  belong to teams the author cannot change. Drawing them as one
                  picture hides all three until something breaks. The seam is
                  real, so it is visible — and made legible by naming the event
                  that carries the work, with what the catalogue knows about it.
              */}
              {proposal.plan && proposal.plan.steps.length > 0 ? (
                <section className="nw-block">
                  <h2 className="nw-block-title">
                    <span>▣ The plan</span>
                    <span className="ge-muted">
                      what you asked for, end to end
                    </span>
                  </h2>

                  <div className="nw-card nw-plan">
                    <p
                      className={
                        proposal.plan.steps.some((s) => s.state === "blocked")
                          ? "nw-plan-verdict nw-plan-verdict--blocked"
                          : "nw-plan-verdict"
                      }
                      role="status"
                    >
                      {proposal.plan.verdict}
                    </p>

                    {proposal.plan.steps.map((step) => {
                      const into = proposal.plan!.links.find(
                        (l) => l.toSeq === step.seq,
                      );
                      return (
                        <div key={step.seq}>
                          {/* the event that carries work into this step */}
                          {into ? (
                            <div
                              className={
                                into.blocked
                                  ? "nw-plan-link nw-plan-link--blocked"
                                  : "nw-plan-link"
                              }
                            >
                              <span className="nw-plan-rail" aria-hidden="true" />
                              <div className="nw-plan-linkbody">
                                {into.eventType ? (
                                  <>
                                    <code className="nw-plan-event">
                                      {into.eventType}
                                    </code>
                                    {into.description ? (
                                      <span className="nw-plan-why">
                                        {into.description}
                                      </span>
                                    ) : null}
                                    <span className="nw-plan-facts">
                                      {into.producedWhen
                                        ? `${into.producedWhen} · `
                                        : ""}
                                      {/* A handoff that has never been published
                                          is a chain that has never run. That is
                                          the most useful warning on this screen. */}
                                      {into.publishCount > 0
                                        ? `published ${into.publishCount}×`
                                        : "never published"}
                                      {into.bound && !into.routable
                                        ? " · queue not served"
                                        : ""}
                                      {into.emitted === "unknown"
                                        ? " · nothing declares it is published"
                                        : ""}
                                    </span>
                                  </>
                                ) : (
                                  <span className="nw-plan-event">
                                    ✖ nothing carries the work across
                                  </span>
                                )}
                                {into.reason ? (
                                  <span className="nw-plan-reason">
                                    {into.reason}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ) : null}

                          <div
                            className={`nw-plan-box nw-plan-box--${step.state}`}
                          >
                            <span className="nw-plan-seq">{step.seq}</span>
                            <span className="nw-plan-name">
                              {step.module.toUpperCase()}
                              {step.yours ? (
                                <span className="nw-plan-tag">yours</span>
                              ) : null}
                            </span>
                            <span className="nw-plan-state">
                              {step.state === "exists"
                                ? "EXISTS"
                                : step.state === "new"
                                  ? "TO BUILD"
                                  : "BLOCKED"}
                            </span>
                            <span className="nw-plan-detail">
                              {step.graphKey ? (
                                <code>
                                  {step.graphKey}
                                  {step.version ? ` v${step.version}` : ""}
                                </code>
                              ) : null}
                              <span className="nw-plan-steps">
                                {step.steps.join(" → ") || "no steps"}
                              </span>
                              <span className="nw-plan-why">
                                {step.summary}
                              </span>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {proposal.chain && proposal.chain.length > 1 ? (
                <section className="nw-block">
                  <h2 className="nw-block-title">
                    <span>
                      ⛓ This becomes {proposal.chain.length} workflows
                    </span>
                    <span className="ge-muted">
                      one per application, joined by events
                    </span>
                  </h2>
                  <div className="nw-card nw-seam">
                    <p className="nw-seam-lead">
                      {proposal.chainDecision?.reason ??
                        "Applications hand work to each other by publishing an event."}{" "}
                      Each half is its own run with its own version, so either
                      side can change without breaking the other.
                    </p>

                    {proposal.chain.map((link, i) => (
                      <div key={`${link.module}-${i}`}>
                        {link.startsWith ? (
                          <div className="nw-seam-join">
                            <span className="nw-seam-rail" aria-hidden="true" />
                            <span
                              className={`nw-seam-event${link.startsWith.exists ? "" : " nw-seam-event--new"}`}
                              title={
                                link.startsWith.exists
                                  ? "Already in the event catalogue"
                                  : "Would have to be registered before this can run"
                              }
                            >
                              ⚡ {link.startsWith.eventType}
                              {link.startsWith.exists ? "" : " · new"}
                            </span>
                            <span className="nw-seam-rail" aria-hidden="true" />
                          </div>
                        ) : null}

                        <div
                          className={`nw-seam-half${link.yours ? " nw-seam-half--mine" : ""}${
                            link.alreadyBuilt ? " nw-seam-half--done" : ""
                          }`}
                        >
                          <span className="nw-seam-owner">
                            {link.module.toUpperCase()}
                            {link.yours ? " · yours" : ""}
                            {link.alreadyBuilt ? " · already built" : ""}
                          </span>
                          <span className="nw-seam-steps">
                            {link.alreadyBuilt
                              ? link.alreadyBuilt
                              : link.steps.join(" → ")}
                          </span>
                        </div>
                      </div>
                    ))}

                    {/*
                      The payoff. Where a live workflow already answers the
                      event that would start a link, the correct answer to that
                      part of the request is "somebody already built it" — which
                      is better than anything that could have been generated.
                    */}
                    {proposal.chain.some((l) => l.alreadyBuilt) ? (
                      <p className="nw-seam-done" role="status">
                        <strong>Some of this already exists.</strong>{" "}
                        {proposal.chain
                          .filter((l) => l.alreadyBuilt)
                          .map((l) => `${l.module.toUpperCase()} → ${l.alreadyBuilt}`)
                          .join(", ")}
                        . Nothing needs building there.
                      </p>
                    ) : null}

                    {/* ── THE ONE FAILURE NOBODY WOULD SEE ─────────────

                        If the first half never publishes the joining event,
                        the second half is never triggered: no error, no failed
                        run, the work just stops.

                        Two strengths of warning, because the evidence differs.
                        When every step in that half has declared what it
                        publishes, "it does not" is a fact and this is broken.
                        When some step has not declared, it might publish from
                        inside its own code and only the author can say.
                    */}
                    {proposal.chain.some((l) => l.handoffEmitted === "no") ? (
                      <p className="nw-seam-broken" role="alert">
                        <strong>This handoff will not happen.</strong> Every
                        step in{" "}
                        {proposal.chain
                          .filter((l) => l.handoffEmitted === "no")
                          .map((l) => l.startsWith!.fromModule.toUpperCase())
                          .join(", ")}
                        's half has declared what it publishes, and none of them
                        publish{" "}
                        {proposal.chain
                          .filter((l) => l.handoffEmitted === "no")
                          .map((l) => l.startsWith!.eventType)
                          .join(", ")}
                        . The next half would never run, and nothing would
                        report a failure. Add a step that publishes it before
                        this goes live.
                      </p>
                    ) : null}

                    {proposal.chain.some((l) => l.handoffEmitted === "unknown") ? (
                      <p className="nw-seam-open" role="status">
                        <strong>Check the handoff is actually published.</strong>{" "}
                        Some steps in{" "}
                        {proposal.chain
                          .filter((l) => l.handoffEmitted === "unknown")
                          .map((l) => l.startsWith!.fromModule.toUpperCase())
                          .join(", ")}
                        's half have not declared what they publish, so whether{" "}
                        {proposal.chain
                          .filter((l) => l.handoffEmitted === "unknown")
                          .map((l) => l.startsWith!.eventType)
                          .join(", ")}{" "}
                        is published cannot be checked here. If it is not, the
                        next half never starts and nothing reports a failure.
                      </p>
                    ) : null}

                    {proposal.chain.some((l) => l.startsWith && !l.startsWith.exists) ? (
                      <p className="nw-seam-open" role="status">
                        <strong>One event does not exist yet.</strong> Every
                        application shares the event catalogue, so registering{" "}
                        {proposal.chain
                          .filter((l) => l.startsWith && !l.startsWith.exists)
                          .map((l) => l.startsWith!.eventType)
                          .join(", ")}{" "}
                        is a change others live with. It is created when you
                        accept.
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {/* ── THE SAME WORK RUNNING TWICE ──────────────────────

                  A step that publishes does not just record something: if the
                  event it publishes is bound, it starts a whole other
                  workflow. `syntra.jd.process` publishes `syntra.jd.parsed`,
                  which starts `syntra.continuous.match` — so a flow holding
                  both steps matches the same job twice, with no error and
                  nothing in a log to say so.

                  Above everything else on the screen because it is wrong,
                  not merely worth knowing.
              */}
              {proposal.triggeredWorkflows.some((t) => t.alsoRunsHere.length) ? (
                <section className="nw-block">
                  <h2 className="nw-block-title">
                    <span>⚠ Some of this would run twice</span>
                    <span className="ge-muted">worth fixing before you build</span>
                  </h2>
                  <div className="nw-card nw-seam">
                    {proposal.triggeredWorkflows
                      .filter((t) => t.alsoRunsHere.length)
                      .map((t) => (
                        <p key={`${t.stepId}-${t.eventType}`} className="nw-seam-open">
                          <strong>{t.impl}</strong> publishes{" "}
                          <code>{t.eventType}</code> when it finishes, which
                          starts <strong>{t.graphKey}</strong>. That workflow
                          runs {t.alsoRunsHere.join(", ")} — and so does this
                          one, so a single input gets processed twice.
                          <br />
                          Either drop {t.alsoRunsHere.length === 1 ? "that step" : "those steps"}{" "}
                          here and let {t.graphKey} do that part, or keep{" "}
                          {t.alsoRunsHere.length === 1 ? "it" : "them"} and retire
                          that binding.
                        </p>
                      ))}
                  </div>
                </section>
              ) : null}

              {/* ── CROSSES APPLICATIONS, STILL ONE WORKFLOW ─────────

                  Splitting is not free: two halves joined by an event can fail
                  silently, because a join nobody publishes stops the work with
                  no error anywhere. It is worth that risk only to reuse a
                  workflow somebody already built. With nothing to reuse, one
                  workflow runs the whole way through — and an author who sees
                  two applications on the canvas should be told that is
                  deliberate rather than left wondering.
              */}
              {proposal.spansModules && !proposal.chain ? (
                <section className="nw-block">
                  <h2 className="nw-block-title">
                    <span>⛓ One workflow across applications</span>
                    <span className="ge-muted">runs start to finish in one go</span>
                  </h2>
                  <div className="nw-card nw-seam">
                    <p className="nw-seam-lead">
                      {proposal.chainDecision?.reason} Its steps run in order in
                      a single run, so each one can read what the steps before
                      it produced.
                    </p>

                    {/* ── SAID NOW, NOT AT THE LAST GATE ───────────────

                        Borrowing another application's step is the normal
                        outcome of a flow that stays one workflow, and go-live
                        refuses it unless the owner has marked it shareable.
                        Finding that out after building the whole thing is the
                        avoidable part, so it is said here. Nothing is blocked:
                        this builds, tests and runs on screen 5 today.
                    */}
                    {proposal.borrowedSteps.length > 0 ? (
                      <p className="nw-seam-open" role="status">
                        <strong>
                          Going live will need{" "}
                          {[...new Set(proposal.borrowedSteps.map((b) => b.ownedBy))]
                            .map((o) => o.toUpperCase())
                            .join(" and ")}
                          's agreement.
                        </strong>{" "}
                        {proposal.borrowedSteps.map((b) => b.step).join(", ")}{" "}
                        {proposal.borrowedSteps.length === 1 ? "is" : "are"} theirs
                        and not marked shareable — a borrowed step runs under its
                        owner's database role, so it is their call. You can build
                        and test this now either way.
                      </p>
                    ) : null}
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
                        {/* `resolved` is not a weaker "model" — it means no
                            model was called at all, because the workflow this
                            describes already runs and only a setting differs.
                            Saying "built by …" here would credit a model with
                            something it was never asked. */}
                        {proposal.graph.source === "resolved" ? (
                          <>
                            {proposal.graph.summary} · nothing was generated ·
                            open it in the editor to see the change in place
                          </>
                        ) : proposal.graph.source === "model" ? (
                          <>
                            built by {proposal.graph.model} · every step checked
                            against the node registry · reshape it in the editor
                            after you accept
                          </>
                        ) : (
                          <>
                            one placeholder step · build it out in the editor
                            after you accept
                          </>
                        )}
                      </span>
                    </span>
                  </div>

                  {/*
                    WHY THERE IS ONLY A PLACEHOLDER, ON ITS OWN LINE.

                    This used to sit inside the sentence above, which meant a
                    provider quota message — several lines of it, with a URL —
                    landed in the middle of a description of the workflow. It
                    read as though the workflow were the problem, and somebody
                    would go and rewrite a sentence that was fine.
                  */}
                  {proposal.graph.source === "placeholder" &&
                  proposal.graph.fallbackReason ? (
                    <div className="nw-gaps" role="status">
                      <strong>The shape was not generated.</strong>
                      <p className="nw-fallback-why">
                        {proposal.graph.fallbackReason}
                      </p>
                      <span className="ge-muted">
                        Everything else on this screen — the trigger, the
                        settings read from your words, the routing check — was
                        worked out without the model and is still correct.
                      </span>
                      {/*
                        A retry, here, rather than "go back to the other tab and
                        press Generate". A rate limit clears on its own and the
                        description has not changed, so making somebody navigate
                        to repeat themselves is the wrong shape for the one
                        failure that fixes itself.
                      */}
                      <div className="nw-fallback-actions">
                        <button
                          type="button"
                          className="wf-btn wf-btn--primary"
                          disabled={busy}
                          onClick={() => void generate()}
                        >
                          {busy ? "Trying…" : "Try again"}
                        </button>
                      </div>
                    </div>
                  ) : null}

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
                  {isChain
                    ? `Accept → ${toBuild.length} drafts`
                    : "Accept → editor"}
                </button>
                <span className="ge-muted">
                  {isChain
                    ? `creates ${toBuild.length} drafts, one per application · none of them run until each goes live`
                    : "creates a draft that cannot run · the binding is created at go-live"}
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
