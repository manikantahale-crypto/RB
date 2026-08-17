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
 * Load event descriptions from `event_schemas` for LLM prompt injection
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
       FROM event_schemas
      WHERE event_type = ANY($1::text[])
        AND status = 'ACTIVE'
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
       FROM event_schemas
      WHERE event_type = $1
        AND schema_version = $2
        AND status = 'ACTIVE'
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
