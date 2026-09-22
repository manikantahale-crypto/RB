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

/**
 * The candidate's conversation. RELAY's nodes return it as `threadId`; the
 * events PRISM was written against say `thread_id`, and the vendor's own
 * thread arrives as `relay_thread_id`. All three are the same thing.
 */
export function threadIdOf(p: Record<string, unknown>): string | undefined {
  const id = p.thread_id ?? p.threadId ?? p.relay_thread_id;
  return id ? String(id) : undefined;
}

/** The email that carried the answer. `messageId` is RELAY's spelling. */
export function messageIdOf(p: Record<string, unknown>): string | undefined {
  const id = p.message_id ?? p.messageId;
  return id ? String(id) : undefined;
}

export function jobIdOf(p: Record<string, unknown>): string | undefined {
  const id = p.jobId ?? p.requirement_id ?? p.requirementId ?? p.job_id;
  return id ? String(id) : undefined;
}
