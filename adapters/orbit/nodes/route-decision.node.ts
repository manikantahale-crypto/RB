/**
 * orbit.route.decision
 *
 * After a lifecycle move, which way does the workflow go? placed → the placement path; hold → announce the hold and stop; anything else → the active path. Reads the state the transition produced — from the trigger, or from the transition step through an `inputs` map (branch_key ← transition.branch_key).
 *
 * Ported from the engine function `orbitRouteDecision` in packages/orchestrator/src/nodes/orbit.ts
 * on 2026-09-20 — same request, same response fields read, same event
 * published. That function stays in the engine registry; this contract
 * overrides it by key when the worker composes the registry, the way the
 * nine SYNTRA nodes did.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { candidateIdOf } from "../fields.js";

const Input = z.object({
  to_state: z.string().optional(),
  toState: z.string().optional(),
  /** What an earlier step decided, when the definition maps it in. */
  branch_key: z.string().optional(),
  candidate_id: z.string().optional(),
  candidateId: z.string().optional(),
  note: z.string().nullable().optional(),
});

const Output = z.object({
  branch_key: z.enum(["placed", "hold", "active"]),
  toState: z.string(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const orbitRouteDecision = defineNode({
  key: "orbit.route.decision",
  version: "1.0.0",
  module: "orbit",
  /**
   * ORBIT'S OWN GATE, NOT LENT.
   * placed / hold / active is a branch on ORBIT's lifecycle. Outside a bench
   * move it has nothing to route.
   */
  shareable: false,

  title: "Route after a bench move",
  description:
    "Sends the workflow down the placement path, the hold path or the active path according to the state a person just moved to; a hold is announced.",
  tags: ["orbit", "control", "routing"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["orbit.bench.hold"],
  sideEffect: "control",
  idempotency: { strategy: "pure" },

  execution: {
    /** A comparison on the payload. */
    timeoutMs: 5_000,
    retry: { limit: 0, backoff: "none", baseMs: 1 },
    classifyError: () => "permanent_input",
    locks: [],
  },

  dependencies: [],

  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
        {
          name: "PLACED goes down the placement path",
          input: { to_state: "PLACED" },
          config: {},
          expectedOutput: { branch_key: "placed", toState: "PLACED" },
        },
        {
          name: "HOLD is announced and stops",
          input: { to_state: "HOLD", candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f", note: "visa pending" },
          config: {},
          expectedOutput: { branch_key: "hold", toState: "HOLD" },
        },
        {
          name: "an earlier step's branch_key is honoured",
          input: { branch_key: "placed", candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f" },
          config: {},
          expectedOutput: { branch_key: "placed", toState: "PLACED" },
        },
      ],


  run: async (ctx: NodeRunCtx, input) => {
    const toState = String(input.to_state ?? input.toState ?? input.branch_key ?? "").toUpperCase();
    const branch_key =
      toState === "PLACED" || input.branch_key === "placed"
        ? ("placed" as const)
        : toState === "HOLD" || toState === "IGNORE"
          ? ("hold" as const)
          : ("active" as const);

    if (branch_key === "hold") {
      ctx.emit({
        event_type: "orbit.bench.hold",
        payload: {
          candidate_id: candidateIdOf(input) ?? null,
          to_state: toState || "HOLD",
          reason: input.note ?? "lifecycle_hold",
        },
      });
    }
    return { branch_key, toState: branch_key === "placed" ? "PLACED" : toState || "HOLD" };
  },
});
