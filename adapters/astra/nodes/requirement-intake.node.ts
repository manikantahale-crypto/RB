/**
 * astra.requirement.intake — a DECLARATION, not an implementation.
 *
 * The engine runs this node: packages/orchestrator/src/nodes/astra.ts
 * (astraRequirementIntake). This file is what `node_registry` and the editor project
 * — input, output, settings, what it publishes — written from that code on
 * 2026-09-20, line by line. Like `orch.branch.decision`, it stays out of
 * `nodeContracts` until the implementation moves in here at stage 5; until
 * then a change to the engine file is a change to this one.
 *
 * An email arrives as a requirement. The body is the JD; SYNTRA's ASTRA intake parses it into a requirement row and answers with its id. The email body is a source document and is not stored on the run.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";


/** What the engine reads from the trigger (astra.ts:128-140). The body may arrive under four names. */
const Input = z
  .object({
    subject: z.string().optional(),
    title: z.string().optional(),
    raw_text: z.string().optional(),
    rawText: z.string().optional(),
    body: z.string().optional(),
    content: z.string().optional(),
    from: z.string().optional(),
    source_email: z.string().optional(),
    source: z.string().optional(),
    location: z.string().optional(),
    jobId: z.string().optional(),
    requirement_id: z.string().optional(),
  })
  .refine((v) => Boolean((v.raw_text ?? v.rawText ?? v.body ?? v.content ?? "").trim()), {
    message: "needs the email body — raw_text, rawText, body or content",
  });

const Output = z.object({
  /** The requirement SYNTRA created or found. */
  jobId: z.string(),
  title: z.string().nullable(),
  channel_type: z.literal("EMAIL"),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const requirementIntake = defineNode({
  key: "astra.requirement.intake",
  version: "1.0.0",
  module: "astra",
  shareable: false,

  title: "Take a requirement in from an email",
  description:
    "Hands an email's body to SYNTRA's ASTRA intake, which parses it into a requirement, and announces the requirement received.",
  tags: ["astra", "intake", "email"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["astra.requirement.received"],
  sideEffect: "external",
  idempotency: { strategy: "natural_key", keyPaths: [["jobId", "requirement_id"]] },

  execution: {
    /** One SYNTRA call that parses with an LLM. UNVERIFIED — not yet timed here. */
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
          name: "an email with a JD in its body becomes a requirement",
          input: {
            subject: "Java Developer — Austin, TX",
            from: "vendor@example.invalid",
            body: "Client needs a Java developer, 6+ years, Spring Boot, AWS. Austin TX, hybrid. C2C.",
          },
          config: {},
          expectedOutput: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", title: "Java Developer — Austin, TX", channel_type: "EMAIL" },
        },
      ],

  /**
   * Never called. The engine's own function runs this node; this
   * declaration must not be in `nodeContracts`, and throwing is how that
   * stays true.
   */
  run: async (ctx: NodeRunCtx) => {
    ctx.logger.error(
      "astra.requirement.intake: declaration only — the live implementation is packages/orchestrator/src/nodes/astra.ts",
    );
    throw new Error("astra.requirement.intake is a declaration, not an implementation. It must not be in nodeContracts.");
  },
});
