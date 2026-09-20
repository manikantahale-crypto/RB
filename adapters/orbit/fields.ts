/**
 * The names ORBIT's payload fields travel under — snake or camel, depending
 * on who published the event. One place, so a new alias is one line.
 */
export function candidateIdOf(p: Record<string, unknown>): string | undefined {
  const id = p.candidateId ?? p.candidate_id;
  return id ? String(id) : undefined;
}

export function placementIdOf(p: Record<string, unknown>): string | undefined {
  const id = p.placementId ?? p.placement_id;
  return id ? String(id) : undefined;
}
