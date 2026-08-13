import type { Pool } from "pg";
import { EVENT_TYPES } from "@tekisho/domain";

/**
 * Ensure syntra.match.requested is registered so ingress can write event_outbox
 * (FK to event_schemas). Idempotent; quiet when already seeded by Flyway
 * R__seed_event_schemas / R__orch_runtime_grants.
 */
export async function ensureIngressEventSchemas(pool: Pool): Promise<void> {
  try {
    const existing = await pool.query(
      `SELECT 1 FROM event_schemas
       WHERE event_type = $1 AND schema_version = '1.0'
       LIMIT 1`,
      [EVENT_TYPES.MATCH_REQUESTED],
    );
    if ((existing.rowCount ?? 0) > 0) {
      return;
    }

    await pool.query(
      `INSERT INTO event_schemas (
         event_type, schema_version, description, payload_schema,
         envelope_fields, produced_when, primary_consumer, status
       )
       SELECT
         $1,
         '1.0',
         'A job×resume match was requested (Syntra queue or platform ingress).',
         $2::jsonb,
         e.envelope_fields,
         'Match requested',
         'Orchestrator match workflow',
         'ACTIVE'
       FROM event_schemas e
       WHERE e.schema_version = '1.0'
       LIMIT 1
       ON CONFLICT (event_type, schema_version) DO NOTHING`,
      [
        EVENT_TYPES.MATCH_REQUESTED,
        JSON.stringify({
          $schema: "https://json-schema.org/draft/2020-12/schema",
          title: "syntra.match.requested payload",
          type: "object",
          additionalProperties: true,
        }),
      ],
    );
    console.log(
      "[Bootstrap] registered event_schemas row for syntra.match.requested",
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Row may already exist via Flyway; SELECT/INSERT denied under RLS is OK
    // when R__seed_event_schemas already applied as postgres.
    if (/duplicate key|unique constraint|already exists/i.test(message)) {
      return;
    }
    console.warn(
      "[Bootstrap] ensureIngressEventSchemas:",
      message,
      "— if match ingress fails FK, run Flyway R__seed_event_schemas.sql / grant-orch-runtime.sql as postgres",
    );
  }
}
