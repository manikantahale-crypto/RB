// Outbox relay worker.
//
// The ONLY publisher into pg-boss. Reads unpublished rows from event_outbox,
// composes the wire envelope, publishes each to the dispatch queue, and marks
// the row published — so business writes never touch the queue directly
// (the transactional outbox pattern).

import { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { env } from "../env.js";
import type { EventEnvelope, EventType } from "@tekisho/domain";

// The queue the orchestrator's dispatcher consumes from. Must match exactly
// on the consumer side.
export const DISPATCH_QUEUE = "orchestration.dispatch";
export const DISPATCH_DLQ = "orchestration.dispatch.dlq";

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 1000;

// Retry policy for the dispatch queue. Applied to jobs the CONSUMER
// (the orchestrator dispatcher) processes: if its handler throws, pg-boss
// re-runs the job up to retryLimit times with exponential backoff. After
// the retries are exhausted, the job moves to the dead-letter queue instead
// of just failing, so nothing is silently lost.
const RETRY_LIMIT = 5;
const RETRY_DELAY_SECONDS = 5;

export interface OutboxRow {
  id: string; // bigint returns as string from pg
  event_id: string;
  event_type: EventType;
  schema_version: string;
  organization_id: string;
  aggregate_type: string;
  aggregate_id: string;
  correlation_id: string;
  causation_id: string | null;
  producer: string;
  payload_ref: Record<string, unknown>;
  occurred_at: Date;
}

export function toEnvelope(row: OutboxRow): EventEnvelope {
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    schema_version: row.schema_version,
    occurred_at: row.occurred_at.toISOString(),
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    organization_id: row.organization_id,
    aggregate: { type: row.aggregate_type, id: row.aggregate_id },
    payload_ref: row.payload_ref,
    producer: row.producer,
  };
}

