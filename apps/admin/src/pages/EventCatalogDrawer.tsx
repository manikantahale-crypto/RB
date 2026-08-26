/**
 * Screen 3 — the event catalogue drawer.
 *
 * Invoked, not navigated. It opens over whatever you were doing, you leave with
 * one event chosen, and you are back where you were. That is why it is a
 * component other screens mount rather than a route — screen 2's trigger chip
 * and screen 4's binding edit both open the same thing.
 *
 * What each event shows: the one hand-written sentence, its payload shape, who
 * actually publishes it, and which workflows answer it. The last two are
 * computed from the outbox and the bindings, so they cannot drift from reality
 * the way a maintained list would.
 *
 * "Nothing fits" is a real answer, and it leads somewhere: registering an event
 * is creating a contract other teams build against, so the draft it creates
 * rides review rather than going live.
 */
import { useEffect, useMemo, useState } from "react";
import { listCatalogEvents, registerDraftEvent, type CatalogEvent } from "../api/editor";

export function EventCatalogDrawer({
  selected,
  onPick,
  onClose,
  moduleHint,
}: {
  selected?: string | null;
  onPick: (event: CatalogEvent) => void;
  onClose: () => void;
  /** Puts this module's events first — the common case is picking your own. */
  moduleHint?: string;
}) {
  const [events, setEvents] = useState<CatalogEvent[] | null>(null);
  const [aliasesSupported, setAliasesSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(selected ?? null);
  const [registering, setRegistering] = useState(false);
  const [newType, setNewType] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [registerError, setRegisterError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await listCatalogEvents();
      if (res.ok) {
        setEvents(res.data.events);
        setAliasesSupported(res.data.aliasesSupported);
      } else {
        setError(res.body.message ?? res.body.error ?? "Could not load the catalogue");
      }
    })();
  }, []);

  const modules = useMemo(() => {
    const set = new Set((events ?? []).map((e) => e.module));
    return ["all", ...[...set].sort()];
  }, [events]);

  const shown = useMemo(() => {
    let list = events ?? [];
    if (moduleFilter !== "all") list = list.filter((e) => e.module === moduleFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.eventType.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.aliases.some((a) => a.toLowerCase().includes(q)),
      );
    }
    // The module you are working in first, then alphabetical.
    return [...list].sort((a, b) => {
      if (moduleHint && a.module !== b.module) {
        if (a.module === moduleHint) return -1;
        if (b.module === moduleHint) return 1;
      }
      return a.eventType.localeCompare(b.eventType);
    });
  }, [events, query, moduleFilter, moduleHint]);

  const submitDraft = async () => {
    setRegisterError(null);
    const res = await registerDraftEvent({
      eventType: newType.trim(),
      description: newDesc.trim(),
    });
    if (res.ok) {
      setRegistering(false);
      setNewType("");
      setNewDesc("");
      const again = await listCatalogEvents();
      if (again.ok) setEvents(again.data.events);
      setExpanded(res.data.eventType);
    } else {
      setRegisterError(res.body.message ?? res.body.error ?? "Could not register it");
    }
  };

  return (
    <div
      className="ec-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Event catalogue"
      onClick={onClose}
    >
      <aside className="ec-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="ec-head">
          <div>
            <h2 className="ec-title">Choose a trigger</h2>
            <p className="ge-muted">
              What has to happen for this workflow to run.
            </p>
          </div>
          <button type="button" className="wf-btn" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="ec-controls">
          <input
            className="ge-input"
            autoFocus
            placeholder="Search events…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search events"
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
        </div>

        {error ? (
          <div className="wf-error" role="alert">
            {error}
          </div>
        ) : null}
        {!events && !error ? <p className="wf-empty">Loading catalogue…</p> : null}

        <div className="ec-list">
          {shown.map((e) => {
            const open = expanded === e.eventType;
            return (
              <div
                key={e.eventType}
                className={`ec-item${selected === e.eventType ? " ec-item--on" : ""}`}
              >
                <button
                  type="button"
                  className="ec-item-head"
                  onClick={() => setExpanded(open ? null : e.eventType)}
                  aria-expanded={open}
                >
                  <span className="ec-type">{e.eventType}</span>
                  {selected === e.eventType ? (
                    <span className="ec-selected">✓ selected</span>
                  ) : null}
                  {!e.everPublished ? (
                    <span
                      className="ge-flag"
                      title="Registered, but nothing has ever published it."
                    >
                      never fired
                    </span>
                  ) : null}
                  {e.status !== "ACTIVE" ? (
                    <span className="ge-flag ge-flag--warn">{e.status}</span>
                  ) : null}
                </button>

                <p className="ec-desc">{e.description || "No description written yet."}</p>

                {e.aliases.length > 0 ? (
                  <div className="ec-aliases">
                    {e.aliases.map((a) => (
                      <span key={a} className="ec-alias">
                        {a}
                      </span>
                    ))}
                  </div>
                ) : null}

                {open ? (
                  <div className="ec-detail">
                    <dl className="ge-contract">
                      <div>
                        <dt>carries</dt>
                        <dd>
                          <code>
                            {Object.keys(
                              (e.payloadSchema as any)?.properties ?? {},
                            ).join(", ") || "—"}
                          </code>
                        </dd>
                      </div>
                      <div>
                        <dt>produced by</dt>
                        <dd>
                          {e.producedBy.length ? (
                            e.producedBy
                              .map((p) => `${p.producer} (${p.count})`)
                              .join(", ")
                          ) : (
                            <span className="wf-muted">
                              nothing has published this yet
                            </span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>consumed by</dt>
                        <dd>
                          {e.consumedBy.length ? (
                            e.consumedBy.map((c) => c.graphKey).join(", ")
                          ) : (
                            <span className="wf-muted">
                              nothing — a terminal event, which is normal
                            </span>
                          )}
                        </dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      className="wf-btn wf-btn--primary"
                      onClick={() => onPick(e)}
                    >
                      Use this trigger
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
          {events && shown.length === 0 ? (
            <p className="wf-empty">No event matches that.</p>
          ) : null}
        </div>

        <footer className="ec-foot">
          {!aliasesSupported ? (
            <p className="ge-muted ec-alias-note">
              Informal phrases per event ("intake done", "JD arrived") are not
              stored yet — the catalogue has no column for them, so searching
              matches the name and the sentence only.
            </p>
          ) : null}

          {!registering ? (
            <button
              type="button"
              className="wf-btn"
              onClick={() => setRegistering(true)}
            >
              Nothing fits? Register a new event
            </button>
          ) : (
            <div className="ec-register">
              <p className="ge-muted">
                A new event is a contract other teams build against, so this
                creates a <strong>draft</strong> and rides review.
              </p>
              <input
                className="ge-input"
                placeholder="module.entity.pastTenseFact"
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                aria-label="Event name"
              />
              <input
                className="ge-input"
                placeholder="One sentence: what has happened?"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                aria-label="Event description"
              />
              {registerError ? (
                <p className="nt-error">{registerError}</p>
              ) : null}
              <div className="ec-register-actions">
                <button
                  type="button"
                  className="wf-btn wf-btn--primary"
                  onClick={() => void submitDraft()}
                >
                  Register draft
                </button>
                <button
                  type="button"
                  className="wf-btn"
                  onClick={() => setRegistering(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </footer>
      </aside>
    </div>
  );
}
