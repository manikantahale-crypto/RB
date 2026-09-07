/**
 * Screen 5 — fire a real trigger event at a workflow.
 *
 * THERE IS NO DRY RUN. The editor already tells you a graph is well-formed;
 * what nobody knows until it happens is whether SYNTRA answers, whether the
 * payload satisfies the first step's schema, and how long it takes. So this
 * fires a genuine event through the genuine front door.
 *
 * Which means real database writes, real AI spend, and a real human gate
 * parking a real run. The whole design of this screen is: say that plainly
 * BEFORE the button, not in a toast afterwards.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  checkStarted,
  fireTestEvent,
  loadLiveTestPlan,
  type LiveTestField,
  type LiveTestPlan,
} from "../api/live-test";

/** Same shape the payload will take, kept as text so a person can edit it. */
type Draft = Record<string, string>;

function initialDraft(fields: LiveTestField[]): Draft {
  const d: Draft = {};
  for (const f of fields) {
    d[f.name] =
      typeof f.sample === "object" ? JSON.stringify(f.sample) : String(f.sample ?? "");
  }
  return d;
}

/**
 * Text back into the type the schema asked for.
 *
 * Deliberately forgiving: a number field left as "" is omitted rather than
 * sent as 0, because a zero somebody did not type is worse than a missing
 * field the ingress will name.
 */
