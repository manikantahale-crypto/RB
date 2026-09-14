/**
 * Which registry rows a NEW workflow may be built from.
 *
 * `authoring.node_registry` holds three kinds of row, and only two of them can
 * be authored with:
 *
 *   contract   declared in `adapters/`, bridged at run time, has schemas and
 *              worked examples — the material for a new workflow
 *   declared   the platform's own steps, same bridge, same guarantees
 *   legacy     a step the engine resolves but nobody described
 *
 * WHY LEGACY IS NOT MATERIAL. It has no trustworthy input schema and no
 * fixture, and — the part that actually breaks — it passes work downstream by
 * mutating `trigger_event.payload`, while a contract-bridged step returns
 * `{ result, steps }` and no `trigger_event` at all. The two cannot hand off
 * to each other.
 *
 * Asked to "keep matching bench consultants against a new requirement", the
 * proposer built `astra.requirement.intake → syntra.continuous.match`. Both
 * keys resolve, so nothing would have crashed: the ASTRA step would have
 * written its output where the SYNTRA step does not read, and the run would
 * have finished green having matched nobody. A silently wrong run is worse
 * than a refused one, which is why this is a filter and not a warning.
 *
 * WHY IT IS A MODULE AND NOT AN INLINE PREDICATE. The rule is applied in two
 * places that cannot share code directly — a TypeScript filter in
 * `routes/propose.ts` and a SQL `IN` list in `routes/applications` — and two
 * hand-maintained copies of one rule is the drift this codebase keeps paying
 * for. The list is written once here and the SQL is built from it.
 */

/** Registry sources a new workflow may use. */
export const AUTHORABLE_SOURCES = ["contract", "declared"] as const;

export type AuthorableSource = (typeof AUTHORABLE_SOURCES)[number];

/** Anything with a `source`, so both registry rows and test fixtures fit. */
export type StepRow = { source?: unknown };

export function isAuthorableStep(row: StepRow): boolean {
  return (AUTHORABLE_SOURCES as readonly string[]).includes(String(row.source));
}

/**
 * The same list as a SQL literal, for the places that must ask the database.
 *
 * Quoting is safe by construction — the values are compile-time constants in
 * this file, never anything a caller supplies.
 */
export function authorableSourcesSql(): string {
  return AUTHORABLE_SOURCES.map((s) => `'${s}'`).join(", ");
}
