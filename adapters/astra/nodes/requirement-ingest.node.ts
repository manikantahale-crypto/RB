/**
 * astra.requirement.ingest
 *
 * A requirement that arrives as data — an API call, a form — rather than an email. Same row, no email shaping.
 *
 * Ported from the engine function `astraRequirementIngest` in packages/orchestrator/src/nodes/astra.ts
 * on 2026-09-20 — same request, same response fields read, same event
 * published. That function stays in the engine registry; this contract
 * overrides it by key when the worker composes the registry, the way the
 * nine SYNTRA nodes did.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyAstraError, postAstra } from "../astra-http.js";
import { jobIdOf, rawTextOf } from "../fields.js";

const Input = z
  .object({
    title: z.string().optional(),
    raw_text: z.string().optional(),
    rawText: z.string().optional(),
    body: z.string().optional(),
    content: z.string().optional(),
    location: z.string().optional(),
    company_name: z.string().optional(),
    companyName: z.string().optional(),
    channel_type: z.string().optional(),
    source: z.string().optional(),
    jobId: z.string().optional(),
    requirement_id: z.string().optional(),
    requirementId: z.string().optional(),
  })
  .refine((v) => Boolean((rawTextOf(v) ?? "").trim()), {
    message: "needs the requirement text — raw_text, rawText, body or content",
  });

const Output = z.object({
  jobId: z.string(),
  channel_type: z.string(),
  duplicate: z.boolean(),
  stubbed: z.boolean(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const requirementIngest = defineNode({
  key: "astra.requirement.ingest",
  version: "1.0.0",
  module: "astra",
  shareable: false,

  title: "Take a requirement in from any source",
  description:
    "Inserts a requirement from text and a title, whatever channel it came by, and announces the requirement received.",
  tags: ["astra", "intake"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["astra.requirement.received"],
  sideEffect: "internal_write",
  idempotency: { strategy: "natural_key", keyPaths: [["jobId", "requirement_id", "requirementId", "title"]] },

  execution: {
    /** One ASTRA call. UNVERIFIED — not yet timed here. */
    timeoutMs: 60_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: (e) =>
      /returned no jobId/.test(String((e as Error)?.message ?? e)) ? "permanent_input" : classifyAstraError(e),
    locks: [],
  },

  dependencies: ["http"],

  persistence: { storeInput: "redact", storeOutput: "full", redactPaths: ["raw_text", "rawText", "body", "content"] },

  fixtures: [
        {
          name: "a requirement posted as data",
          input: { title: "Data Engineer", raw_text: "Snowflake, dbt, Airflow. Remote. 5+ years.", channel_type: "API", source: "orch" },
          config: {},
          expectedOutput: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", channel_type: "API", duplicate: false, stubbed: false },
        },
      ],


run: async (ctx: NodeRunCtx, input) => {
  const body = {
    title: input.title,
    raw_text: rawTextOf(input),
    location: input.location,
    company_name: input.company_name ?? input.companyName,
    channel_type: input.channel_type ?? "API",
    source: input.source ?? "orch",
  };
  ctx.logger.info("calling Astra ingest", { orgId: ctx.orgId });
  const r = await postAstra("/internal/astra/requirements/ingest", body, { signal: ctx.signal });

  const jobId = String(
    r.jobId ?? r.requirement_id ?? (r.stub ? (jobIdOf(input) ?? crypto.randomUUID()) : ""),
  );
  if (!jobId) throw new Error("astra.requirement.ingest: Astra returned no jobId");

  ctx.emit({
    event_type: "astra.requirement.received",
    payload: {
      jobId,
      requirement_id: jobId,
      title: r.title ?? body.title ?? null,
      channel_type: body.channel_type,
      syntra: r,
    },
  });
  return {
    jobId,
    channel_type: body.channel_type,
    duplicate: Boolean(r.duplicate),
    stubbed: r.stub === true,
  };
},
});
