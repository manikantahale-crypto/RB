/**
 * astra.requirement.quality
 *
 * A cheap first look before the full enrichment: is this a real requirement, and how sure are we? The two numbers it produces are what the route decision branches on.
 *
 * Ported from the engine function `astraRequirementQuality` in packages/orchestrator/src/nodes/astra.ts
 * on 2026-09-20 — same request, same response fields read, same event
 * published. That function stays in the engine registry; this contract
 * overrides it by key when the worker composes the registry, the way the
 * nine SYNTRA nodes did.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyAstraError, postAstra } from "../astra-http.js";
import { jobIdOf, rawTextOf } from "../fields.js";

const Input = z.object({
  jobId: z.string().optional(),
  requirement_id: z.string().optional(),
  requirementId: z.string().optional(),
  title: z.string().optional(),
  raw_text: z.string().optional(),
  rawText: z.string().optional(),
  body: z.string().optional(),
  content: z.string().optional(),
  required_skills: z.array(z.string()).optional(),
  requiredSkills: z.array(z.string()).optional(),
  location: z.string().optional(),
});

const Output = z.object({
  jobId: z.string().nullable(),
  is_actionable: z.boolean(),
  confidence_score: z.number().min(0).max(1),
  validation_details: z.unknown().optional(),
  stubbed: z.boolean(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const requirementQuality = defineNode({
  key: "astra.requirement.quality",
  version: "1.0.0",
  module: "astra",
  shareable: false,

  title: "Judge a requirement's quality",
  description:
    "Asks ASTRA for a quick quality read on a requirement — actionable or not, and a confidence — and announces the score for the branch that follows.",
  tags: ["astra", "quality", "scoring"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["astra.requirement.scored"],
  sideEffect: "read",
  idempotency: { strategy: "pure" },

  execution: {
    /** One ASTRA call, no LLM on that side (the engine called it the cheap score). UNVERIFIED. */
    timeoutMs: 30_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: classifyAstraError,
    locks: [],
  },

  dependencies: ["http"],

  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
        {
          name: "a requirement with skills and a location reads as actionable",
          input: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", title: "Java Developer", required_skills: ["java", "spring"], location: "Austin, TX" },
          config: {},
          expectedOutput: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", is_actionable: true, confidence_score: 0.75, stubbed: false },
        },
      ],


run: async (ctx: NodeRunCtx, input) => {
  const jobId = jobIdOf(input) ?? null;
  const body = {
    jobId,
    requirement_id: jobId,
    title: input.title,
    raw_text: rawTextOf(input),
    required_skills: input.required_skills ?? input.requiredSkills,
    location: input.location,
  };
  ctx.logger.info("calling Astra quality", { jobId, orgId: ctx.orgId });
  const r = await postAstra("/internal/astra/requirements/quality", body, { signal: ctx.signal });

  // The stub says nothing about quality; the engine function read it as
  // actionable at 0.75 so a local flow could continue.
  const is_actionable = r.stub ? true : Boolean(r.is_actionable ?? r.isActionable);
  const confidence_score = r.stub ? 0.75 : Number(r.confidence_score ?? r.confidenceScore ?? 0);
  const validation_details = r.validation_details ?? r.validationDetails;

  ctx.emit({
    event_type: "astra.requirement.scored",
    payload: {
      jobId,
      requirement_id: jobId,
      is_actionable,
      confidence_score,
      validation_details,
      syntra: r,
    },
  });
  return { jobId, is_actionable, confidence_score, validation_details, stubbed: r.stub === true };
},
});
