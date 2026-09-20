/**
 * astra.route.decision
 *
 * The gate at the end of ASTRA's intake: an actionable requirement is handed to SYNTRA (syntra.jd.normalized), anything else is announced rejected. Which two events it publishes is configuration — the defaults are the platform's chain.
 *
 * Ported from the engine function `astraRouteDecision` in packages/orchestrator/src/nodes/astra.ts
 * on 2026-09-20 — same request, same response fields read, same event
 * published. That function stays in the engine registry; this contract
 * overrides it by key when the worker composes the registry, the way the
 * nine SYNTRA nodes did.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { jobIdOf } from "../fields.js";

const Input = z
  .object({
    jobId: z.string().optional(),
    requirement_id: z.string().optional(),
    requirementId: z.string().optional(),
    is_actionable: z.boolean().optional(),
    isActionable: z.boolean().optional(),
    confidence_score: z.number().optional(),
    confidenceScore: z.number().optional(),
    parser_version: z.string().optional(),
    parserVersion: z.string().optional(),
    /** The event that started the run, when the trigger carries it; passed on as source_event_id. */
    event_id: z.string().optional(),
  })
  .refine((v) => Boolean(jobIdOf(v)), { message: "needs jobId" });

const Output = z.object({
  /** pass → the actionable event; reject → the rejected event. */
  branch_key: z.enum(["pass", "reject"]),
  jobId: z.string(),
  /** Why it was rejected; null on pass. */
  reason: z.string().nullable(),
});

const Config = z.object({
  /** Below this confidence a requirement is rejected even when actionable. */
  minConfidence: z.number().min(0).max(1).default(0).meta({ adminExposed: true, label: "Minimum confidence" }),
  /** The event published when the requirement goes forward. */
  onActionable: z.string().default("syntra.jd.normalized"),
  /** The event published when it does not. */
  onRejected: z.string().default("astra.requirement.rejected"),
  agentName: z.string().optional(),
});

export const routeDecision = defineNode({
  key: "astra.route.decision",
  version: "1.0.0",
  module: "astra",
  shareable: false,

  title: "Send a requirement on, or reject it",
  description:
    "Reads the quality verdict on a requirement and either hands it to SYNTRA as a normalized JD or announces it rejected, with the reason.",
  tags: ["astra", "control", "routing"],

  input: Input,
  output: Output,
  config: Config,

  emits: [{ fromConfig: "onActionable" }, { fromConfig: "onRejected" }],
  sideEffect: "control",
  idempotency: { strategy: "pure" },

  execution: {
    /** Arithmetic on the payload; two possible emits. */
    timeoutMs: 5_000,
    retry: { limit: 0, backoff: "none", baseMs: 1 },
    classifyError: () => "permanent_input",
    locks: [],
  },

  dependencies: [],

  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
        {
          name: "an actionable requirement goes forward",
          input: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", is_actionable: true, confidence_score: 0.82 },
          config: { minConfidence: 0.5, onActionable: "syntra.jd.normalized", onRejected: "astra.requirement.rejected" },
          expectedOutput: { branch_key: "pass", jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", reason: null },
        },
        {
          name: "actionable but not confident enough is rejected",
          input: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", is_actionable: true, confidence_score: 0.3 },
          config: { minConfidence: 0.5, onActionable: "syntra.jd.normalized", onRejected: "astra.requirement.rejected" },
          expectedOutput: { branch_key: "reject", jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", reason: "confidence_below_min (0.3 < 0.5)" },
        },
        {
          name: "not actionable is rejected whatever the confidence",
          input: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", is_actionable: false, confidence_score: 0.95 },
          config: { minConfidence: 0, onActionable: "syntra.jd.normalized", onRejected: "astra.requirement.rejected" },
          expectedOutput: { branch_key: "reject", jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", reason: "not_actionable" },
        },
      ],


run: async (ctx: NodeRunCtx, input, config) => {
  const jobId = jobIdOf(input)!;
  const is_actionable = Boolean(input.is_actionable ?? input.isActionable);
  const confidence_score = Number(input.confidence_score ?? input.confidenceScore ?? 0);
  const parser_version = input.parser_version ?? input.parserVersion ?? null;

  if (is_actionable && confidence_score >= config.minConfidence) {
    ctx.emit({
      event_type: config.onActionable,
      payload: {
        jobId,
        requirement_id: jobId,
        status: "normalized",
        is_actionable: true,
        confidence_score,
        parser_version,
        source_event_id: input.event_id ?? null,
      },
    });
    return { branch_key: "pass" as const, jobId, reason: null };
  }

  const reason = !is_actionable
    ? "not_actionable"
    : `confidence_below_min (${confidence_score} < ${config.minConfidence})`;
  ctx.emit({
    event_type: config.onRejected,
    payload: {
      jobId,
      requirement_id: jobId,
      status: "rejected",
      is_actionable,
      confidence_score,
      reason,
      source_event_id: input.event_id ?? null,
    },
  });
  return { branch_key: "reject" as const, jobId, reason };
},
});
