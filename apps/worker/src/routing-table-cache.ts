/**
 * The active routing table, cached for the router's hot path.
 *
 * Same shape and reasoning as the event-handling cache: the router runs per
 * event and must not pay a query for the table on each one, but an operator
 * changing a binding through the authoring screens should see it take effect
 * without a restart.
 *
 * EMPTY MEANS "FALL BACK", NOT "NOTHING IS BOUND"
 *
 * A caller must distinguish "the table says no binding answers this event"
 * from "I have not loaded the table". The first is a valid answer — acknowledge
 * and move on. The second must not silently stop every workflow in the system,
 * which is what returning an empty table would cause.
 *
 * So `routingTable()` returns null until a load has succeeded, and the router
 * keeps using the single-binding path it used before. Once loaded, an empty
 * array is a real answer.
 */
import {
  loadRoutingTable,
  type DbQueryable,
} from "@tekisho/authoring";
import type { BindingEntry } from "@tekisho/routing-contract";

let table: BindingEntry[] | null = null;
let loadedAt: Date | null = null;

/**
 * Refresh from `authoring.event_bindings`.
 *
 * Never throws, for the same reason as the handling cache: a worker that
 * cannot reach the database must keep routing on what it has rather than
 * refuse to start.
 */
export async function loadRoutingTableCache(db: DbQueryable): Promise<{
  entries: number;
  dropped: number;
}> {
  try {
    const { entries, dropped } = await loadRoutingTable(db);
    table = entries;
    loadedAt = new Date();

    // A binding naming a workflow that no longer exists is a real fault and
    // silence is how it stays one. It is not fatal — every other binding still
    // routes — so it is reported rather than thrown.
    for (const d of dropped) {
      console.warn(
        `[Routing] binding ${d.id} on ${d.event_type} names no workflow — ignored`,
      );
    }

    return { entries: entries.length, dropped: dropped.length };
  } catch (err) {
    console.warn(
      `[Routing] could not refresh the binding table: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { entries: table?.length ?? 0, dropped: 0 };
  }
}

/** The table, or null if it has never loaded. Null means "use the old path". */
export function routingTable(): BindingEntry[] | null {
  return table;
}

export function routingTableState(): { loaded: boolean; entries: number; at: Date | null } {
  return { loaded: table !== null, entries: table?.length ?? 0, at: loadedAt };
}

/** Tests only. */
export function resetRoutingTableCache(): void {
  table = null;
  loadedAt = null;
}
