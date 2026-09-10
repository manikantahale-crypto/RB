/**
 * Screen 3 — the event catalogue drawer.
 *
 * Opens from a trigger chip. It is a drawer, not a page: you arrive at it in
 * the middle of doing something else and leave with one event chosen.
 *
 * ONE HAND-WRITTEN SENTENCE, EVERYTHING ELSE DERIVED.
 * The description is the only prose a person maintains, and it earns its keep
 * twice — a human browsing picks by it, and the AI matching a plain-English
 * request matches against it. Producers and consumers are computed:
 *
 *   produced by  — who has actually published it, from the outbox
 *   consumed by  — which workflows answer it, from the active bindings
 *
 * Neither can go stale, because neither is written down anywhere. A catalogue
 * that claims "consumed by syntra.jd.workflow" because someone typed that in
 * 2026 is worse than one that says nothing.
 *
 * ALIASES ARE MISSING. The spec wants informal phrases per event ("intake
 * done", "JD arrived") alongside the description, and `event_schemas` has no
 * column for them. Reported as an empty list rather than faked, and flagged in
 * the response so the UI can say so.
 */
import { registerEvent } from "@tekisho/authoring";
import type { Pool } from "pg";
import { withOrgScope } from "../with-org-scope.js";

import { EVENT_SCHEMAS, GRAPH_EVENT_BINDINGS } from "../lib/authoring-views.js";
type FastifyLike = {
  get: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
};

function readOrgId(headers: Record<string, unknown>): string | null {
  const raw = headers["x-org-id"];
  if (raw === undefined || raw === null || raw === "" || raw === "~global~") {
    return null;
  }
  return String(raw);
}

export type CatalogEvent = {
  eventType: string;
  module: string;
  entity: string;
  /** The one hand-written sentence. */
  description: string;
  /** Informal phrases. Always empty today — no column exists for them. */
  aliases: string[];
  payloadSchema: unknown;
  producedWhen: string | null;
  status: string;
  /** Derived: who has actually published this, and how often. */
  producedBy: Array<{ producer: string; count: number }>;
  /** Derived: which workflows answer it right now. */
  consumedBy: Array<{ graphKey: string; moduleQueue: string | null }>;
  /** Derived: has anything ever published it? */
  everPublished: boolean;
};

export function registerEventCatalogRoutes(app: FastifyLike, pool: Pool): void {
  /**
   * GET /events — the catalogue.
   *
   * Everything in one call. There are 26 events; paginating that would cost
   * more in round trips than it saves, and the drawer filters in the browser
   * so typing feels instant.
   */
  app.get("/events", async (req: any, reply: any) => {
    const orgId = readOrgId(req.headers);
    try {
      return await withOrgScope(pool, orgId, async (client) => {
        const { rows } = await client.query(`
          SELECT
            s.event_type,
            s.description,
            s.payload_schema,
            s.produced_when,
            s.status,
            (
              SELECT coalesce(
                jsonb_agg(jsonb_build_object('producer', t.producer, 'count', t.n)
                          ORDER BY t.n DESC), '[]'::jsonb)
              FROM (
                SELECT o.producer, count(*) AS n
                FROM orch.event_outbox o
                WHERE o.event_type = s.event_type AND o.producer IS NOT NULL
                GROUP BY o.producer
              ) t
            ) AS produced_by,
            (
              SELECT coalesce(
                jsonb_agg(jsonb_build_object(
                  'graphKey', b.graph_key, 'moduleQueue', b.module_queue)), '[]'::jsonb)
              FROM ${GRAPH_EVENT_BINDINGS} b
              WHERE b.event_type = s.event_type AND b.status = 'active'
            ) AS consumed_by
          FROM ${EVENT_SCHEMAS} s
          ORDER BY s.event_type
        `);

        const events: CatalogEvent[] = rows.map((r: any) => {
          const parts = String(r.event_type).split(".");
          const producedBy = (r.produced_by ?? []) as Array<{
            producer: string;
            count: number;
          }>;
          return {
            eventType: r.event_type,
            module: parts[0] ?? "unknown",
            entity: parts[1] ?? "",
            description: r.description ?? "",
            // No column for these yet — see the header.
            aliases: [],
            payloadSchema: r.payload_schema ?? null,
            producedWhen: r.produced_when ?? null,
            status: r.status ?? "unknown",
            producedBy,
            consumedBy: (r.consumed_by ?? []) as Array<{
              graphKey: string;
              moduleQueue: string | null;
            }>,
            everPublished: producedBy.length > 0,
          };
        });

        return {
          events,
          /**
           * Told to the UI rather than silently absent, so the drawer can say
           * aliases are not stored yet instead of implying every event has none.
           */
          aliasesSupported: false,
        };
      });
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "event_catalog_failed", message: String(err) });
    }
  });

  /**
   * POST /events/draft — register a new event as a DRAFT.
   *
   * Registering an event is creating a platform contract other teams build
   * against, so it never goes straight to active. It lands as a draft and
   * rides review, exactly like a topology change.
   */
  app.post("/events/draft", async (req: any, reply: any) => {
    const body = req.body ?? {};
    const eventType = String(body.eventType ?? "").trim();
    const description = String(body.description ?? "").trim();
    const payloadSchema = body.payloadSchema ?? {
      type: "object",
      properties: {},
    };

    // module.entity.pastTenseFact — the convention, enforced rather than
    // suggested, because a catalogue of inconsistent names stops being useful
    // to the humans and the matcher at the same time.
    if (!/^[a-z0-9]+\.[a-z0-9_]+\.[a-z0-9_]+$/.test(eventType)) {
      return reply.code(400).send({
        error: "name_convention",
        message:
          `"${eventType}" does not follow module.entity.pastTenseFact — for example ` +
          `astra.requirement.published. Three lowercase segments.`,
      });
    }
    if (description.length < 10) {
      return reply.code(400).send({
        error: "description_required",
        message:
          "One plain sentence describing what has happened. It is the only " +
          "hand-written thing in the catalogue, and both people and the " +
          "matcher rely on it.",
      });
    }

    try {
      return await withOrgScope(pool, readOrgId(req.headers), async (client) => {
        const exists = await client.query(
          `SELECT 1 FROM ${EVENT_SCHEMAS} WHERE event_type = $1`,
          [eventType],
        );
        if (exists.rowCount) {
          return reply
            .code(409)
            .send({ error: "already_exists", eventType });
        }
        await registerEvent(client, {
          eventType,
          description,
          payloadSchema,
          status: "draft",
        });
        return { eventType, status: "draft", created: true };
      });
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "event_draft_failed", message: String(err) });
    }
  });
}
