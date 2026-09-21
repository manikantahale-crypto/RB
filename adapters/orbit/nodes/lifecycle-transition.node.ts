/**
 * orbit.lifecycle.transition
 *
 * A person on the bench moves between states — AVAILABLE, BENCH, NOTICE, PLACED, HOLD, PRIORITIZE, OLD, IGNORE. ORBIT enforces which moves are allowed; this node asks for one and reports where the person ended up. Lent to other modules: ASTRA and SYNTRA both move people.
 *
 * Ported from the engine function `orbitLifecycleTransition` in packages/orchestrator/src/nodes/orbit.ts
 * on 2026-09-20 — same request, same response fields read, same event
 * published. That function stays in the engine registry; this contract
 * overrides it by key when the worker composes the registry, the way the
 * nine SYNTRA nodes did.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyOrbitError, postOrbit } from "../orbit-http.js";
import { candidateIdOf, placementIdOf } from "../fields.js";

const Input = z
  .object({
    candidate_id: z.string().optional(),
    candidateId: z.string().optional(),
    to_state: z.string().optional(),
    toState: z.string().optional(),
    from_state: z.string().optional(),
    fromState: z.string().optional(),
    note: z.string().nullable().optional(),
    context: z.unknown().optional(),
    /** The org the trigger carried; ORBIT records it on the transition. */
    organization_id: z.string().optional(),
  })
  .refine((v) => Boolean(candidateIdOf(v)), { message: "needs candidate_id" })
  .refine((v) => Boolean((v.to_state ?? v.toState ?? "").trim()), { message: "needs to_state" });

const Output = z.object({
  candidateId: z.string(),
  fromState: z.string().nullable(),
  toState: z.string(),
  /** placed → the placement path; active → everything else. */
  branch_key: z.enum(["placed", "active"]),
  stubbed: z.boolean(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const lifecycleTransition = defineNode({
  key: "orbit.lifecycle.transition",
  version: "1.0.0",
  module: "orbit",
  shareable: true,

  title: "Move a person to a bench state",
  description:
    "Asks ORBIT to move a person to a lifecycle state, which ORBIT allows or refuses by its own rules, and announces the transition.",
  tags: ["orbit", "lifecycle", "bench"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["orbit.lifecycle.transitioned"],
  sideEffect: "internal_write",
  idempotency: { strategy: "natural_key", keyPaths: [["candidate_id", "candidateId"], ["to_state", "toState"]] },

  execution: {
    /** One ORBIT call, no LLM. UNVERIFIED — not yet timed here. */
    timeoutMs: 30_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: classifyOrbitError,
    locks: [],
  },

  dependencies: ["http"],

  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
        {
          name: "a person on the bench is placed",
          input: { candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f", to_state: "PLACED", note: "offer accepted" },
          config: {},
          expectedOutput: { candidateId: "21d2cb25-09be-456f-a4b4-9872e485445f", fromState: "BENCH", toState: "PLACED", branch_key: "placed", stubbed: false },
        },
      ],


  run: async (ctx: NodeRunCtx, input) => {
    const candidateId = candidateIdOf(input)!;
    const toState = String(input.to_state ?? input.toState ?? "").toUpperCase();
    ctx.logger.info("calling Orbit lifecycle transition", { candidateId, toState, orgId: ctx.orgId });
    const r = await postOrbit(
      `/internal/orbit/candidates/${candidateId}/lifecycle/transition`,
      {
        to_state: toState,
        note: input.note ?? null,
        context: input.context ?? null,
        organization_id: input.organization_id ?? ctx.orgId,
        transitioned_by: null,
      },
      { signal: ctx.signal },
    );

    const fromState = (r.state?.previous_state ?? input.from_state ?? input.fromState ?? null) as string | null;
    const newState = String(r.state?.state ?? toState);
    ctx.emit({
      event_type: "orbit.lifecycle.transitioned",
      payload: {
        candidate_id: candidateId,
        from_state: fromState,
        to_state: newState,
        note: input.note ?? null,
        orbit: r,
      },
    });
    return {
      candidateId,
      fromState,
      toState: newState,
      branch_key: newState === "PLACED" ? ("placed" as const) : ("active" as const),
      stubbed: r.stub === true,
    };
  },
});
