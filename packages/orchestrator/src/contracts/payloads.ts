import { z } from 'zod';
import { EVENT_TYPES } from '@tekisho/domain';

/** Per-event payload Zod (design §6.1) — validated at ingress. */
export const JdReceivedPayloadSchema = z
  .object({
    requirement_id: z.string().uuid().optional(),
    jobId: z.string().uuid().optional(),
    ingestion_id: z.string().uuid().nullable().optional(),
    jd_document_id: z.string().uuid().nullable().optional(),
    channel_type: z.string().optional(),
    priority: z.enum(['HOT', 'NORMAL', 'LOW']).optional(),
    title: z.string().max(500).optional(),
  })
  .refine((p) => Boolean(p.requirement_id ?? p.jobId), {
    message: 'requirement_id or jobId required',
  });

export const ResumeReceivedPayloadSchema = z
  .object({
    document_id: z.string().uuid().optional(),
    candidate_id: z.string().uuid().optional(),
    resumeId: z.string().uuid().optional(),
    candidateId: z.string().uuid().optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    source: z.enum(['UPLOAD', 'EMAIL', 'CHANNEL', 'AGENT']).optional(),
    rawText: z.string().optional(),
    raw_text: z.string().optional(),
    skills: z.array(z.string()).optional(),
    requiredSkills: z.array(z.string()).optional(),
    jobId: z.string().uuid().optional(),
    summary: z.string().optional(),
  })
  .refine(
    (p) =>
      Boolean(
        p.document_id ??
          p.resumeId ??
          p.candidate_id ??
          p.candidateId ??
          p.rawText ??
          p.raw_text,
      ),
    { message: 'resume payload needs document/resume/candidate/rawText' },
  );

export const MatchRequestedPayloadSchema = z
  .object({
    jobId: z.string().uuid().optional(),
    resumeId: z.string().uuid().optional(),
    candidateId: z.string().uuid().optional(),
    requirement_id: z.string().uuid().optional(),
    skillMatchScore: z.number().optional(),
  })
  .passthrough()
  .refine((p) => Boolean(p.jobId ?? p.requirement_id), {
    message: 'jobId or requirement_id required',
  });

/** Loose object for terminal / control events (validated at envelope layer). */
const LoosePayload = z.record(z.string(), z.unknown());

/** event_type → payload schema. Unknown types: envelope-only (payload any object). */
export const eventPayloadSchemas: Partial<
  Record<string, z.ZodType<Record<string, unknown>>>
> = {
  [EVENT_TYPES.JD_RECEIVED]: JdReceivedPayloadSchema as z.ZodType<
    Record<string, unknown>
  >,
  [EVENT_TYPES.RESUME_RECEIVED]: ResumeReceivedPayloadSchema as z.ZodType<
    Record<string, unknown>
  >,
  [EVENT_TYPES.MATCH_REQUESTED]: MatchRequestedPayloadSchema as z.ZodType<
    Record<string, unknown>
  >,
  [EVENT_TYPES.JD_PARSED]: LoosePayload,
  [EVENT_TYPES.PROFILE_PREPARED]: LoosePayload,
  [EVENT_TYPES.DUPLICATE_REVIEW_REQUIRED]: LoosePayload,
  [EVENT_TYPES.MATCH_COMPLETED]: LoosePayload,
  [EVENT_TYPES.APPROVAL_REQUESTED]: LoosePayload,
  [EVENT_TYPES.APPROVAL_DECIDED]: LoosePayload,
  [EVENT_TYPES.AGENT_RUN_FAILED]: LoosePayload,
};

export function parseEventPayload(
  eventType: string,
  payload: unknown,
): Record<string, unknown> {
  const schema = eventPayloadSchemas[eventType];
  if (!schema) {
    return z.record(z.string(), z.unknown()).parse(payload ?? {});
  }
  return schema.parse(payload) as Record<string, unknown>;
}

/** Graph entryInput name → schema (design §5.1 / §9.2). */
export const entryInputSchemas = {
  ResumeReceivedPayload: ResumeReceivedPayloadSchema,
  JdReceivedPayload: JdReceivedPayloadSchema,
  MatchRequestedPayload: MatchRequestedPayloadSchema,
} as const;

export type EntryInputName = keyof typeof entryInputSchemas;

export function validateEntryInput(
  entryInputName: string | undefined,
  payload: unknown,
): Record<string, unknown> {
  if (!entryInputName) {
    return (payload ?? {}) as Record<string, unknown>;
  }
  const schema = entryInputSchemas[entryInputName as EntryInputName];
  if (!schema) {
    throw new Error(
      `DEFINITION_INVALID: unknown entryInput "${entryInputName}"`,
    );
  }
  return schema.parse(payload) as Record<string, unknown>;
}
