import type { Pool } from "pg";
import type { EventEnvelope } from "@tekisho/domain";
import { withOrgConnection } from "../db/with-org-connection.js";
import { parseEventEnvelope } from "./envelope-schema.js";
import { INGRESS_QUEUE } from "../routing/table.js";

export type AcceptPlatformEventResult = {
  event_id: string;
  queue: typeof INGRESS_QUEUE;
  /** false when event_id was already in event_outbox (idempotent). */
  inserted: boolean;
};

export type AcceptPlatformEventDeps = {
  pool: Pool;
  /** Enqueue after the outbox write (pg-boss send). */
  enqueue: (queue: string, data: EventEnvelope) => Promise<unknown>;
};

/**
 * Front door — ingress (design §6 / §9).
 *
 * 1. Validate wire envelope (Zod)
 * 2. Insert event_outbox under app.org_id (published_at set so relay won't double-send)
 * 3. Enqueue orchestration.ingress for the router
 *
 * Syntra may still publish direct queues (bridge); new producers should use this.
 */
export async function acceptPlatformEvent(
  raw: unknown,
  deps: AcceptPlatformEventDeps,
): Promise<AcceptPlatformEventResult> {
  const envelope = parseEventEnvelope(raw);

  const inserted = await withOrgConnection(
    deps.pool,
    envelope.organization_id,
    async (client) => {
      const result = await client.query(
        `INSERT INTO event_outbox (
           event_id, event_type, schema_version, organization_id,
           aggregate_type, aggregate_id, correlation_id, causation_id,
           producer, payload_ref, published_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now()
         )
         ON CONFLICT (event_id) DO NOTHING
         RETURNING id`,
        [
          envelope.event_id,
          envelope.event_type,
          envelope.schema_version,
          envelope.organization_id,
          envelope.aggregate.type,
          envelope.aggregate.id,
          envelope.correlation_id,
          envelope.causation_id,
          envelope.producer,
          JSON.stringify(envelope.payload_ref),
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },
  );

  if (inserted) {
    await deps.enqueue(INGRESS_QUEUE, envelope);
  }

  return { event_id: envelope.event_id, queue: INGRESS_QUEUE, inserted };
}
