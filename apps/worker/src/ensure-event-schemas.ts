import type { Pool } from "pg";
import { EVENT_TYPES } from "@tekisho/domain";

/**
 * Ensure syntra.match.requested is registered so ingress can write event_outbox
 * (FK to event_schemas). Idempotent; quiet when already seeded by Flyway
 * R__seed_event_schemas / R__orch_runtime_grants.
 */
export async function ensureIngressEventSchemas(pool: Pool): Promise<void> {
  const orbitEvents: Array<{ type: string; description: string }> = [
    {
      type: EVENT_TYPES.ORBIT_LIFECYCLE_TRANSITION_REQUESTED,
      description: "Request ORBIT lifecycle transition for a candidate.",
    },
    {
      type: EVENT_TYPES.ORBIT_LIFECYCLE_TRANSITIONED,
      description: "Candidate lifecycle state changed in ORBIT.",
    },
    {
      type: EVENT_TYPES.ORBIT_PLACEMENT_CONFIRM_REQUESTED,
      description: "Request confirmation of a client placement.",
    },
    {
      type: EVENT_TYPES.ORBIT_PLACEMENT_CONFIRMED,
      description: "Client placement confirmed.",
    },
    {
      type: EVENT_TYPES.ORBIT_REVENUE_ARRANGE_REQUESTED,
      description: "Request revenue arrangement on a placement.",
    },
    {
      type: EVENT_TYPES.ORBIT_REVENUE_ARRANGED,
      description: "Revenue arrangement attached to placement.",
    },
    {
      type: EVENT_TYPES.ORBIT_ACTIVITY_NOTED,
      description: "Recruiter note on candidate timeline.",
    },
    {
      type: EVENT_TYPES.ORBIT_BENCH_HOLD,
      description: "ORBIT hold/ignore branch signal.",
    },
  ];

  for (const ev of orbitEvents) {
    try {
      await pool.query(
        `INSERT INTO event_schemas (
           event_type, schema_version, description, payload_schema,
           envelope_fields, produced_when, primary_consumer, status
         )
         SELECT
           $1, '1.0', $2,
           '{"type":"object","additionalProperties":true}'::jsonb,
           e.envelope_fields,
           'ORBIT',
           'orbit workflows',
           'ACTIVE'
         FROM event_schemas e
         WHERE e.schema_version = '1.0'
         LIMIT 1
         ON CONFLICT (event_type, schema_version) DO NOTHING`,
        [ev.type, ev.description],
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/duplicate key|unique constraint|already exists/i.test(message)) {
        console.warn(`[Bootstrap] orbit event_schema ${ev.type}:`, message);
      }
    }
  }

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
