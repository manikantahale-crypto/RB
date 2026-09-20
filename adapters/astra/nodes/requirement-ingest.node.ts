/**
 * astra.requirement.ingest — a DECLARATION, not an implementation.
 *
 * The engine runs this node: packages/orchestrator/src/nodes/astra.ts
 * (astraRequirementIngest). This file is what `node_registry` and the editor project
 * — input, output, settings, what it publishes — written from that code on
 * 2026-09-20, line by line. Like `orch.branch.decision`, it stays out of
 * `nodeContracts` until the implementation moves in here at stage 5; until
 * then a change to the engine file is a change to this one.
 *
 * A requirement that arrives as data — an API call, a form — rather than an email. Same row, no email shaping.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";


/** astra.ts:186-204 */
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
  })
  .refine((v) => Boolean((v.raw_text ?? v.rawText ?? v.body ?? v.content ?? "").trim()), {
    message: "needs the requirement text — raw_text, rawText, body or content",
  });

const Output = z.object({
  jobId: z.string(),
  channel_type: z.string(),
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
  idempotency: { strategy: "natural_key", keyPaths: [["jobId", "requirement_id"]] },

  execution: {
    /** One SYNTRA call. UNVERIFIED — not yet timed here. */
    timeoutMs: 60_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: (e) => {
      const m = String((e as Error)?.message ?? e);
      if (/\b(400|404|422)\b|permanent-input|empty|no jobId|not found/i.test(m)) return "permanent_input";
      return "transient";
    },
    locks: [],
  },

  dependencies: ["http"],

  persistence: { storeInput: "redact", storeOutput: "full", redactPaths: ["raw_text", "rawText", "body", "content"] },

  fixtures: [
        {
          name: "a requirement posted as data",
          input: { title: "Data Engineer", raw_text: "Snowflake, dbt, Airflow. Remote. 5+ years.", channel_type: "API", source: "orch" },
          config: {},
          expectedOutput: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", channel_type: "API" },
        },
      ],

  /**
   * Never called. The engine's own function runs this node; this
   * declaration must not be in `nodeContracts`, and throwing is how that
   * stays true.
   */
  run: async (ctx: NodeRunCtx) => {
    ctx.logger.error(
      "astra.requirement.ingest: declaration only — the live implementation is packages/orchestrator/src/nodes/astra.ts",
    );
    throw new Error("astra.requirement.ingest is a declaration, not an implementation. It must not be in nodeContracts.");
  },
});
