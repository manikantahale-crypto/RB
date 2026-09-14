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
import { listWorkflows, type WorkflowRegistryRow } from "../api";
import { LifecycleCell, type LifecycleCall } from "../lib/workflow-lifecycle";
import {
  checkStarted,
  fireTestEvent,
  loadLiveTestPlan,
  loadOrganisations,
  loadRecentEvents,
  loadSubjects,
  type LiveTestField,
  type LiveTestPlan,
  type Organisation,
  type RecentEvent,
  type TestSubject,
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
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [recent, setRecent] = useState<RecentEvent[]>([]);
  /** Which real event was copied in, so the screen can say the form is not invented. */
  const [replayed, setReplayed] = useState<RecentEvent | null>(null);
  /** What the server did about the version, in its own words. */
  const [ranNote, setRanNote] = useState<string | null>(null);
  /** Open only when the answer has to be asked for. */
  const [orgOpen, setOrgOpen] = useState(false);
  /** Where the run got to, shown here rather than on a page you were sent to. */
  const [outcome, setOutcome] = useState<{ runId: string; status: string } | null>(
    null,
  );
  /** Real rows of the kind this event is about, by name rather than by uuid. */
  const [subjects, setSubjects] = useState<TestSubject[]>([]);
  const [subjectId, setSubjectId] = useState("");

  /**
   * THE WAY OUT OF HERE IS ASKING FOR APPROVAL, SO IT LIVES HERE.
   *
   * It used to be two presses in the editor — "Compile draft", then "Request".
   * That put the decision on the screen where you write the thing rather than
   * the one where you watch it work, and it made an author name a mechanism
   * (compiling) that means nothing to them.
   *
   * Testing is not compulsory. Passing through the screen that offers it is:
   * the button is here, next to the run you just fired and whatever it did.
   */
  const [registryRow, setRegistryRow] = useState<WorkflowRegistryRow | null>(null);
  const [acting, setActing] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const refreshRow = useCallback(async () => {
    const list = await listWorkflows();
    if (list.ok) {
      setRegistryRow(
        list.data.workflows.find((w) => w.graphKey === graphKey) ?? null,
      );
    }
  }, [graphKey]);

  useEffect(() => {
    void refreshRow();
  }, [refreshRow]);

  const runLifecycle = async (call: LifecycleCall) => {
    setActing(true);
    setSaid(null);
    try {
      const res = await call(graphKey);
      setSaid(
        res.ok
          ? (res.data.note ?? "Done.")
          : (res.body.message ?? res.body.error ?? "That did not work."),
      );
      await refreshRow();
    } finally {
      setActing(false);
    }
  };

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await loadLiveTestPlan(graphKey);
      if (!live) return;
      if (res.ok) {
        setPlan(res.data);
        /**
         * START FROM A REAL PAYLOAD, NOT A SHAPE.
         *
         * `initialDraft` fills from each field's `sample`, which is
         * `00000000-0000-4000-8000-000000000000` for every uuid — the right
         * format and no matching row, so an untouched form looked complete and
         * failed on a requirement that does not exist. Replaying a real event
         * was already possible; it was just something you had to go and find.
         *
         * The organisation comes with it. A payload names rows belonging to
         * one tenant, and firing it against another is the same failure by a
         * different route.
         */
        const seeded = res.data.seed
          ? {
              ...initialDraft(res.data.fields),
              ...Object.fromEntries(
                Object.entries(res.data.seed.payload).map(([k, v]) => [
                  k,
                  typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? ""),
                ]),
              ),
            }
          : initialDraft(res.data.fields);
        setDraft(seeded);
        if (res.data.seed?.organisationId) setOrgId(res.data.seed.organisationId);
        /**
         * Real events of this type, for replaying instead of inventing one.
         * Failing to load them is not an error worth showing — the form still
         * works, it is just back to being typed by hand.
         */
        if (res.data.eventType) {
          const r = await loadRecentEvents(res.data.eventType);
          if (live && r.ok) setRecent(r.data.recent);
        }
      } else {
        setError(res.body.message ?? res.body.error ?? "Could not load");
      }
    })();
    return () => {
      live = false;
    };
  }, [graphKey]);

  /**
   * The things this event could be about, by name.
   *
   * Scoped to the organisation, because a requirement belongs to one tenant
   * and offering another's would produce a run against rows the author cannot
   * see.
   */
  useEffect(() => {
    let live = true;
    if (!plan?.aggregateType) return;
    void (async () => {
      const res = await loadSubjects(plan.aggregateType!, orgId || undefined);
      if (live && res.ok) setSubjects(res.data.subjects);
    })();
    return () => {
      live = false;
    };
  }, [plan?.aggregateType, orgId]);

  /**
   * Picking a subject rewrites the payload, and CLEARS what the old one carried.
   *
   * The form was seeded from the newest real event, whose extra fields describe
   * ITS subject — a parser version, a confidence score, a source event id. Keep
   * those while changing the requirement and every one of them becomes a claim
   * about the wrong thing. `astra-intelligence-v1` on a run for a requirement
   * ASTRA never touched is the shape of that, and ASTRA is not even in this
   * project any more.
   *
   * So: the identifiers get the chosen id, `title` gets its name if the event
   * declares one, and everything else goes back to empty. A thin payload that
   * is true beats a full one that is borrowed.
   */
  const pickSubject = (id: string) => {
    setSubjectId(id);
    setReplayed(null);
    if (!plan) return;
    const chosen = subjects.find((x) => x.id === id);
    const next: Draft = {};
    for (const f of plan.fields) {
      if (plan.identifierFields.includes(f.name)) next[f.name] = id;
      else if (f.name === "title" && chosen) next[f.name] = chosen.label;
      else next[f.name] = "";
    }
    setDraft(next);
  };

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await loadOrganisations();
      if (live && res.ok) setOrgs(res.data.organisations);
    })();
    return () => {
      live = false;
    };
  }, []);

  /**
   * Copy a real event into the form.
   *
   * Its organisation comes too. An event's payload belongs to the
   * organisation it happened in, and replaying it against a different one
   * would write a run whose data refers to rows in somebody else's.
   */
  const replay = useCallback(
    (ev: RecentEvent) => {
      setOrgId(ev.organisationId);
      setDraft(
        Object.fromEntries(
          Object.entries(ev.payload).map(([k, v]) => [
            k,
            typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? ""),
          ]),
        ),
      );
      setReplayed(ev);
    },
    [],
  );

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
  /**
   * STAY ON THIS SCREEN. IT USED TO WALK OFF THE MOMENT A RUN APPEARED.
   *
   * `navigate('/runs/<id>')` made sense while testing was a dead end. It is
   * now the step before asking for approval, and the button for that lives
   * here — so jumping to the runs list left people on a page with the run they
   * wanted and no way forward, having to find the workflow again.
   *
   * The run is followed to a CONCLUSION rather than to a start, because
   * "a run began" is not the answer anybody came for. The full detail is one
   * link away for when it is.
   */
  const followRun = useCallback(
    async (eventId: string) => {
      for (let attempt = 0; attempt < 45; attempt += 1) {
        const res = await checkStarted(eventId);
        if (res.ok && res.data.state === "running") {
          setOutcome({ runId: res.data.runId, status: res.data.status });
          // RUNNING is the only non-final answer; everything else is where it
          // got to, including parked at a human gate.
          if (String(res.data.status).toUpperCase() !== "RUNNING") {
            setWaiting("");
            // Testing compiled a version, so what the workflow can do next has
            // changed — the header's button has to catch up.
            await refreshRow();
            return;
          }
          setWaiting("Running…");
        } else {
          setWaiting(
            res.ok && res.data.state === "unknown"
              ? "The event has not reached the outbox yet…"
              : "Accepted. Waiting for a run to start…",
          );
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      setWaiting("");
      setError(
        "The event was accepted but no run finished within 45 seconds. " +
          "Either nothing is bound to this event, or the worker is not running.",
      );
    },
    [refreshRow],
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
      /*
        Without this the router answers with the BINDING, which names the live
        version — so testing an edit ran what is already in production. Naming
        the workflow is what lets the server freeze the working copy and pin
        the run to it.
      */
      graphKey,
      /*
        The envelope's subject, which the picker now knows. Without this the
        aggregate was a fresh uuid every time — an event claiming to be about
        something that does not exist, beside a payload naming something that
        does.
      */
      ...(plan.aggregateType ? { aggregateType: plan.aggregateType } : {}),
      ...(subjectId ? { aggregateId: subjectId } : {}),
    });
    setFiring(false);

    if (!res.ok) {
      setError(res.body.message ?? res.body.error ?? "Could not fire");
      return;
    }
    setFiredEventId(res.data.eventId);
    setOutcome(null);
    /**
     * Which version this is actually exercising, said before anything else.
     *
     * "Test" silently running the live version was the fault; a run that does
     * not say what it ran would only move the same problem one screen along.
     */
    setRanNote(res.data.pinNote);
    setWaiting(
      res.data.ranVersion != null
        ? `Accepted — running v${res.data.ranVersion}. Waiting for the run to start…`
        : "Accepted. Waiting for a run to start…",
    );
    void followRun(res.data.eventId);
  };

  /**
   * The fields worth a person's attention, and the rest.
   *
   * Required always shows — the event insists on it. `usedByWorkflow` shows
   * because it is what the first step reads, and therefore what decides
   * whether this run does anything.
   *
   * If nothing is marked — an undeclared first step, or a registry that has
   * not been materialised — everything shows. A fold that hides all of it
   * because the platform could not work out what mattered would be worse than
   * the long form it replaced.
   */
  /**
   * Can the subject be picked by name, or must the ids be typed?
   *
   * Both halves are needed: a kind this platform can list, and payload fields
   * that name it. Without either the form stays as it was — a picker that
   * cannot fill anything in would be a control that does nothing.
   */
  const usePicker =
    subjects.length > 0 && (plan?.identifierFields.length ?? 0) > 0;

  const shown = useMemo(() => {
    const fields = plan?.fields ?? [];
    const ids = new Set(usePicker ? (plan?.identifierFields ?? []) : []);
    const interesting = fields.filter(
      (f) => (f.required || f.usedByWorkflow) && !ids.has(f.name),
    );
    // Nothing left to type is the good case, not a broken form: the picker
    // above answered all of it.
    if (interesting.length > 0) return interesting;
    return ids.size > 0 ? [] : fields;
  }, [plan, usePicker]);
  const hidden = useMemo(
    () => (plan?.fields ?? []).filter((f) => !shown.includes(f)),
    [plan, shown],
  );

  const orgName = useMemo(
    () => orgs.find((o) => o.id === orgId)?.name ?? null,
    [orgs, orgId],
  );

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
            {/*
              One way back, to the workflow you came from. You arrive here from
              the editor with a draft open, so that is the only place "back"
              can sensibly mean — and the registry is one more step from there
              for anyone who wants it.
            */}
            <Link
              to={`/workflows/${encodeURIComponent(graphKey)}/edit`}
              className="run-back"
            >
              ← Back to {graphKey}
            </Link>
          </p>
          <h1 className="lt-title">Test {graphKey}</h1>
        </div>
        <div className="lt-head-actions">
          {plan ? (
            <span className="lt-version">
              v{plan.version} · {plan.status}
            </span>
          ) : null}
          {registryRow ? (
            <LifecycleCell
              row={registryRow}
              busy={acting}
              /*
                Sending opens the review panel instead of sending. Everything
                else — Withdraw — still acts immediately, because taking back
                your own request needs no second look.
              */
              /*
                Raising a request is its own screen, not a panel that unfolds
                here. It is a distinct act with its own content — the diff, the
                checks, what this version has already done — and a section
                appearing under a button reads as a confirmation rather than a
                decision.
              */
              onAct={(_key, call, id) => {
                if (id === "send") {
                  navigate(`/workflows/${encodeURIComponent(graphKey)}/request`);
                  return;
                }
                void runLifecycle(call);
              }}
              /*
                Sending is this screen's job; approving is not. The two-person
                rule is a database constraint, so offering Approve to whoever
                just pressed Send is offering a button that is refused. A
                second person reviews it on the Go-live screen.
              */
              skip={["approve"]}
              emptyLabel="nothing to request"
              /*
                The reason line is for a screen deciding between states. Here
                there is one button about one workflow, and "there are edits
                nobody has been asked about" only restates its label.
              */
              showWhy={false}
            />
          ) : null}
        </div>
      </header>

      {/* What the server said, in its own words — it explains its refusals. */}
      {said ? (
        <div className="lt-error" role="status">
          {said}
        </div>
      ) : null}

      {/*
        Which version ran, and why that one. A test that does not say what it
        exercised is the fault this screen just stopped having.
      */}
      {ranNote ? (
        <div className="lt-error" role="status">
          {ranNote}
        </div>
      ) : null}

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

          <div className="lt-split">
            <div className="lt-main">
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

