/**
 * The names PRISM's payload fields travel under — snake or camel, depending
 * on who published the event. One place, so a new alias is one line.
 */
export function submissionIdOf(p: Record<string, unknown>): string | undefined {
  const id = p.submissionId ?? p.submission_id;
  return id ? String(id) : undefined;
}

export function candidateIdOf(p: Record<string, unknown>): string | undefined {
  const id = p.candidateId ?? p.candidate_id ?? p.person_id;
  return id ? String(id) : undefined;
}

export function jobIdOf(p: Record<string, unknown>): string | undefined {
  const id = p.jobId ?? p.requirement_id ?? p.requirementId ?? p.job_id;
  return id ? String(id) : undefined;
}
