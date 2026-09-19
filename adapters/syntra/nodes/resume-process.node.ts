/**
 * syntra.resume.process
 *
 * The ticket's warning: "Resume text is PII — persistence must be ref_only or
 * redacted, or run detail leaks it." Read the `persistence` block below: the
 * answer here is different from what the ticket assumed, and the reason is
 * argued rather than asserted.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifySyntraError, postSyntra } from "../syntra-http.js";

/**
 * Four names for one resume, because the publisher varies: an upload sets
 * `document_id`, an internal raise sets `resumeId`. The engine implementation
 * did the same `??` chain inline.
 *
 * Removed by the per-binding `input_mapping`.
 */
const Input = z
  .object({
    resumeId: z.string().min(1).optional(),
    resume_id: z.string().min(1).optional(),
    document_id: z.string().min(1).optional(),
    documentId: z.string().min(1).optional(),
    candidateId: z.string().min(1).optional(),
    candidate_id: z.string().min(1).optional(),
  })
  .refine(
    (v) => Boolean(v.resumeId ?? v.resume_id ?? v.document_id ?? v.documentId),
    { message: "needs a resume id (resumeId, resume_id, document_id or documentId)" },
  );

/**
 * Identifiers and a status. Deliberately NOT the parsed profile — see
 * `persistence`. If anyone adds skills, a summary or a name here, the
 * persistence block below stops being correct.
 */
const Output = z.object({
  resumeId: z.string(),
  candidateId: z.string().nullable(),
  status: z.string(),
  stubbed: z.boolean(),
});

const Config = z.object({
  /**
   * 0-100, not 0-1, and the range was wrong here rather than everywhere else.
   *
   * SYNTRA scores on a percentage: `skillMatchScore` returns
   * `round(overlap / required * 100)`, and `score_threshold` on a requirement
   * defaults to 60. The authoring validator has always checked 0-100
   * (`validate-llm-graph.ts`), and every value ever stored in a graph is on
   * that scale — 125 of them, 60 / 68 / 70 / 80 / 90 / 94, not one below 1.
   *
   * So `.max(1)` rejected the only values anybody uses, which is why not one
   * of those versions is live. Declaring 0-1 did not make the system work in
   * fractions; it made the contract unable to describe the system.
   *
   * Default 0, because that is what SYNTRA does today: `MATCH_SKILL_FLOOR`
   * falls back to "0", so nothing is filtered out until somebody raises it.
   */
  matchThreshold: z
    .number()
    .min(0)
    .max(100)
    .default(0)
    .meta({ adminExposed: true, label: "Match threshold (0-100)" }),
  /**
   * How many candidates survive the tier-2 gate. SYNTRA's own default is 15
   * (`MATCH_TOP_N`), and until now nothing exposed it — so the only way to
   * change how many matches a run produces was a deployment variable.
   */
  topN: z
    .int()
    .positive()
    .max(500)
    .default(15)
    .meta({ adminExposed: true, label: "How many candidates to shortlist" }),
  rerank: z.boolean().optional().meta({ adminExposed: true }),
  hardFilters: z.array(z.string()).optional(),
  /** `prompt` removed — see the note on syntra.jd.process. */
});

function optionsFor(config: z.infer<typeof Config>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof config.matchThreshold === "number") out.matchThreshold = config.matchThreshold;
  if (typeof config.topN === "number") out.topN = config.topN;
  if (typeof config.rerank === "boolean") out.rerank = config.rerank;
  if (config.hardFilters?.length) out.hardFilters = config.hardFilters;
  return out;
}

