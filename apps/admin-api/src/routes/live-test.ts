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
        `SELECT version, status, definition FROM graph_definitions
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
        `SELECT event_type FROM graph_event_bindings
          WHERE graph_key = $1 AND status = 'active'`,
        [graphKey],
      );
      const pending = def.definition?.entryInput
        ? [String(def.definition.entryInput)]
        : [];
      const triggers: string[] = bound.length
        ? bound.map((b: any) => String(b.event_type))
        : pending;

      const eventType = triggers[0] ?? null;
      let payloadSchema: any = null;
      if (eventType) {
        const { rows } = await pool.query(
          `SELECT payload_schema FROM event_schemas
            WHERE event_type = $1 LIMIT 1`,
          [eventType],
        );
        payloadSchema = rows[0]?.payload_schema ?? null;
      }

      const properties = payloadSchema?.properties ?? {};
      const required: string[] = payloadSchema?.required ?? [];

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
        })),
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
  app.get("/live-test/organisations", async (_req: any, reply: any) => {
    try {
      const { rows } = await pool.query(
        `SELECT id::text, name FROM organizations
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
           FROM event_outbox
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

    const eventId = crypto.randomUUID();
    const envelope = {
      event_id: eventId,
      event_type: eventType,
      organization_id: organizationId,
      aggregate_type: String(body.aggregateType ?? "requirement"),
      aggregate_id: String(body.aggregateId ?? crypto.randomUUID()),
      correlation_id: eventId,
      /**
       * Says where this came from, permanently and in the outbox row. Somebody
       * looking at a surprising run six weeks from now can see it was fired by
       * hand from the admin screen rather than by a real channel.
       */
      producer: "admin.live-test",
      occurred_at: new Date().toISOString(),
      payload,
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
          message:
            answer?.error === "invalid_envelope"
              ? "The ingress refused this event — the payload does not match what the event declares."
              : (answer?.message ?? `Ingress answered ${res.status}.`),
          details: answer?.details ?? null,
        });
      }

      return { eventId, accepted: answer?.status ?? "accepted", envelope };
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
        `SELECT published_at FROM event_outbox WHERE event_id::text = $1 LIMIT 1`,
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
