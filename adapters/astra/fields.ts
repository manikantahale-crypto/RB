/**
 * The names ASTRA's payload fields travel under.
 *
 * The same value arrives as `jobId`, `requirement_id` or `requirementId`
 * depending on who published the event; the JD text under four names. The
 * engine functions read all of them and so do the contracts — one place, so a
 * new alias is one line.
 */
export function jobIdOf(p: Record<string, unknown>): string | undefined {
  const id = p.jobId ?? p.requirement_id ?? p.requirementId;
  return id ? String(id) : undefined;
}

export function rawTextOf(p: Record<string, unknown>): string | undefined {
  const raw = p.raw_text ?? p.rawText ?? p.body ?? p.content;
  return raw === undefined || raw === null ? undefined : String(raw);
}