export const resumeProcess = defineNode({
  key: "syntra.resume.process",
  version: "1.0.0",
  module: "syntra",
  shareable: true,

  title: "Process a resume",
  description:
    "Sends an uploaded resume to SYNTRA to be parsed into a candidate profile, then announces that the profile is ready.",
  tags: ["syntra", "resume", "intake"],

  input: Input,
  output: Output,
  config: Config,

  /** SYNTRA persists a candidate profile. Ours, so not `external`. */
  /**
   * What this node may publish.
   *
   * Published when a candidate profile is ready to be matched against.
   */
  emits: ["syntra.profile.prepared"],

  sideEffect: "internal_write",

  /**
   * One profile per resume document. A retry after a timeout re-parses the
   * same document rather than creating a second profile.
   */
  idempotency: {
    strategy: "natural_key",
    // Four names for one resume, exactly as the input's refine lists them.
    // syntra.resume.received carries document_id and none of the others.
    keyPaths: [["resumeId", "resume_id", "document_id", "documentId"]],
  },

  execution: {
    /** Parse plus embedding; slower than a JD. */
    timeoutMs: 90_000,
    retry: { limit: 3, backoff: "exponential", baseMs: 1_000 },
    classifyError: classifySyntraError,
    locks: [],
  },

  dependencies: ["http"],

  /**
   * DELIBERATE, AND A DEVIATION FROM THE TICKET'S ASSUMPTION.
   *
   * The ticket expects `ref_only` or `redact` because resume text is PII. That
   * is the right instinct and the wrong conclusion for this node, because the
   * resume text never passes through it.
   *
   * What actually crosses this boundary is a document id, an optional
   * candidate id, and a status. The resume body lives in SYNTRA and is fetched
   * there by id — this node holds the pointer, which is what `ref_only` would
   * have produced anyway. Declaring `redact` with nothing to redact would be
   * theatre, and would hide the ids that make a failed run diagnosable.
   *
   * THE LINE THAT MATTERS: this is only true while `output` carries no profile
   * data. The moment anyone adds skills, a summary, contact details or the
   * parsed body to the output schema, this block must become
   * `storeOutput: "redact"` with those paths listed. Reviewer: check this
   * whenever the output schema above changes.
   */
  persistence: {
    storeInput: "full",
    storeOutput: "full",
    redactPaths: [],
  },

  /**
   * CAPTURED from a live SYNTRA on 2026-08-24. The guessed `status` was right:
   *
   *     POST /internal/resumes/<id>/process   { candidateId }
   *     HTTP 200 (7.1s)  { "status": "processed", "resumeId": "<id>" }
   *
   * Confirmed on the row afterwards: the resume was parsed by an LLM
   * (`primary_role`, `total_experience`, summary), embedded, and marked
   * `processing_status=processed`.
   *
   * TWO THINGS THIS ENDPOINT DOES THAT THE NODE'S OUTPUT DOES NOT SHOW, both
   * worth knowing before anyone points it at real data:
   *
   *   1. When `candidateId` is supplied it OVERWRITES that candidate's
   *      identity fields — full name, email, phone, immigration status,
   *      location, linkedin, github — from whatever the LLM extracted.
   *   2. It ALWAYS runs the matching funnel afterwards. Unlike the JD path,
   *      `runForResume` has no `ORCH_DELEGATE_MATCH` guard, so calling this
   *      endpoint searches every open requirement and can write shortlist rows.
   *
   * Captured against a throwaway candidate + resume created for the purpose
   * and deleted afterwards, for reason 1.
   */
  fixtures: [
    {
      name: "processes an uploaded resume",
      input: {
        document_id: "b3d4c2a1-0000-4000-8000-000000000101",
        candidate_id: "c7e8f9a0-0000-4000-8000-000000000202",
      },
      config: { matchThreshold: 0, topN: 15 },
      expectedOutput: {
        resumeId: "b3d4c2a1-0000-4000-8000-000000000101",
        candidateId: "c7e8f9a0-0000-4000-8000-000000000202",
        status: "processed",
        stubbed: false,
      },
    },
    {
      name: "processes a resume with no candidate yet",
      input: { resumeId: "b3d4c2a1-0000-4000-8000-000000000101" },
      config: { matchThreshold: 0, topN: 15 },
      expectedOutput: {
        resumeId: "b3d4c2a1-0000-4000-8000-000000000101",
        candidateId: null,
        status: "processed",
        stubbed: false,
      },
    },
  ],

  run: async (ctx: NodeRunCtx, input, config) => {
    const resumeId =
      input.resumeId ?? input.resume_id ?? input.document_id ?? input.documentId!;
    const candidateId = input.candidateId ?? input.candidate_id ?? null;

    ctx.logger.info("calling Syntra resume process", { resumeId, orgId: ctx.orgId });
    const r = await postSyntra(`/internal/resumes/${resumeId}/process`, {
      candidateId,
      ...optionsFor(config),
    }, { signal: ctx.signal });

    ctx.emit({
      event_type: "syntra.profile.prepared",
      payload: {
        resumeId,
        candidateId,
        status: r.status,
        syntra: r,
      },
    });

    return {
      resumeId,
      candidateId,
      status: String(r.status ?? "ok"),
      stubbed: r.stub === true,
    };
  },
});
