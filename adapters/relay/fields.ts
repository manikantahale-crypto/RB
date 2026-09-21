/**
 * The names RELAY's payload fields travel under. RELAY calls a thread
 * `relay_thread_id` when it is the vendor's and `thread_id` when it is the
 * candidate's; the orchestrator's events use both. One place.
 */
export function jobIdOf(p: Record<string, unknown>): string | undefined {
  const id = p.jobId ?? p.requirement_id ?? p.requirementId;
  return id ? String(id) : undefined;
}

export function candidateIdOf(p: Record<string, unknown>): string | undefined {
  const id = p.candidate_id ?? p.candidateId;
  return id ? String(id) : undefined;
}

/** The vendor's thread — the JD email the shortlist answers. */
export function vendorThreadOf(p: Record<string, unknown>): string | undefined {
  const id = p.vendor_thread_id ?? p.relay_thread_id;
  return id ? String(id) : undefined;
}