function coerce(field: LiveTestField, raw: string): unknown | undefined {
  const text = raw.trim();
  if (text === "") return undefined;
  if (field.type === "number" || field.type === "integer") {
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  if (field.type === "boolean") return text === "true";
  if (field.type === "array" || field.type === "object") {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export function LiveTestPage() {
  const { graphKey = "" } = useParams();
  const navigate = useNavigate();

  const [plan, setPlan] = useState<LiveTestPlan | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [firing, setFiring] = useState(false);
  const [firedEventId, setFiredEventId] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string>("");
  /** Typed confirmation. A button alone is too easy to press by accident. */
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await loadLiveTestPlan(graphKey);
      if (!live) return;
      if (res.ok) {
        setPlan(res.data);
        setDraft(initialDraft(res.data.fields));
      } else {
        setError(res.body.message ?? res.body.error ?? "Could not load");
      }
    })();
    return () => {
      live = false;
    };
  }, [graphKey]);

  const missing = useMemo(
    () =>
      (plan?.fields ?? [])
        .filter((f) => f.required && (draft[f.name] ?? "").trim() === "")
        .map((f) => f.name),
    [plan, draft],
  );

  /**
   * Wait for the run to exist.
   *
   * Firing is asynchronous: outbox → relay → router → run. Polling is honest
   * about that rather than pretending the run is immediate and landing on a
   * 404. It gives up after a while rather than spinning forever — an event
   * that never routes is a real answer, and the trace page is where that gets
   * diagnosed.
   */
  const followRun = useCallback(
    async (eventId: string) => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const res = await checkStarted(eventId);
        if (res.ok && res.data.state === "running") {
          navigate(`/runs/${res.data.runId}?test=1`);
          return;
        }
        setWaiting(
          res.ok && res.data.state === "unknown"
            ? "The event has not reached the outbox yet…"
            : "Accepted. Waiting for a run to start…",
        );
        await new Promise((r) => setTimeout(r, 1000));
      }
      setWaiting("");
      setError(
        "The event was accepted but no run started within 30 seconds. " +
          "Either nothing is bound to this event, or the worker is not running.",
      );
    },
    [navigate],
  );

  const fire = async () => {
    if (!plan?.eventType) return;
    setFiring(true);
    setError(null);

    const payload: Record<string, unknown> = {};
    for (const f of plan.fields) {
      const v = coerce(f, draft[f.name] ?? "");
      if (v !== undefined) payload[f.name] = v;
    }

    const res = await fireTestEvent({
      eventType: plan.eventType,
      organizationId: orgId.trim(),
      payload,
    });
    setFiring(false);

    if (!res.ok) {
      setError(res.body.message ?? res.body.error ?? "Could not fire");
      return;
    }
    setFiredEventId(res.data.eventId);
    setWaiting("Accepted. Waiting for a run to start…");
    void followRun(res.data.eventId);
  };

  const ready =
    Boolean(plan?.eventType) &&
    orgId.trim() !== "" &&
    missing.length === 0 &&
    confirm.trim().toUpperCase() === "RUN IT" &&
    !firing &&
    !firedEventId;

  return (
    <div className="lt-page" data-testid="live-test">
      <header className="lt-head">
        <div>
          <p className="lt-crumb">
            <Link to="/workflows" className="run-back">
              ← All workflows
            </Link>
          </p>
          <h1 className="lt-title">Test {graphKey}</h1>
        </div>
        {plan ? (
          <span className="lt-version">
            v{plan.version} · {plan.status}
          </span>
        ) : null}
      </header>

      {error ? (
        <div className="lt-error" role="alert">
          {error}
        </div>
      ) : null}

      {!plan ? (
        <p className="ge-muted">Loading…</p>
      ) : plan.triggerSource === "none" ? (
        <div className="lt-error" role="status">
          Nothing can start this workflow yet — no trigger is bound and none is
          chosen. Pick one in the editor first.
        </div>
      ) : (
        <>
          {/* ── what this is about to do ───────────────────────────────
              First, largest, and unavoidable. Every other screen in this
              admin edits drafts; this one is the only one that reaches
              production, and reading it must feel different. */}
          <section className="lt-warn" role="alert">
            <h2 className="lt-warn-title">This runs for real</h2>
            <ul className="lt-warn-list">
              <li>
                A genuine <code>{plan.eventType}</code> event goes through the
                same front door SYNTRA uses.
              </li>
              <li>
                The workflow writes to the live database, calls real services,
                and spends real AI budget.
              </li>
              <li>
                A step that pauses for a person will park a real run that
                somebody has to answer.
              </li>
              <li>There is no undo, and no dry run.</li>
            </ul>
            {plan.triggerSource === "draft" ? (
              <p className="lt-warn-draft">
                <strong>This draft is not bound to anything.</strong> Firing{" "}
                <code>{plan.eventType}</code> will run whatever workflow IS
                bound to that event — which may not be this one.
              </p>
            ) : null}
          </section>

          <section className="lt-block">
            <h2 className="lt-block-title">What will run</h2>
            <p className="lt-steps">
              {plan.steps.map((s) => s.id).join(" → ") || "no steps"}
            </p>
            <p className="ge-muted">
              started by <code>{plan.eventType}</code>
              {plan.triggerSource === "binding" ? " · bound" : " · draft"}
            </p>
          </section>

          <section className="lt-block">
            <h2 className="lt-block-title">The event</h2>

            <label className="lt-field">
              <span className="lt-field-name">
                organisation <span className="lt-req">required</span>
              </span>
              <input
                className="ge-input"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                placeholder="organisation id this run belongs to"
              />
              <span className="lt-field-why">
                Every run belongs to one organisation, and its data is written
                against that one.
              </span>
            </label>

            {!plan.payloadDeclared ? (
              /*
                Eight event schemas hold a permissive placeholder written at
                boot so ingress can accept an event nobody has described. There
                is no form to generate from one, and pretending otherwise would
                show an empty box with no explanation.
              */
              <p className="lt-undeclared">
                <code>{plan.eventType}</code> does not describe what it carries,
                so there is no form to fill in. It will be fired with an empty
                payload. Describing it in the event catalogue is what would make
                this useful.
              </p>
            ) : (
              plan.fields.map((f) => (
                <label className="lt-field" key={f.name}>
                  <span className="lt-field-name">
                    {f.name}
                    {f.required ? <span className="lt-req">required</span> : null}
                    <span className="lt-type">
                      {f.type}
                      {f.format ? ` · ${f.format}` : ""}
                    </span>
                  </span>
                  {f.enum?.length ? (
                    <select
                      className="ge-input"
                      value={draft[f.name] ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, [f.name]: e.target.value })
                      }
                    >
                      {f.enum.map((v) => (
                        <option key={String(v)} value={String(v)}>
                          {String(v)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="ge-input"
                      value={draft[f.name] ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, [f.name]: e.target.value })
                      }
                    />
                  )}
                  {f.description ? (
                    <span className="lt-field-why">{f.description}</span>
                  ) : null}
                </label>
              ))
            )}
          </section>

          <section className="lt-block">
            <h2 className="lt-block-title">Fire it</h2>
            {missing.length > 0 ? (
              <p className="lt-missing">
                Still needed: {missing.join(", ")}
              </p>
            ) : null}
            <label className="lt-field">
              <span className="lt-field-name">
                type <code>RUN IT</code> to confirm
              </span>
              <input
                className="ge-input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="RUN IT"
                aria-label="Type RUN IT to confirm"
              />
              <span className="lt-field-why">
                Typing it is the point — a button on its own is too easy to
                press while reading something else.
              </span>
            </label>

            <div className="lt-actions">
              <button
                type="button"
                className="wf-btn wf-btn--primary"
                disabled={!ready}
                onClick={() => void fire()}
                data-testid="lt-fire"
              >
                {firing ? "Firing…" : "Fire the event"}
              </button>
              {waiting ? <span className="lt-waiting">{waiting}</span> : null}
            </div>

            {firedEventId ? (
              <p className="ge-muted lt-fired">
                event <code>{firedEventId}</code> ·{" "}
                <Link to={`/runs?event=${firedEventId}`}>find it later</Link>
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
