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
