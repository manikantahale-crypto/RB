/**
 * Which steps the platform deduplicates, and what key it uses.
 *
 * WHY THIS IS A CONTRACT CONCERN AND NOT AN ENGINE ONE.
 *
 * It reads two declared fields — `sideEffect` and `idempotency` — and nothing
 * else. No database, no run, no queue. Two very different callers need the same
 * answer and neither should own it:
 *
 *   - the engine, to decide whether to skip a step it is about to run
 *   - the authoring API, to tell an author whether a duplicate in their
 *     workflow will actually be absorbed, or whether it really will run twice
 *
 * The authoring API cannot import the engine — that boundary is deliberate —
 * so a copy would have been the alternative, and two copies of a rule about
 * when to skip real work is exactly the drift this codebase keeps paying for.
 */
import type { Idempotency, SideEffect } from "./node-contract.js";

/**
 * Side effects the platform deduplicates.
 *
 * EXTERNAL AND FINANCIAL ARE IN, AND THE FIRST VERSION LEFT THEM OUT.
 *
 * The argument for excluding them was that a wrong suppression costs more
 * there — an email that never goes out rather than a row that can be
 * re-created. True, but it protects the guard rather than the user, and it
 * gets the arithmetic backwards:
 *
 *   included → structural duplicates are absorbed; a duplicate survives only
 *              if the process dies between doing the work and recording it
 *   excluded → every structural duplicate sends two emails, every time
 *
 * The residual risk is real and worth stating plainly rather than papering
 * over: the claim is marked done AFTER the call, so a crash in that window
 * leaves the claim stale and the work can repeat. Marking it before would turn
 * that into "the email may never have been sent", and a bench alert that
 * silently does not go out is worse than one that goes twice.
 *
 * `read` and `control` are absent because they need nothing: re-running them
 * changes nothing.
 */
export const DEDUPLICATED_SIDE_EFFECTS: readonly SideEffect[] = [
  "internal_write",
  "external",
  "financial",
];

/** Does the platform deduplicate this kind of step at all? */
export function isDeduplicable(contract: {
  sideEffect: SideEffect;
  idempotency?: Idempotency;
}): boolean {
  if (!DEDUPLICATED_SIDE_EFFECTS.includes(contract.sideEffect)) return false;
  const strategy = contract.idempotency?.strategy;
  return strategy === "natural_key" || strategy === "idempotency_key";
}

/** The paths a contract's key is built from, alternatives kept as groups. */
export function keyPathsOf(
  idempotency: Idempotency | undefined,
): Array<readonly string[]> {
  if (!idempotency) return [];
  if (idempotency.strategy === "natural_key") {
    return idempotency.keyPaths.map((p) => (typeof p === "string" ? [p] : p));
  }
  if (idempotency.strategy === "idempotency_key") return [[idempotency.keyPath]];
  return [];
}

/** Read a dot path out of an object. Undefined rather than throwing. */
function readPath(source: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = source;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * The key identifying one unit of this node's work, or null.
 *
 * Null always means "run the node". A key built from some of its parts would
 * collide across inputs that are genuinely different, and suppress real work —
 * which is worse than doing it twice.
 */
export function idempotencyKeyOf(
  contract: { sideEffect: SideEffect; idempotency?: Idempotency },
  input: Record<string, unknown>,
): string | null {
  if (!isDeduplicable(contract)) return null;

  const groups = keyPathsOf(contract.idempotency);
  if (groups.length === 0) return null;

  const parts: unknown[] = [];
  for (const alternatives of groups) {
    /**
     * Several names for ONE value, because the same id arrives as `jobId` from
     * one producer and `requirement_id` from another — which each node's input
     * `.refine` already says. First name carrying something wins, so a payload
     * generously supplying both still gives a stable answer.
     *
     * The key is built from the VALUE, so which name delivered it does not
     * matter: `jobId: "R1"` and `requirement_id: "R1"` produce the same key
     * and deduplicate against each other.
     */
    let value: unknown;
    for (const name of alternatives) {
      value = readPath(input, name);
      if (value !== undefined && value !== null && value !== "") break;
      value = undefined;
    }
    if (value === undefined) return null;
    parts.push(value);
  }

  /**
   * JSON rather than a joined string: a separator can appear inside a value,
   * and `["a:b","c"]` must not collide with `["a","b:c"]`.
   */
  return JSON.stringify(parts);
}

/**
 * Can a key be built from an event that declares only these field names?
 *
 * For the authoring side, which has a catalogue of field NAMES and no values.
 * A step whose key cannot be derived from its trigger is one the platform will
 * not deduplicate, and an author deciding whether a duplicate matters needs to
 * know which of the two they are looking at.
 */
export function keyDerivableFrom(
  contract: { sideEffect: SideEffect; idempotency?: Idempotency },
  availableFields: readonly string[],
): boolean {
  if (!isDeduplicable(contract)) return false;
  const groups = keyPathsOf(contract.idempotency);
  if (groups.length === 0) return false;
  const have = new Set(availableFields);
  // Every part must be satisfiable by at least one of its names.
  return groups.every((alternatives) => alternatives.some((n) => have.has(n)));
}
