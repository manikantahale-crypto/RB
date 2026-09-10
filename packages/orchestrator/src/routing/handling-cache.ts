/**
 * What the platform does with an event, read from the database instead of
 * compiled into the engine.
 *
 * WHY THIS EXISTS
 *
 * `PLATFORM_EVENT_PLAN` in `table.ts` is a hardcoded map of 26 events. Any
 * event missing from it was acknowledged and dropped — silently, and however
 * correct the workflow bound to it was. That is not a hypothetical: it killed
 * RELAY's two active bindings, and registering a new event required editing
 * the engine and shipping a release.
 *
 * `authoring.event_catalog.handling` is the same decision as a column. This
 * caches it so `planForEvent()` can stay synchronous — it is called on the hot
 * path in four places, and making it async would ripple through the router,
 * the dispatcher and the relay for no benefit.
 *
 * PRECEDENCE, AND WHY THIS WAY ROUND
 *
 *   1. the catalogue, if it has been loaded and knows the event
 *   2. the hardcoded map
 *   3. terminal
 *
 * The database wins because it is the thing an operator can change. The map
 * stays as the floor so that a worker which has not loaded the catalogue yet —
 * or cannot reach the database — behaves exactly as it did before rather than
 * dropping everything on the floor. Falling back to "terminal" for an unknown
 * event is the pre-existing behaviour, kept deliberately: it acknowledges the
 * event rather than failing the job.
 */
import type { EventHandleKind, PlatformEventPlan } from './table.js';

/** Anything that can run a query — a pg Pool, a Client, a transaction. */
export interface Queryable {
  query<T = unknown>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

let catalogue: Map<string, EventHandleKind> | null = null;
let loadedAt: Date | null = null;

/**
 * Replace the cache from `authoring.event_catalog`.
 *
 * Call at worker boot and on a timer. Returns how many events it learned, so a
 * caller can log something meaningful rather than assuming it worked.
 *
 * NEVER THROWS. A worker that cannot read the catalogue must still route on
 * the hardcoded map rather than refuse to start — the failure mode this
 * replaces was events disappearing, and a dead worker is worse.
 */
export async function loadEventHandling(db: Queryable): Promise<number> {
  try {
    const { rows } = await db.query<{ event_type: string; handling: string }>(
      `SELECT event_type, handling
         FROM authoring.event_catalog
        WHERE status = 'active'`,
    );

    const next = new Map<string, EventHandleKind>();
    for (const row of rows) {
      if (
        row.handling === 'graph' ||
        row.handling === 'terminal' ||
        row.handling === 'resume' ||
        row.handling === 'fail'
      ) {
        next.set(row.event_type, row.handling);
      }
      // A handling value outside the four is ignored rather than trusted. The
      // column has a CHECK constraint, so this can only happen if someone has
      // been editing the catalogue by hand.
    }

    catalogue = next;
    loadedAt = new Date();
    return next.size;
  } catch {
    // Left as it was: a refresh that fails keeps the previous catalogue rather
    // than emptying it.
    return catalogue?.size ?? 0;
  }
}

/** What the catalogue says, or undefined if it has not been loaded or does not know. */
export function handlingFromCatalogue(
  eventType: string,
): PlatformEventPlan | undefined {
  const kind = catalogue?.get(eventType);
  if (!kind) return undefined;
  return { kind, note: 'authoring.event_catalog' };
}

/** For diagnostics and the platform-health screen. */
export function catalogueState(): { loaded: boolean; events: number; at: Date | null } {
  return { loaded: catalogue !== null, events: catalogue?.size ?? 0, at: loadedAt };
}

/** Tests only. Restores the "never loaded" state. */
export function resetEventHandling(): void {
  catalogue = null;
  loadedAt = null;
}