{/* ── answered, not asked ──────────────────────────────────────
                    An organisation properly belongs to whoever is signed in,
                    not to a question on a form. Nothing here knows that yet —
                    the admin has no session and the event envelope carries no
                    actor — so the next best thing is to answer it from the
                    event being replayed and let it be changed, rather than
                    present a blank marked "required".

                    Shown as a fact with a way in, and it only becomes a
                    question when there is nothing to answer it with. */}
                {orgId && !orgOpen ? (
                  <p className="lt-answered">
                    Running as <strong>{orgName ?? orgId}</strong>
                    {plan.seed ? ", from the event being replayed" : ""}.{" "}
                    <button
                      type="button"
                      className="lt-inline-change"
                      onClick={() => setOrgOpen(true)}
                    >
                      change
                    </button>
                  </p>
                ) : (
                  <label className="lt-field">
                    <span className="lt-field-name">
                      organisation <span className="lt-req">required</span>
                    </span>
                    <select
                      className="wf-select"
                      value={orgId}
                      onChange={(e) => {
                        setOrgId(e.target.value);
                        if (e.target.value) setOrgOpen(false);
                      }}
                    >
                      <option value="">choose an organisation…</option>
                      {orgs.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    <span className="lt-field-why">
                      Every run belongs to one organisation, and its data is
                      written against that one.
                    </span>
                  </label>
                )}

                {/* ── which one, by name ──────────────────────────────────
                    The payload asked for `requirement_id` as a uuid, beside a
                    `jobId` that is the same value under another name. Neither
                    is something a person knows or can check, so the only ways
                    to answer were to look one up elsewhere or to keep whatever
                    a replayed event carried — which runs the test against
                    something nobody chose. */}
                {usePicker ? (
                  <label className="lt-field">
                    <span className="lt-field-name">
                      which {plan.aggregateType}
                      <span className="lt-req">required</span>
                    </span>
                    <select
                      className="wf-select"
                      value={subjectId}
                      onChange={(e) => pickSubject(e.target.value)}
                    >
                      <option value="">choose a {plan.aggregateType}…</option>
                      {subjects.map((sub) => (
                        <option key={sub.id} value={sub.id}>
                          {sub.label}
                          {sub.detail ? ` · ${sub.detail}` : ""}
                        </option>
                      ))}
                    </select>
                    <span className="lt-field-why">
                      Fills in {plan.identifierFields.join(" and ")}. The run
                      happens against this one.
                    </span>
                  </label>
                ) : null}

                {/* ── replay something real ──────────────────────────────
                    The generated form fills a string field with "" and every
                    uuid field with the same constant, so inventing an event is
                    both more typing and less realistic than copying one
                    production already produced. */}
                {recent.length > 0 ? (
                  <div className="lt-replay">
                    <span className="lt-field-name">
                      replay a real one
                      <span className="lt-type">{recent.length} recent</span>
                    </span>
                    <select
                      className="wf-select"
                      value={replayed?.eventId ?? ""}
                      onChange={(e) => {
                        const ev = recent.find((r) => r.eventId === e.target.value);
                        if (ev) replay(ev);
                      }}
                    >
                      <option value="">start from a blank form…</option>
                      {recent.map((r) => (
                        <option key={r.eventId} value={r.eventId}>
                          {new Date(r.occurredAt).toLocaleString()} · {r.producer} ·{" "}
                          {r.aggregateId.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                    <span className="lt-field-why">
                      {replayed
                        ? `Copied from a real event fired by ${replayed.producer}. Every field below came from it — change what you want before firing.`
                        : "Copies a real payload from the outbox, and the organisation it belonged to. Better data than anything a blank form would suggest."}
                    </span>
                  </div>
                ) : null}

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
                  <div className="lt-fields">
                  {shown.map((f) => (
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
                  ))}
                  </div>
                )}

                {/*
                  THE REST OF THE EVENT — CARRIED, NOT ASKED FOR.

                  `syntra.jd.normalized` declares ten fields; this workflow's
                  first step reads two. The other eight are things the SYSTEM
                  decides when it publishes the event — a parser version, a
                  confidence score, whether the requirement was actionable.
                  Nobody testing a workflow has an opinion about a parser
                  version, and offering a box invites inventing one.

                  So they are shown, and they are not editable. They come from
                  the real event being replayed and travel with the payload, so
                  what runs still looks like something SYNTRA would send —
                  which is the point of replaying rather than composing.
                */}
                {hidden.length > 0 ? (
                  <details className="lt-more">
                    <summary>
                      {hidden.length} more field
                      {hidden.length === 1 ? "" : "s"} the system fills in
                    </summary>
                    <dl className="lt-carried">
                      {hidden.map((f) => (
                        <div className="lt-carried-row" key={f.name}>
                          <dt>{f.name}</dt>
                          <dd>
                            {draft[f.name] ? (
                              <code>{draft[f.name]}</code>
                            ) : (
                              <span className="lt-carried-empty">not set</span>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="lt-field-why">
                      Taken from the event being replayed and sent as they are.
                      Pick a different event above to change them.
                    </p>
                  </details>
                ) : null}
              </section>
            </div>

            <div className="lt-side">
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

                {/*
                  WHERE IT GOT TO, HERE.

                  This screen used to jump to the run as soon as one started,
                  which answered "did a run begin" — not the question anybody
                  fires an event to ask. And since asking for approval happens
                  on THIS page, leaving it stranded you with the run you wanted
                  and no way onward.

                  So: the outcome in place, the detail one link away, and the
                  next step still in the header where it was.
                */}
                {outcome ? (
                  <div
                    className={`lt-outcome lt-outcome--${outcome.status.toLowerCase()}`}
                    role="status"
                  >
                    <p className="lt-outcome-what">
                      <strong>{outcome.status}</strong>
                      {outcome.status.toUpperCase() === "COMPLETED"
                        ? " — it ran all the way through."
                        : outcome.status.toUpperCase() === "FAILED"
                          ? " — open the run to see which step, and why."
                          : outcome.status.toUpperCase() === "WAITING_APPROVAL" ||
                              outcome.status.toUpperCase() === "PARKED"
                            ? " — it is waiting for a person."
                            : ""}
                    </p>
                    <p className="lt-outcome-links">
                      <Link to={`/runs/${outcome.runId}`}>
                        Open this run
                      </Link>
                      {" · "}
                      <Link to={`/workflows/${encodeURIComponent(graphKey)}/edit`}>
                        Back to the editor
                      </Link>
                    </p>
                    {/*
                      What to do next, and it changes once you have done it.
                      Telling somebody to send for approval after they already
                      have is the same staleness as a button that cannot work.
                    */}
                    {registryRow?.lifecycle.pendingVersion != null ? (
                      <p className="lt-field-why">
                        v{registryRow.lifecycle.pendingVersion} is waiting for
                        somebody else to approve it —{" "}
                        <Link to="/go-live-requests">see it on Go-live</Link>.
                      </p>
                    ) : (
                      <p className="lt-field-why">
                        Happy with it? Raise the approval request, at the top
                        of this page.
                      </p>
                    )}
                  </div>
                ) : null}

                {firedEventId ? (
                  <p className="ge-muted lt-fired">
                    event <code>{firedEventId}</code> ·{" "}
                    <Link to={`/runs?event=${firedEventId}`}>find it later</Link>
                  </p>
                ) : null}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
