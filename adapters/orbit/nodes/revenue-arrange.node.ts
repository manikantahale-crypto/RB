/**
 * orbit.revenue.arrange
 *
 * How the company earns on a placement — a markup, a fee, a formula — attached to the placement row. Money is described, not moved; the arrangement is a record.
 *
 * Ported from the engine function `orbitRevenueArrange` in packages/orchestrator/src/nodes/orbit.ts
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
    placement_id: z.string().optional(),
    placementId: z.string().optional(),
    arrangement_type: z.string().optional(),
    arrangementType: z.string().optional(),
    value: z.number().optional(),
    notes: z.string().nullable().optional(),
    custom_formula: z.string().nullable().optional(),
    customFormula: z.string().nullable().optional(),
    organization_id: z.string().optional(),
  })
  .refine((v) => Boolean(placementIdOf(v)), { message: "needs placement_id" });

const Output = z.object({
  placementId: z.string(),
  arrangementType: z.string(),
  value: z.number(),
  stubbed: z.boolean(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const revenueArrange = defineNode({
  key: "orbit.revenue.arrange",
  version: "1.0.0",
  module: "orbit",
  shareable: false,

  title: "Record how a placement earns",
  description:
    "Attaches a revenue arrangement — markup, fee or formula — to a placement and announces it.",
  tags: ["orbit", "revenue", "placement"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["orbit.revenue.arranged"],
  sideEffect: "internal_write",
  idempotency: { strategy: "natural_key", keyPaths: [["placement_id", "placementId"], ["arrangement_type", "arrangementType"]] },

  execution: {
    /** One ORBIT call. UNVERIFIED — not yet timed here. */
    timeoutMs: 30_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: classifyOrbitError,
    locks: [],
  },

  dependencies: ["http"],

  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
        {
          name: "a markup on a placement",
          input: { placement_id: "5d9e0b6a-0d1c-4f4e-9a3b-2c6d7e8f9a01", arrangement_type: "MARKUP", value: 25 },
          config: {},
          expectedOutput: { placementId: "5d9e0b6a-0d1c-4f4e-9a3b-2c6d7e8f9a01", arrangementType: "MARKUP", value: 25, stubbed: false },
        },
      ],


  run: async (ctx: NodeRunCtx, input) => {
    const placementId = placementIdOf(input)!;
    const arrangementType = String(input.arrangement_type ?? input.arrangementType ?? "MARKUP").toUpperCase();
    const value = Number(input.value ?? 0);
    ctx.logger.info("calling Orbit revenue arrange", { placementId, arrangementType, orgId: ctx.orgId });
    const r = await postOrbit(
      `/internal/orbit/placements/${placementId}/revenue`,
      {
        arrangement_type: arrangementType,
        value,
        notes: input.notes ?? null,
        custom_formula: input.custom_formula ?? input.customFormula ?? null,
        organization_id: input.organization_id ?? ctx.orgId,
      },
      { signal: ctx.signal },
    );
    ctx.emit({
      event_type: "orbit.revenue.arranged",
      payload: { placement_id: placementId, arrangement_type: arrangementType, value, orbit: r },
    });
    return { placementId, arrangementType, value, stubbed: r.stub === true };
  },
});
