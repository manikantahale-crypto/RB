/**
 * astra.requirement.intake
 *
 * An email arrives as a requirement. The body is the JD; ASTRA's intake parses it into a requirement row and answers with its id. The email body is a source document and is not stored on the run.
 *
 * Ported from the engine function `astraRequirementIntake` in packages/orchestrator/src/nodes/astra.ts
 * on 2026-09-20 — same request, same response fields read, same event
 * published. That function stays in the engine registry; this contract
 * overrides it by key when the worker composes the registry, the way the
 * nine SYNTRA nodes did. *
 * DOES NOT ANNOUNCE THE REQUIREMENT. ASTRA's service writes
 * `astra.requirement.received` to the outbox inside the transaction that
 * creates the row (astra.service.js `writeRequirementReceived`), with the
 * flow's correlation id this node hands it. The engine function emitted a
 * second copy — two announcements, two runs of whatever is bound to it
 * (onboarding path 4.4). Fixed 2026-09-20: the service owns the emit.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyAstraError, postAstra } from "../astra-http.js";
import { jobIdOf, rawTextOf } from "../fields.js";

/** What the engine read from the trigger. The body may arrive under four names. */
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
    requirementId: z.string().optional(),
  })
  .refine((v) => Boolean((rawTextOf(v) ?? "").trim()), {
    message: "needs the email body — raw_text, rawText, body or content",
  });

const Output = z.object({
  /** The requirement ASTRA created or found. */
  jobId: z.string(),
  title: z.string().nullable(),
  channel_type: z.literal("EMAIL"),
  stubbed: z.boolean(),
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
    "Hands an email's body to ASTRA's intake, which parses it into a requirement, and announces the requirement received.",
  tags: ["astra", "intake", "email"],

  input: Input,
  output: Output,
  config: Config,

  emits: [],
  sideEffect: "external",
  idempotency: { strategy: "natural_key", keyPaths: [["jobId", "requirement_id", "requirementId", "subject", "title"]] },

  execution: {
    /** One ASTRA call that parses with an LLM. UNVERIFIED — not yet timed here. */
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
          name: "an email with a JD in its body becomes a requirement",
          input: {
            subject: "Java Developer — Austin, TX",
            from: "vendor@example.invalid",
            body: "Client needs a Java developer, 6+ years, Spring Boot, AWS. Austin TX, hybrid. C2C.",
          },
          config: {},
          expectedOutput: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", title: "Java Developer — Austin, TX", channel_type: "EMAIL", stubbed: false },
        },
      ],


  run: async (ctx: NodeRunCtx, input) => {
    const body = {
      subject: input.subject ?? input.title,
      body: rawTextOf(input),
      from: input.from ?? input.source_email ?? input.source,
      title: input.title,
      location: input.location,
      correlation_id: ctx.correlationId ?? undefined,
    };
    ctx.logger.info("calling Astra email intake", { orgId: ctx.orgId });
    const r = await postAstra("/internal/astra/intake/email", body, { signal: ctx.signal });

    // Under the dev stub ASTRA answers nothing. The engine function minted
    // an id so a local flow could continue; the same here, and `stubbed`
    // says so on the row.
    const jobId = String(
      r.jobId ?? r.requirement_id ?? jobIdOf(input) ?? (r.stub ? crypto.randomUUID() : ""),
    );
    if (!jobId) throw new Error("astra.requirement.intake: Astra returned no jobId");

    // The endpoint answers `{ created, jobId, job }`; the title is on the job.
    const title = (r.title ?? r.job?.title ?? body.subject ?? null) as string | null;
    return { jobId, title, channel_type: "EMAIL" as const, stubbed: r.stub === true };
  },
});
