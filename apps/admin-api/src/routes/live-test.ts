/**
 * Screen 5 — firing a real trigger event at a workflow.
 *
 * THERE IS NO DRY RUN, AND THAT IS DELIBERATE.
 *
 * A simulated run tells you the graph is well-formed, which the editor already
 * says. What nobody knows until it happens is whether SYNTRA answers, whether
 * the payload satisfies the first node's schema, and how long it takes. So
 * this fires a genuine event through the genuine front door.
 *
 * Which means: real database writes, real AI spend, a real human gate parking
 * a real run. The screen says so before the button, and this file refuses to
 * make it quieter.
 *
 * IT GOES THROUGH THE INGRESS, NOT AROUND IT. Writing to `event_outbox`
 * directly from here would be shorter and would skip envelope validation, the
 * outbox relay and the router — which are precisely the parts a test is meant
 * to exercise. A test that takes a different path from production tests the
 * path nobody uses.
 */
import type { Pool } from "pg";

import { EVENT_SCHEMAS, GRAPH_DEFINITIONS, GRAPH_EVENT_BINDINGS } from "../lib/authoring-views.js";
import { pinForTest, type TestPin } from "../lib/test-pin.js";
import { compileDraft } from "../lib/authoring-writes.js";
type FastifyLike = {
  get: (path: string, handler: (req: any, reply: any) => unknown) => unknown;
  post: (path: string, handler: (req: any, reply: any) => unknown) => unknown;
};

const ORCH_API = process.env.ORCH_API_URL ?? "http://localhost:4100";

/** Reasonable defaults per JSON Schema type, so a form starts filled in. */
function sampleFor(schema: any): unknown {
  if (schema?.enum?.length) return schema.enum[0];
  switch (schema?.type) {
    case "number":
    case "integer":
      return typeof schema.minimum === "number" ? schema.minimum : 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return schema?.format === "uuid"
        ? "00000000-0000-4000-8000-000000000000"
        : "";
  }
}

