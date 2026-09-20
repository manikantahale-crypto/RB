/**
 * orbit.placement.confirm — a DECLARATION, not an implementation.
 *
 * The engine runs this node: packages/orchestrator/src/nodes/orbit.ts
 * (orbitPlacementConfirm). This file is what `node_registry` and the editor project
 * — input, output, settings, what it publishes — written from that code on
 * 2026-09-20, line by line. Like `orch.branch.decision`, it stays out of
 * `nodeContracts` until the implementation moves in here at stage 5; until
 * then a change to the engine file is a change to this one.
 *
 * A person has been placed with a client: the placement row, with its rates and terms, is the record the revenue side builds on.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";


/** orbit.ts:216-250 */
const Input = z
  .object({
    candidate_id: z.string().optional(),
    candidateId: z.string().optional(),
    client_name: z.string().optional(),
    clientName: z.string().optional(),
    requirement_id: z.string().optional(),
    requirementId: z.string().optional(),
    start_date: z.string().optional(),
    startDate: z.string().optional(),
    end_date: z.string().nullable().optional(),
    confirmed_bill_rate: z.number().optional(),
    confirmedBillRate: z.number().optional(),
    confirmed_pay_rate: z.number().optional(),
    confirmedPayRate: z.number().optional(),
    employment_model: z.string().optional(),
    work_mode: z.string().optional(),
    location: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((v) => Boolean(v.candidate_id ?? v.candidateId), { message: "needs candidate_id" })
  .refine((v) => Boolean((v.client_name ?? v.clientName ?? "").trim()), { message: "needs client_name" });

const Output = z.object({
  placementId: z.string(),
  candidateId: z.string(),
  clientName: z.string(),
  branch_key: z.literal("placed"),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const placementConfirm = defineNode({
  key: "orbit.placement.confirm",
  version: "1.0.0",
  module: "orbit",
  shareable: false,

  title: "Confirm a placement",
  description:
    "Records that a person is placed with a client — dates, bill and pay rates, employment model — and announces the placement.",
  tags: ["orbit", "placement"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["orbit.placement.confirmed"],
  sideEffect: "internal_write",
  idempotency: { strategy: "natural_key", keyPaths: [["candidate_id", "candidateId"], ["client_name", "clientName"], ["start_date", "startDate"]] },

  execution: {
    /** One ORBIT call. UNVERIFIED — not yet timed here. */
    timeoutMs: 30_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: (e) => {
      const m = String((e as Error)?.message ?? e);
      if (/\b(400|404|422)\b|permanent-input|empty|no jobId|not found/i.test(m)) return "permanent_input";
      return "transient";
    },
    locks: [],
  },

  dependencies: ["http"],

  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
        {
          name: "a placement with its rates",
          input: { candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f", client_name: "Acme Corp", start_date: "2026-10-01", confirmed_bill_rate: 95, confirmed_pay_rate: 70, employment_model: "C2C", work_mode: "REMOTE" },
          config: {},
          expectedOutput: { placementId: "5d9e0b6a-0d1c-4f4e-9a3b-2c6d7e8f9a01", candidateId: "21d2cb25-09be-456f-a4b4-9872e485445f", clientName: "Acme Corp", branch_key: "placed" },
        },
      ],

  /**
   * Never called. The engine's own function runs this node; this
   * declaration must not be in `nodeContracts`, and throwing is how that
   * stays true.
   */
  run: async (ctx: NodeRunCtx) => {
    ctx.logger.error(
      "orbit.placement.confirm: declaration only — the live implementation is packages/orchestrator/src/nodes/orbit.ts",
    );
    throw new Error("orbit.placement.confirm is a declaration, not an implementation. It must not be in nodeContracts.");
  },
});
