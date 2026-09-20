/**
 * astra.requirement.normalize
 *
 * The full enrichment: ASTRA reads the requirement text with an LLM and fills title, company, location, experience, visa, employment type, skills and the summary. This is the call that, when it failed, used to be recorded as a success with no skills (ref/SYNTRA_Matching_Study.md §6).
 *
 * Ported from the engine function `astraRequirementNormalize` in packages/orchestrator/src/nodes/astra.ts
 * on 2026-09-20 — same request, same response fields read, same event
 * published. That function stays in the engine registry; this contract
 * overrides it by key when the worker composes the registry, the way the
 * nine SYNTRA nodes did.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyAstraError, postAstra } from "../astra-http.js";
import { jobIdOf, rawTextOf } from "../fields.js";

/** Needs the requirement id; the text is read by ASTRA from the row when absent. */
const Input = z
  .object({
    jobId: z.string().optional(),
    requirement_id: z.string().optional(),
    requirementId: z.string().optional(),
    raw_text: z.string().optional(),
    rawText: z.string().optional(),
    body: z.string().optional(),
    content: z.string().optional(),
    title: z.string().optional(),
    channel_type: z.string().optional(),
  })
  .refine((v) => Boolean(jobIdOf(v)), {
    message: "needs jobId — there is nothing to normalize without one",
  })
  .refine((v) => rawTextOf(v) === undefined || rawTextOf(v)!.trim() !== "", {
    message: "raw_text is present but empty — unprocessable JD content",
  });

const Output = z.object({
  jobId: z.string(),
  status: z.string(),
  is_actionable: z.boolean(),
  confidence_score: z.number().min(0).max(1),
  parser_version: z.string(),
  stubbed: z.boolean(),
});

const Config = z.object({
  /** Extra instruction for the extraction, appended to ASTRA's prompt. Not exposed: it changes what the parse means. */
  prompt: z.string().optional(),
  agentName: z.string().optional(),
});

export const requirementNormalize = defineNode({
  key: "astra.requirement.normalize",
  version: "1.0.0",
  module: "astra",
  shareable: false,

  title: "Enrich a requirement",
  description:
    "Asks ASTRA to read the requirement in full — title, client, location, experience, visa, skills, summary — and announces it normalized with its quality read.",
  tags: ["astra", "enrichment", "llm"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["astra.requirement.normalized"],
  sideEffect: "internal_write",
  idempotency: { strategy: "natural_key", keyPaths: [["jobId", "requirement_id", "requirementId"]] },

  execution: {
    /** One ASTRA call that parses with an LLM through the provider chain. UNVERIFIED — not yet timed here. */
    timeoutMs: 90_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: classifyAstraError,
    locks: [],
  },

  dependencies: ["http"],

  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
        {
          name: "a requirement is read in full",
          input: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11" },
          config: {},
          expectedOutput: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", status: "normalized", is_actionable: true, confidence_score: 0.82, parser_version: "astra-intelligence-v1", stubbed: false },
        },
      ],


run: async (ctx: NodeRunCtx, input, config) => {
  const jobId = jobIdOf(input)!;
  const prompt = typeof config.prompt === "string" && config.prompt.trim() ? config.prompt.trim() : undefined;
  const body = {
    jobId,
    requirement_id: jobId,
    raw_text: rawTextOf(input),
    title: input.title,
    channel_type: input.channel_type,
    ...(prompt ? { prompt } : {}),
  };
  ctx.logger.info("calling Astra normalize", { jobId, orgId: ctx.orgId });
  const r = await postAstra(`/internal/astra/requirements/${jobId}/normalize`, body, { signal: ctx.signal });

  const is_actionable = Boolean(r.is_actionable ?? r.isActionable ?? true);
  const confidence_score = r.stub ? 0.9 : Number(r.confidence_score ?? r.confidenceScore ?? 0);
  const parser_version = String(
    r.parser_version ?? r.parserVersion ?? (r.stub ? "orch.stub.astra.v1" : "astra-intelligence-v1"),
  );
  const status = String(r.status ?? "normalized");

  ctx.emit({
    event_type: "astra.requirement.normalized",
    payload: {
      jobId,
      requirement_id: jobId,
      status,
      parser_version,
      is_actionable,
      confidence_score,
      syntra: r,
    },
  });
  return { jobId, status, is_actionable, confidence_score, parser_version, stubbed: r.stub === true };
},
});
