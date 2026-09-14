import { z } from 'zod';
import type { EventEnvelope } from '@tekisho/domain';
import { parseEventPayload } from '../contracts/payloads.js';

/** Wire envelope for platform ingress (design §6 / §9). */
export const EventEnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.string().min(1),
  schema_version: z.string().min(1).default('1.0'),
  occurred_at: z.string().min(1),
  correlation_id: z.string().uuid(),
  causation_id: z.string().uuid().nullable(),
  organization_id: z.string().uuid(),
  aggregate: z.object({
    type: z.string().min(1),
    id: z.string().uuid(),
  }),
  payload_ref: z.record(z.string(), z.unknown()),
  producer: z.string().min(1),
  /**
   * Where this one event must go, instead of wherever its binding says.
   *
   * Set only by an authoring test fire. Screen 5 fires a real event through
   * this door and the router then resolved the BINDING, which names the live
   * version — so testing an edit exercised the version already in production,
   * and a workflow that had never been live could not be tried at all.
   *
   * All three parts or none: a version alone names a version of nothing when
   * the workflow has no binding to take a graph and a queue from, which is the
   * case this exists for.
   *
   * It replaces the router's ANSWER, not the path. Ingress, the outbox, the
   * relay and the router all still run — the thing most likely to be wrong
   * about a new workflow is whether anything reaches it, and a test that
   * skipped delivery would be blind to exactly that.
   */
  test_pin: z
    .object({
      graphKey: z.string().min(1),
      graphVersion: z.number().int().positive(),
      moduleQueue: z.string().min(1),
    })
    .nullish(),
});

export type ParsedEventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/**
 * Validate envelope + per-type payload (design §6.1).
 * Invalid data never enters a queue — API returns 422.
 */
export function parseEventEnvelope(raw: unknown): EventEnvelope {
  const envelope = EventEnvelopeSchema.parse(raw);
  const payload = parseEventPayload(envelope.event_type, envelope.payload_ref);
  return { ...envelope, payload_ref: payload } as EventEnvelope;
}