export function registerLiveTestRoutes(app: FastifyLike, pool: Pool): void {
  /**
   * What firing this workflow would need.
   *
   * The trigger comes from an active binding, or from the draft's own
   * `entryInput` when it has never gone live — the same fallback the editor
   * makes, and for the same reason: a draft binding cannot be stored.
   */
  app.get("/live-test/:graphKey", async (req: any, reply: any) => {
    const graphKey = String(req.params.graphKey ?? "");
    try {
      const { rows: defs } = await pool.query(
        `SELECT version, status, definition FROM ${GRAPH_DEFINITIONS}
          WHERE graph_key = $1
          ORDER BY (status = 'active') DESC, version DESC
          LIMIT 1`,
        [graphKey],
      );
      const def = defs[0];
      if (!def) {
        return reply.code(404).send({ error: "workflow_not_found", graphKey });
      }

      const { rows: bound } = await pool.query(
        `SELECT event_type FROM ${GRAPH_EVENT_BINDINGS}
          WHERE graph_key = $1 AND status = 'active'`,
        [graphKey],
      );
      /**
       * TWO NAMES FOR THE TRIGGER, AND THIS KNEW ONLY THE OLDER ONE.
       *
       * Screen 2 stores the author's chosen trigger on the draft as
       * `triggerEventType`; `entryInput` is what the agent-era definitions
       * used. `gate-evidence` has read both for a while — this had not caught
       * up, so a workflow authored on screen 2 arrived here looking as though
       * nobody had chosen a trigger at all, and the screen said exactly that
       * while the answer sat in the definition it had just loaded.
       */
      const chosen =
        (def.definition as any)?.triggerEventType ??
        (def.definition as any)?.entryInput ??
        null;
      const pending = chosen ? [String(chosen)] : [];
      const triggers: string[] = bound.length
        ? bound.map((b: any) => String(b.event_type))
        : pending;

      const eventType = triggers[0] ?? null;
      let payloadSchema: any = null;
      if (eventType) {
        const { rows } = await pool.query(
          `SELECT payload_schema FROM ${EVENT_SCHEMAS}
            WHERE event_type = $1 LIMIT 1`,
          [eventType],
        );
        payloadSchema = rows[0]?.payload_schema ?? null;
      }

      const properties = payloadSchema?.properties ?? {};
      const required: string[] = payloadSchema?.required ?? [];

      /**
       * WHICH OF THESE THE WORKFLOW ACTUALLY READS.
       *
       * `syntra.jd.normalized` declares ten fields; the first step of this
       * workflow takes `jobId` or `requirement_id`. Asking a person to
       * consider the other eight is asking them to do the schema's filing —
       * and every one of them arrived pre-filled with a placeholder that no
       * row in the database matches, so the form looked answered and was not.
       *
       * The first step is the one `__start__` points at, not `nodes[0]`: the
       * array is stored in whatever order it was built.
       */
      const nodes: any[] = def.definition?.nodes ?? [];
      const edges: any[] = def.definition?.edges ?? [];
      const startId = edges.find((e) => Array.isArray(e) && e[0] === "__start__")?.[1];
      const firstImpl = (nodes.find((n) => n.id === startId) ?? nodes[0])?.impl ?? null;
      let readByWorkflow = new Set<string>();
      if (firstImpl) {
        const { rows: nr } = await pool.query(
          `SELECT input_schema FROM authoring.node_registry WHERE key = $1 LIMIT 1`,
          [firstImpl],
        );
        readByWorkflow = new Set(
          Object.keys(nr[0]?.input_schema?.properties ?? {}),
        );
      }

      /**
       * A real payload to start from, rather than a shape.
       *
       * `sampleFor` returns `00000000-0000-4000-8000-000000000000` for every
       * uuid — a value that satisfies the format and matches nothing, so a run
       * fired from an untouched form fails on a requirement that does not
       * exist. Replaying a real one was already possible and was a thing the
       * author had to find; this makes it the starting point.
       *
       * Newest first, and its organisation comes with it — a payload is about
       * rows that belong to one tenant, and pairing it with a different one is
       * the same failure by another route.
       */
      const { rows: seedRows } = eventType
        ? await pool.query(
            `SELECT payload_ref, organization_id::text AS org, occurred_at
               FROM orch.event_outbox
              WHERE event_type = $1 AND payload_ref <> '{}'::jsonb
              ORDER BY id DESC LIMIT 1`,
            [eventType],
          )
        : { rows: [] as any[] };
      const { rows: aggRows } = eventType
        ? await pool.query(
            `SELECT aggregate_type, count(*)::int AS n
               FROM orch.event_outbox WHERE event_type = $1
              GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
            [eventType],
          )
        : { rows: [] as any[] };
      const aggregateType = aggRows[0]?.aggregate_type
        ? String(aggRows[0].aggregate_type)
        : null;

      const seed = seedRows[0]
        ? {
            payload: seedRows[0].payload_ref ?? {},
            organisationId: seedRows[0].org ?? null,
            occurredAt: seedRows[0].occurred_at,
          }
        : null;

      return {
        graphKey,
        version: def.version,
        status: def.status,
        /**
         * Load-bearing on screen. A draft has no binding, so firing its
         * trigger runs whatever IS bound to that event — which may be a
         * different workflow entirely. The screen has to say so.
         */
        triggerSource: bound.length ? "binding" : pending.length ? "draft" : "none",
        eventType,
        /** Null when the event has no schema row at all. */
        payloadDeclared: Object.keys(properties).length > 0,
        fields: Object.entries(properties).map(([name, s]: [string, any]) => ({
          name,
          type: s?.type ?? "string",
          format: s?.format ?? null,
          enum: s?.enum ?? null,
          description: s?.description ?? null,
          required: required.includes(name),
          sample: sampleFor(s),
          /** The first step's input schema names this. */
          usedByWorkflow: readByWorkflow.has(name),
        })),
        /** A real recent payload for this event, to start from. */
        seed,
        /**
         * What this event is ABOUT — `requirement`, `candidate`, `resume`.
         *
         * Read from real events of this type rather than declared anywhere:
         * `aggregate_type` is what producers actually stamp, and the majority
         * answer is the one worth offering. Null when nothing has ever been
         * published, in which case the screen has nothing to offer a picker
         * for and keeps the fields it had.
         */
        aggregateType,
        /**
         * The payload fields that NAME the subject, so picking one can fill
         * them.
         *
         * A uuid field the first step reads is an identifier by construction:
         * that is what `syntra.jd.process` takes, and `jobId` /
         * `requirement_id` are two names for the same one.
         */
        identifierFields: Object.entries(properties)
          .filter(
            ([name, sch]: [string, any]) =>
              readByWorkflow.has(name) && (sch?.format === "uuid" || /_?id$/i.test(name)),
          )
          .map(([name]) => name),
        steps: (def.definition?.nodes ?? []).map((n: any) => ({
          id: n.id,
          impl: n.impl,
        })),
      };
    } catch (err: any) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "live_test_load_failed", message: String(err) });
    }
  });

  /**
   * The organisations a run can belong to.
   *
   * Every fire needs one, and it used to be a box you typed a UUID into.
   * Nobody knows their organisation id by heart, so in practice that meant
   * going and looking it up, or pasting the same one out of habit without
   * checking it was still the right one.
   */
  /**
   * THE THING THE EVENT IS ABOUT, IN WORDS A PERSON RECOGNISES.
   *
   * The payload form asked for `requirement_id` as a uuid. Nobody knows a
   * requirement by `10a47180-080c-415f-8e90-8cf587108416`, so the only ways to
   * answer were to look one up elsewhere or to keep whatever a replayed event
   * happened to carry — and that second one is how a test ends up running
   * against a requirement the author never chose.
   *
   * Every event names its subject: `aggregate_type` is `requirement` for
   * `syntra.jd.normalized`, `candidate` for the profile events, and so on. So
   * the question is "which requirement", answered from the real table, and the
   * id fields are filled in from what was picked.
   *
   * An aggregate type with no source listed here returns an empty list rather
   * than an error, and the screen falls back to the fields it had.
   */
  app.get("/live-test/subjects/:aggregateType", async (req: any, reply: any) => {
    const aggregateType = String(req.params.aggregateType ?? "");
    const orgId = String(req.query?.organisationId ?? "").trim() || null;

    /**
     * One query per kind, written out rather than composed.
     *
     * A generic "select id and the first text column" would be shorter and
     * would silently pick the wrong column the first time a table changed.
     * These are the labels a person would actually recognise.
     */
    const SOURCES: Record<string, { sql: string; label: string }> = {
      requirement: {
        label: "requirement",
        sql: `SELECT id::text AS id,
                     coalesce(nullif(title, ''), 'untitled requirement') AS label,
                     coalesce(status, '') AS detail,
                     created_at
                FROM core.requirements
               WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
               ORDER BY created_at DESC NULLS LAST
               LIMIT 50`,
      },
      resume: {
        label: "resume",
        sql: `SELECT r.id::text AS id,
                     coalesce(nullif(r.current_role_title, ''),
                              nullif(r.primary_role, ''), 'resume') AS label,
                     coalesce(r.current_company, '') AS detail,
                     r.id AS created_at
                FROM core.resumes r
               WHERE ($1::uuid IS NULL OR r.org_id = $1::uuid)
                 AND r.is_current
               LIMIT 50`,
      },
    };

    const source = SOURCES[aggregateType];
    if (!source) return { aggregateType, subjects: [], supported: false };

    try {
      const { rows } = await pool.query(source.sql, [orgId]);
      return {
        aggregateType,
        supported: true,
        subjects: rows.map((r: any) => ({
          id: String(r.id),
          label: String(r.label),
          detail: String(r.detail ?? ""),
        })),
      };
    } catch (err: any) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "subjects_unavailable", message: String(err) });
    }
  });

  app.get("/live-test/organisations", async (_req: any, reply: any) => {
    try {
      /**
       * `platform.organizations`, qualified.
       *
       * This read `FROM organizations` unqualified, and the search_path is
       * `"$user", public, extensions` — no `platform`. So it threw
       * `relation "organizations" does not exist`, the endpoint answered 500,
       * and the screen rendered an empty dropdown next to the word "required".
       * A leftover from the old project, where the table was in `public`.
       */
      const { rows } = await pool.query(
        `SELECT id::text, name FROM platform.organizations
          WHERE deleted_at IS NULL
          ORDER BY name`,
      );
      return { organisations: rows };
    } catch (err: any) {
      return reply
        .code(500)
        .send({ error: "organisations_unavailable", message: String(err) });
    }
  });

  /**
   * Recent real events of this type, so a test can replay one.
   *
   * INVENTING AN EVENT IS THE WRONG SHAPE OF WORK.
   *
   * The form was generated from the event's schema and filled with samples,
   * which sounds helpful and is not: a string field samples to "", so you type
   * the title and the channel by hand, and every uuid field samples to the
   * same constant `00000000-…-000000000000`. Firing that at a live database
   * writes a run against an id that means nothing, and firing it twice writes
   * two runs against the same nothing.
   *
   * Meanwhile the outbox holds thousands of real ones. Picking a real payload
   * is less work than typing a fake one AND it exercises the shapes production
   * actually produces — the odd null, the field nobody documented, the title
   * with a quote in it.
   */
  app.get("/live-test/recent/:eventType", async (req: any, reply: any) => {
    const eventType = String(req.params.eventType ?? "");
    try {
      const { rows } = await pool.query(
        `SELECT event_id::text,
                organization_id::text,
                aggregate_type,
                aggregate_id::text,
                producer,
                occurred_at,
                payload_ref
           FROM orch.event_outbox
          WHERE event_type = $1
          ORDER BY id DESC
          LIMIT 10`,
        [eventType],
      );
      return {
        eventType,
        recent: rows.map((r: any) => ({
          eventId: r.event_id,
          organisationId: r.organization_id,
          aggregateType: r.aggregate_type,
          aggregateId: r.aggregate_id,
          producer: r.producer,
          occurredAt: r.occurred_at,
          payload: r.payload_ref ?? {},
        })),
      };
    } catch (err: any) {
      return reply
        .code(500)
        .send({ error: "recent_unavailable", message: String(err) });
    }
  });

  /**
   * Fire it.
   *
   * The envelope is built here rather than by the caller: event ids and
   * correlation are plumbing, and a screen that invents its own would be able
   * to get them wrong in ways nothing downstream could detect.
   */
  app.post("/live-test/fire", async (req: any, reply: any) => {
    const body = req.body ?? {};
    const eventType = String(body.eventType ?? "").trim();
    const organizationId = String(body.organizationId ?? "").trim();
    const payload = body.payload ?? {};

    if (!eventType) {
      return reply
        .code(400)
        .send({ error: "event_type_required", message: "Choose a trigger event." });
    }
    if (!organizationId) {
      return reply.code(400).send({
        error: "organization_required",
        message: "A run belongs to an organisation — choose one before firing.",
      });
    }

    /**
     * RUN WHAT IS ON SCREEN, NOT WHAT IS LIVE.
     *
     * Without a pin the router resolves the binding, and a binding names the
     * LIVE version — so testing an edit exercised the version already in
     * production, and a workflow that had never been live could not be tried
     * at all.
     *
     * The working copy is frozen first, because a run has to point at
     * something immutable: `orch.runs` records `graph_version`, and v4 must
     * mean one thing for ever. Unchanged since the last freeze, nothing new is
     * minted — see `pinForTest`.
     *
     * A failure here does NOT stop the fire. Pinning is what makes the test
     * accurate; refusing to fire because it could not be arranged would take
     * away the behaviour people have today, and the response says which of the
     * two happened.
     */
    let pin: TestPin | null = null;
    let pinNote: string | null = null;
    let pinnedVersion: number | null = null;
    const graphKey = String(body.graphKey ?? "").trim();
    if (graphKey) {
      try {
        const outcome = await pinForTest(pool, {
          graphKey,
          orgId: null,
          by: req.headers?.["x-actor"] ? String(req.headers["x-actor"]) : null,
          compileDraft: (a) => compileDraft(pool, a),
        });
        if (outcome.ok) {
          pin = outcome.pin;
          pinnedVersion = outcome.version;
          pinNote = outcome.compiled
            ? `Froze your working copy as v${outcome.version} and ran that.`
            : `Ran v${outcome.version}, which is what your working copy already is.`;
        } else {
          pinNote = `Ran whatever is bound — ${outcome.message}`;
        }
      } catch (err) {
        req.log?.error?.(err);
        pinNote = "Ran whatever is bound — the version could not be pinned.";
      }
    }

    const eventId = crypto.randomUUID();
    /**
     * THE SHAPE THE INGRESS ACTUALLY ASKS FOR.
     *
     * This sent `payload`, a flat `aggregate_type` / `aggregate_id`, and no
     * `causation_id` at all. The ingress wants `payload_ref`, a nested
     * `aggregate: { type, id }`, and a `causation_id` that is NULLABLE rather
     * than optional — so it must be present and may be null.
     *
     * Every fire was refused with 422 on those three fields, and the admin
     * reported it as "the payload does not match what the event declares",
     * which sent everybody to look at the payload. Nothing was ever wrong with
     * the payload. `orch.event_outbox` has zero rows from `admin.live-test`:
     * this screen had never once succeeded.
     *
     * `schema_version` is required too, and defaults where it is declared —
     * but only if the key exists, so it is sent explicitly.
     */
    const envelope = {
      event_id: eventId,
      event_type: eventType,
      schema_version: String(body.schemaVersion ?? "1.0"),
      organization_id: organizationId,
      /**
       * What the event is about. With a subject chosen on screen this is that
       * requirement or resume, so the envelope says the same thing the payload
       * does; without one it is a fresh id, which is what an event about
       * nothing in particular has always carried.
       */
      aggregate: {
        type: String(body.aggregateType ?? "requirement"),
        id: String(body.aggregateId ?? crypto.randomUUID()),
      },
      /** Nullable, not optional: nothing caused a fire somebody pressed. */
      causation_id: null,
      correlation_id: eventId,
      /**
       * Says where this came from, permanently and in the outbox row. Somebody
       * looking at a surprising run six weeks from now can see it was fired by
       * hand from the admin screen rather than by a real channel.
       */
      producer: "admin.live-test",
      occurred_at: new Date().toISOString(),
      payload_ref: payload,
      ...(pin ? { test_pin: pin } : {}),
    };

    try {
      const res = await fetch(`${ORCH_API}/v1/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      });
      const answer = (await res.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
        message?: string;
        details?: unknown;
      };

      if (!res.ok) {
        return reply.code(res.status === 422 ? 422 : 502).send({
          error: "ingress_refused",
          status: res.status,
          /**
           * Say which fields, not which half.
           *
           * This always blamed the payload, so three envelope faults sent
           * everybody to inspect a payload that was fine. The issue paths are
           * right there in the answer.
           */
          message:
            answer?.error === "invalid_envelope"
              ? `The ingress refused this event: ${
                  Array.isArray(answer?.details) && answer.details.length > 0
                    ? (answer.details as any[])
                        .map(
                          (i) =>
                            `${(i?.path ?? []).join(".") || "(root)"} — ${i?.message ?? "invalid"}`,
                        )
                        .join("; ")
                    : "it does not match the envelope the platform declares."
                }`
              : (answer?.message ?? `Ingress answered ${res.status}.`),
          details: answer?.details ?? null,
        });
      }

      return {
        eventId,
        accepted: answer?.status ?? "accepted",
        envelope,
        /**
         * Which version this run will actually use, and why.
         *
         * The screen has to say it. "Test" that silently ran the live version
         * was the whole fault; saying "ran v7, frozen just now" is what makes
         * the button honest.
         */
        ranVersion: pinnedVersion,
        pinned: Boolean(pin),
        pinNote,
      };
    } catch (err: any) {
      // The ingress being down is the most likely failure in dev, and it looks
      // nothing like a rejected payload. Say which it was.
      return reply.code(502).send({
        error: "ingress_unreachable",
        message:
          `Could not reach the ingress at ${ORCH_API}. Is it running? ` +
          `(${err?.message ?? String(err)})`,
      });
    }
  });

  /**
   * Has a run started yet?
   *
   * Firing is asynchronous — the event goes to the outbox, a relay publishes
   * it, the router resolves a binding, and only then does a run exist. The
   * screen polls this rather than pretending the run is immediate.
   */
  app.get("/live-test/started/:eventId", async (req: any, reply: any) => {
    const eventId = String(req.params.eventId ?? "");
    try {
      const { rows } = await pool.query(
        `SELECT id, graph_key, status, started_at
           FROM orch.runs
          WHERE trigger_event_id::text = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [eventId],
      );
      const run = rows[0];
      if (run) {
        return {
          state: "running",
          runId: String(run.id),
          graphKey: run.graph_key,
          status: run.status,
        };
      }

      // No run. Either it has not been routed yet, or nothing was listening.
      const { rows: out } = await pool.query(
        `SELECT published_at FROM orch.event_outbox WHERE event_id::text = $1 LIMIT 1`,
        [eventId],
      );
      if (out.length === 0) return { state: "unknown" };
      return { state: out[0].published_at ? "published" : "queued" };
    } catch (err: any) {
      return reply
        .code(500)
        .send({ error: "started_check_failed", message: String(err) });
    }
  });
}
