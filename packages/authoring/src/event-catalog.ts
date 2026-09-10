import { catalogRelatedEventTypes } from "./tool-registry.js";

export type EventCatalogEntry = {
  eventType: string;
  schemaVersion: string;
  description: string;
  producedWhen: string | null;
  primaryConsumer: string | null;
  status: string;
};

type Queryable = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: any[] }>;
};

/**
 * Load event descriptions from the event catalogue for LLM prompt injection
 * (llm-graph-generator-design §4.2). No new data — reuse the registry as-is.
 */
export async function loadEventCatalog(
  db: Queryable,
  eventTypes?: string[],
): Promise<EventCatalogEntry[]> {
  const types = eventTypes?.length ? eventTypes : catalogRelatedEventTypes();

  const { rows } = await db.query(
    `SELECT event_type, schema_version, description, produced_when,
            primary_consumer, status
       FROM authoring.event_catalog
      WHERE event_type = ANY($1::text[])
        AND status = 'active'
      ORDER BY event_type, schema_version`,
    [types],
  );

  return rows.map((r) => ({
    eventType: r.event_type as string,
    schemaVersion: r.schema_version as string,
    description: r.description as string,
    producedWhen: (r.produced_when as string | null) ?? null,
    primaryConsumer: (r.primary_consumer as string | null) ?? null,
    status: r.status as string,
  }));
}

export type EventSchemaDetail = {
  eventType: string;
  schemaVersion: string;
  description: string;
  payloadSchema: unknown;
  envelopeFields: unknown;
  producedWhen: string | null;
  primaryConsumer: string | null;
};

/** Load full event schema (payload + envelope) for Builder audit / validation UI. */
export async function loadEventSchemaDetail(
  db: Queryable,
  eventType: string,
  schemaVersion = "1.0",
): Promise<EventSchemaDetail | null> {
  const { rows } = await db.query(
    `SELECT event_type, schema_version, description, payload_schema,
            envelope_fields, produced_when, primary_consumer
       FROM authoring.event_catalog
      WHERE event_type = $1
        AND schema_version = $2
        AND status = 'active'
      LIMIT 1`,
    [eventType, schemaVersion],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    eventType: r.event_type as string,
    schemaVersion: r.schema_version as string,
    description: r.description as string,
    payloadSchema: r.payload_schema,
    envelopeFields: r.envelope_fields,
    producedWhen: (r.produced_when as string | null) ?? null,
    primaryConsumer: (r.primary_consumer as string | null) ?? null,
  };
}

/** Format event catalog lines for the LLM system prompt. */
export function formatEventCatalogForPrompt(
  events: EventCatalogEntry[],
): string {
  if (events.length === 0) {
    return "(no event descriptions loaded)";
  }
  return events
    .map((e) => {
      const when = e.producedWhen ? ` Produced when: ${e.producedWhen}.` : "";
      const consumer = e.primaryConsumer
        ? ` Primary consumer: ${e.primaryConsumer}.`
        : "";
      return `- ${e.eventType} (v${e.schemaVersion}): ${e.description}.${when}${consumer}`;
    })
    .join("\n");
}

export type RegisterEventArgs = {
  eventType: string;
  description: string;
  /** Left permissive when omitted — see the note below. */
  payloadSchema?: unknown;
  producedWhen?: string | null;
  primaryConsumer?: string | null;
  /** `draft` for something a person is still describing. */
  status?: "draft" | "active";
};

/**
 * Put an event in the catalogue, once, from anywhere.
 *
 * Four places registered events and each wrote its own INSERT: the worker's
 * ORBIT bootstrap, the chain builder, the catalogue route and SYNTRA's outbox
 * seed. They disagreed about two things that matter.
 *
 * `application` — the column the catalogue added so an event has an owner
 * rather than a name prefix everyone parses separately. Every INSERT left it
 * NULL, so the events registered by running code were exactly the ones with no
 * owner. It is derived here the one way, from the prefix, against the
 * applications table; an event whose prefix names no application gets NULL,
 * which is the honest answer and shows up in the platform checks.
 *
 * `envelope_fields` — the same for every event, because the envelope is. The
 * old INSERTs copied it off an arbitrary existing row with
 * `SELECT … LIMIT 1`, which quietly inserted NOTHING when the catalogue was
 * empty: the bootstrap did not bootstrap. It falls back to `{}` here.
 *
 * `handling` is deliberately not set. A new event is `terminal` — accepted and
 * recorded — until a workflow is bound to it, and binding is what promotes it.
 *
 * Returns true when a row was created, false when the event was already known.
 */
export async function registerEvent(
  db: Queryable,
  args: RegisterEventArgs,
): Promise<boolean> {
  const payload = args.payloadSchema ?? {
    type: "object",
    additionalProperties: true,
  };

  const { rows } = await db.query(
    `INSERT INTO authoring.event_catalog (
       event_type, schema_version, application, description, payload_schema,
       envelope_fields, produced_when, primary_consumer, status
     )
     VALUES (
       $1, '1.0',
       (SELECT a.key FROM platform.applications a
         WHERE $1 LIKE a.key || '.%' LIMIT 1),
       $2, $3::jsonb,
       coalesce(
         (SELECT e.envelope_fields FROM authoring.event_catalog e
           WHERE e.schema_version = '1.0' LIMIT 1),
         '{}'::jsonb),
       $4, $5, $6
     )
     ON CONFLICT (event_type, schema_version) DO NOTHING
     RETURNING event_type`,
    [
      args.eventType,
      args.description,
      JSON.stringify(payload),
      args.producedWhen ?? null,
      args.primaryConsumer ?? null,
      args.status ?? "active",
    ],
  );

  return rows.length > 0;
}
