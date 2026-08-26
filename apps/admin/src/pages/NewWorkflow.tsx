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

  // ── the decisions ──────────────────────────────────────────────────
  const [trigger, setTrigger] = useState<string | null>(null);
  const [triggerConfirmed, setTriggerConfirmed] = useState(false);
  const [routingChoice, setRoutingChoice] = useState<RoutingChoice>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [graphKey, setGraphKey] = useState("");
  const [ledgerOpen, setLedgerOpen] = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setProposal(null);
    setTriggerConfirmed(false);
    setRoutingChoice(null);
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

  /** "N of N resolved" — the counter that gates Accept. */
  const decisions = useMemo(() => {
    const cards = [
      { id: "trigger", resolved: Boolean(trigger && triggerConfirmed) },
      ...(routingNeeded
        ? [{ id: "routing", resolved: routingChoice !== null }]
        : []),
    ];
    return {
      cards,
      resolved: cards.filter((c) => c.resolved).length,
      total: cards.length,
      allResolved: cards.every((c) => c.resolved),
    };
  }, [trigger, triggerConfirmed, routingNeeded, routingChoice]);

  const chosenNodes = useMemo(() => {
    // Until generation returns a graph, the proposal is the module's most
    // relevant step. Shown as one step a person then reshapes in the editor —
    // which is exactly the "accept then reshape" escape hatch.
    const first = proposal?.availableNodes.find((n) => n.source === "contract");
    if (!first) return [];
    const config: Record<string, unknown> = {};
    for (const c of proposal?.extractedConfig ?? []) config[c.field] = c.value;
    return [
      { id: first.key.split(".").pop() ?? "step", impl: first.key, config },
    ];
  }, [proposal]);

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
              {/* ── ① decisions ─────────────────────────────────────── */}
              <section className="nw-block">
                <h2 className="nw-block-title">
                  <span>① Decisions — yours to confirm</span>
                  <span
                    className={
                      decisions.allResolved ? "nw-counter nw-counter--done" : "nw-counter"
                    }
                    data-testid="nw-counter"
                  >
                    {decisions.resolved} of {decisions.total} resolved
                    {decisions.allResolved ? " ✓" : ""}
                  </span>
                </h2>

                <div className="nw-card">
                  <div className="nw-card-head">
                    <span className="nw-card-kind">⚡ Trigger</span>
                    <code className="nw-card-value">
                      {trigger ?? "nothing chosen"}
                    </code>
                  </div>
                  {trigger ? (
                    <p className="ge-muted">
                      {
                        proposal.triggerCandidates.find(
                          (c) => c.eventType === trigger,
                        )?.description
                      }
                    </p>
                  ) : (
                    <p className="ge-muted">
                      Nothing in the catalogue matched your description. Choose
                      one, or register a new event.
                    </p>
                  )}
                  <div className="nw-card-actions">
                    <button
                      type="button"
                      className={
                        triggerConfirmed ? "wf-btn" : "wf-btn wf-btn--primary"
                      }
                      onClick={() => setTriggerConfirmed(true)}
                      disabled={!trigger || triggerConfirmed}
                      data-testid="nw-confirm-trigger"
                    >
                      {triggerConfirmed ? "confirmed ✓" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      className="wf-btn"
                      onClick={() => setDrawerOpen(true)}
                    >
                      Change…
                    </button>
                  </div>
                </div>

                {routingNeeded ? (
                  <div className="nw-card">
                    <div className="nw-card-head">
                      <span className="nw-card-kind">⇄ Routing</span>
                      <span className="ge-muted">
                        {existingConsumers.map((e) => e.graphKey).join(", ")}{" "}
                        already answers this event
                      </span>
                    </div>
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
                              not possible yet — one active binding per event is
                              enforced by an index
                            </span>
                          ) : null}
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
                      <label className="nw-radio">
                        <input
                          type="radio"
                          name="routing"
                          checked={routingChoice === "priority"}
                          onChange={() => setRoutingChoice("priority")}
                        />
                        <span>
                          Leave it alone for now
                          <span className="nw-radio-why">
                            the draft is created without touching routing
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>
                ) : null}
              </section>

              {/* ── ② proposed build ────────────────────────────────── */}
              <section className="nw-block">
                <h2 className="nw-block-title">
                  <span>② Proposed build — review &amp; edit</span>
                </h2>
                <div className="nw-card">
                  <div className="nw-card-head">
                    <span className="nw-card-kind">name</span>
                    <input
                      className="ge-input nw-key"
                      value={graphKey}
                      onChange={(e) => setGraphKey(e.target.value)}
                      aria-label="Workflow name"
                    />
                  </div>
                  <div className="nw-card-head">
                    <span className="nw-card-kind">steps</span>
                    <span className="nw-steps">
                      {chosenNodes.length
                        ? chosenNodes.map((n) => n.impl).join(" → ")
                        : "no step could be chosen"}
                    </span>
                  </div>
                  {proposal.extractedConfig.length ? (
                    <div className="nw-card-head">
                      <span className="nw-card-kind">settings</span>
                      <span className="nw-config">
                        {proposal.extractedConfig.map((c) => (
                          <span key={c.field} className="nw-config-item">
                            {c.field} {c.value}
                            <span className="nw-provenance">from your text</span>
                          </span>
                        ))}
                      </span>
                    </div>
                  ) : null}
                  <p className="ge-muted nw-reshape">
                    One step to start with. Accept, then reshape it in the
                    editor — that is the escape hatch instead of a blank canvas.
                  </p>
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
                  <ol className="nw-ledger">
                    {proposal.ledger.map((l, i) => (
                      <li key={i} className={`nw-ledger-row nw-ledger-row--${l.kind}`}>
                        <span className="nw-ledger-kind">{l.kind}</span>
                        <span>
                          <span className="nw-ledger-text">{l.text}</span>
                          {l.citation ? (
                            <span className="nw-ledger-cite">{l.citation}</span>
                          ) : null}
                        </span>
                        {l.action === "trigger" ? (
                          <button
                            type="button"
                            className="nw-ledger-action"
                            onClick={() => setDrawerOpen(true)}
                          >
                            change
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </section>

              <div className="nw-accept">
                <button
                  type="button"
                  className="wf-btn wf-btn--primary"
                  onClick={() => void accept()}
                  disabled={!decisions.allResolved || busy || chosenNodes.length === 0}
                  data-testid="nw-accept"
                  title={
                    decisions.allResolved
                      ? undefined
                      : "Resolve every decision above first."
                  }
                >
                  Accept → editor
                </button>
                <span className="ge-muted">
                  creates a draft that cannot run · the binding is created at
                  go-live
                </span>
              </div>
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
            // Changing the trigger un-resolves the decision — a confirmation
            // has to be about the thing actually chosen.
            setTriggerConfirmed(false);
            setDrawerOpen(false);
          }}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
    </div>
  );
}
