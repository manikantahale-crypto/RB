/**
 * Keys a value claims that its schema did not keep.
 *
 * `safeParse` on a zod object STRIPS keys the schema does not name, so a
 * worked example saying a node returns `thread_id` when the output schema
 * never mentions it parses cleanly and reads as proof. It is not a cosmetic
 * disagreement: at run time the bridge parses the real output the same way
 * (`from-contract.ts`, `parseOrThrow`), so an undeclared field is DELETED
 * before it is filed under the step id. Nothing downstream can ever be wired
 * to it — and the input maps are now worked out from these same declarations,
 * so a missing one is a connection that can never be made, failing at the
 * first real event rather than in CI.
 *
 * Top level only. That is where wiring happens — an input map names a field of
 * a step, never a path inside one — so it is the level at which a dropped key
 * costs something.
 */
export function undeclaredFields(claimed: unknown, kept: unknown): string[] {
  const declared = new Set(Object.keys((kept ?? {}) as Record<string, unknown>));
  return Object.keys((claimed ?? {}) as Record<string, unknown>).filter(
    (k) => !declared.has(k),
  );
}
