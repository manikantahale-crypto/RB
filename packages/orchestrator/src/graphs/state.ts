import { z } from 'zod';

/** Graph state schemas referenced by definition.stateSchema (design §4.3 / §5.1). */
export const ResumeIntakeStateSchema = z.object({
  result: z.string().default(''),
  profile: z
    .object({
      candidateId: z.string(),
      documentId: z.string().optional(),
      resumeId: z.string().optional(),
      summary: z.string(),
      skills: z.array(z.string()),
      yearsExperience: z.number().nullable(),
      parserVersion: z.string(),
    })
    .nullable()
    .optional(),
  matches: z
    .array(
      z.object({
        jobId: z.string(),
        resumeId: z.string(),
        candidateId: z.string().optional(),
        score: z.number(),
        matchedSkills: z.array(z.string()),
        missingSkills: z.array(z.string()),
      }),
    )
    .default([]),
});

export const stateSchemas = {
  ResumeIntakeState: ResumeIntakeStateSchema,
} as const;

export type StateSchemaName = keyof typeof stateSchemas;

export function assertKnownStateSchema(name: string | undefined): void {
  if (!name) return;
  if (!(name in stateSchemas)) {
    throw new Error(`DEFINITION_INVALID: unknown stateSchema "${name}"`);
  }
}