export async function relayOnce(
  pool: Pool,
  boss: PgBoss,
  resolvePin?: StartOutboxRelayOptions["resolvePin"],
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<OutboxRow>(
      `SELECT id, event_id, event_type, schema_version, organization_id,
              aggregate_type, aggregate_id, correlation_id, causation_id,
              producer, payload_ref, occurred_at
         FROM event_outbox
        WHERE published_at IS NULL
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [BATCH_SIZE],
    );

    if (rows.length === 0) {
      await client.query("COMMIT");
      return 0;
    }

    const publishedIds: string[] = [];
    for (const row of rows) {
      const envelope = toEnvelope(row) as EventEnvelope & {
        __graphKey?: string;
        __graphVersion?: number;
      };
      if (resolvePin) {
        const pin = await resolvePin(row.event_type, row.organization_id);
        if (pin) {
          envelope.__graphKey = pin.graphKey;
          envelope.__graphVersion = pin.graphVersion;
        }
      }
      await boss.send(DISPATCH_QUEUE, envelope, {
        singletonKey: row.aggregate_id, // serialize per aggregate
      });
      publishedIds.push(row.id);
    }

    await client.query(
      `UPDATE event_outbox
          SET published_at = now()
        WHERE id = ANY($1::bigint[])`,
      [publishedIds],
    );

    await client.query("COMMIT");
    return rows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type StartOutboxRelayOptions = {
  /** Shared dispatcher PgBoss — avoids a second session-mode connection pool. */
  boss: PgBoss;
  /**
   * Shared migrator pool (compiler / checkpointer / outbox writes).
   * Used when DATABASE_RELAY_URL is unset so we do not open another Pool
   * against the session-mode pooler (budget ~15).
   */
  pool?: Pool;
  /**
   * Design D3: stamp graph pin onto dispatch jobs at enqueue (relay).
   * Return null for terminal events with no runbook.
   */
  resolvePin?: (
    eventType: string,
    organizationId: string,
  ) => Promise<{ graphKey: string; graphVersion: number } | null>;
};

function isPoolerExhausted(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("EMAXCONNSESSION") || message.includes("max clients");
}

/** Returns an error message if the DB role cannot relay; null if OK. */
async function checkOutboxRelayPrivileges(pool: Pool): Promise<string | null> {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    if (isPoolerExhausted(error)) {
      return (
        `session pooler exhausted (EMAXCONNSESSION) during privilege check — ` +
        `relay disabled. Stop other workers / wait for idle connections, then restart.`
      );
    }
    throw error;
  }
  try {
    const { rows } = await client.query<{
      current_user: string;
      can_update: boolean;
    }>(`
      SELECT current_user,
             has_table_privilege(current_user, 'event_outbox', 'update') AS can_update
    `);
    const { current_user: dbUser, can_update: canUpdate } = rows[0]!;
    if (!canUpdate) {
      return (
        `Outbox relay DB role "${dbUser}" lacks UPDATE on event_outbox ` +
        `(SELECT ... FOR UPDATE + mark published_at both need it). ` +
        `Set DATABASE_RELAY_URL to syntra_relay on project mdxsybudkorrvmojqowx, ` +
        `or run packages/db/scripts/fix-event-outbox-migrator-bridge.sql as postgres there.`
      );
    }

    await client.query("BEGIN");
    try {
      await client.query(`
        SELECT id FROM event_outbox
         WHERE published_at IS NULL
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      `);
      await client.query("COMMIT");
      return null;
    } catch (error) {
      await client.query("ROLLBACK");
      const message = error instanceof Error ? error.message : String(error);
      return (
        `Outbox relay cannot lock event_outbox rows as "${dbUser}": ${message}. ` +
        `Under FORCE RLS the role also needs an UPDATE policy ` +
        `(see packages/db/scripts/fix-event-outbox-migrator-bridge.sql).`
      );
    }
  } finally {
    client.release();
  }
}

/**
 * Starts the outbox poll loop. Caller owns PgBoss lifecycle (start/stop).
 *
 * Prefers DATABASE_RELAY_URL (syntra_relay — design / RLS). Falls back to
 * DATABASE_MIGRATOR_URL via the shared bootstrap pool when provided.
 */
export async function startOutboxRelay(
  options: StartOutboxRelayOptions
): Promise<() => Promise<void>> {
  const { boss, resolvePin } = options;
  const relayUrl = env.DATABASE_RELAY_URL?.trim() ?? "";
  const usingRelayUrl = relayUrl.length > 0;

  // Prefer a dedicated relay URL; otherwise reuse the bootstrap migrator pool
  // so we do not burn another session-mode slot.
  let pool: Pool;
  let ownsPool = false;
  if (usingRelayUrl) {
    pool = new Pool({
      connectionString: relayUrl,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
    ownsPool = true;
  } else if (options.pool) {
    pool = options.pool;
  } else {
    pool = new Pool({
      connectionString: env.DATABASE_MIGRATOR_URL,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
    ownsPool = true;
  }

  // Dead-letter queue must exist before the main queue can reference it.
  await boss.createQueue(DISPATCH_DLQ);

  // Main dispatch queue, with retry policy + dead-letter routing baked in.
  await boss.createQueue(DISPATCH_QUEUE, {
    retryLimit: RETRY_LIMIT,
    retryDelay: RETRY_DELAY_SECONDS,
    retryBackoff: true,
    deadLetter: DISPATCH_DLQ,
  });

  // SELECT ... FOR UPDATE needs UPDATE (+ RLS UPDATE policy under FORCE).
  // Missing privileges / pooler exhaustion: keep dispatcher up, skip poll loop.
  const privilegeError = await checkOutboxRelayPrivileges(pool);
  if (privilegeError) {
    console.error(`[OutboxRelay] DISABLED — ${privilegeError}`);
    return async () => {
      if (ownsPool) await pool.end();
      console.log("Outbox relay stopped (was disabled)");
    };
  }

  let stopped = false;

  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        let processed = 0;
        do {
          processed = await relayOnce(pool, boss, resolvePin);
          if (processed > 0) {
            console.log(`[OutboxRelay] published ${processed} event(s)`);
          }
        } while (processed === BATCH_SIZE && !stopped);
      } catch (error) {
        console.error("outbox relay tick failed:", error);
      }
      if (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
  };

  void loop();
  if (usingRelayUrl) {
    console.log(`Outbox relay started → queue "${DISPATCH_QUEUE}" (DATABASE_RELAY_URL)`);
  } else {
    console.log(
      `Outbox relay started → queue "${DISPATCH_QUEUE}" (shared migrator pool — set DATABASE_RELAY_URL for syntra_relay)`
    );
  }

  return async () => {
    stopped = true;
    if (ownsPool) await pool.end();
    console.log("Outbox relay stopped");
  };
}
