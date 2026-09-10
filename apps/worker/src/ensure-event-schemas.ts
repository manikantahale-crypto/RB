import type { Pool } from "pg";
import { EVENT_TYPES } from "@tekisho/domain";
import { registerEvent } from "@tekisho/authoring";

/**
 * Ensure syntra.match.requested is registered so ingress can publish it.
 * Idempotent; quiet when already seeded by Flyway R__seed_event_schemas /
 * R__orch_runtime_grants.
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
      await registerEvent(pool, {
        eventType: ev.type,
        description: ev.description,
        producedWhen: "ORBIT",
        primaryConsumer: "orbit workflows",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/duplicate key|unique constraint|already exists/i.test(message)) {
        console.warn(`[Bootstrap] orbit event ${ev.type}:`, message);
      }
    }
  }

  try {
    const created = await registerEvent(pool, {
      eventType: EVENT_TYPES.MATCH_REQUESTED,
      description:
        "A job×resume match was requested (Syntra queue or platform ingress).",
      payloadSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "syntra.match.requested payload",
        type: "object",
        additionalProperties: true,
      },
      producedWhen: "Match requested",
      primaryConsumer: "Orchestrator match workflow",
    });
    if (created) {
      console.log(
        "[Bootstrap] registered the catalogue entry for syntra.match.requested",
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique constraint|already exists/i.test(message)) {
      return;
    }
    console.warn(
      "[Bootstrap] ensureIngressEventSchemas:",
      message,
      "— if match ingress fails its FK, run Flyway R__seed_event_schemas.sql / grant-orch-runtime.sql as postgres",
    );
  }
}
