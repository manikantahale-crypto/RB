import { v5 as uuidv5, validate as validateUuid } from 'uuid';

/** Stable namespace for deterministic Gmail thread → orchestration UUID mapping. */
const RELAY_THREAD_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

export function isPlatformUuid(value: string | null | undefined): boolean {
  return Boolean(value && validateUuid(value));
}

/** Orchestrator ingress requires UUID correlation_id and aggregate.id. Gmail thread ids are not UUIDs. */
export function relayThreadCorrelationId(
  threadId: string,
  existing?: string | null,
): string {
  if (existing && validateUuid(existing)) return existing;
  if (validateUuid(threadId)) return threadId;
  return uuidv5(`relay-email-thread:${threadId}`, RELAY_THREAD_NAMESPACE);
}
