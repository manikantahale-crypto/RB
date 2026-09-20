/**
 * orbit.placement.confirm
 *
 * A person has been placed with a client: the placement row, with its rates and terms, is the record the revenue side builds on.
 *
 * Ported from the engine function `orbitPlacementConfirm` in packages/orchestrator/src/nodes/orbit.ts
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
    client_name: z.string().optional(),
    clientName: z.string().optional(),
    requirement_id: z.string().nullable().optional(),
    requirementId: z.string().nullable().optional(),
    start_date: z.string().optional(),
    startDate: z.string().optional(),
    end_date: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    confirmed_bill_rate: z.number().optional(),
    confirmedBillRate: z.number().optional(),
    confirmed_pay_rate: z.number().optional(),
    confirmedPayRate: z.number().optional(),
    employment_model: z.string().optional(),
    employmentModel: z.string().optional(),
    work_mode: z.string().optional(),
    workMode: z.string().optional(),
    location: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    organization_id: z.string().optional(),
  })
  .refine((v) => Boolean(candidateIdOf(v)), { message: "needs candidate_id" })
  .refine((v) => Boolean((v.client_name ?? v.clientName ?? "").trim()), { message: "needs client_name" });

const Output = z.object({
  placementId: z.string(),
  candidateId: z.string(),
  clientName: z.string(),
  branch_key: z.literal("placed"),
  stubbed: z.boolean(),
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
    classifyError: classifyOrbitError,
    locks: [],
  },

  dependencies: ["http"],

  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
        {
          name: "a placement with its rates",
          input: { candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f", client_name: "Acme Corp", start_date: "2026-10-01", confirmed_bill_rate: 95, confirmed_pay_rate: 70, employment_model: "C2C", work_mode: "REMOTE" },
          config: {},
          expectedOutput: { placementId: "5d9e0b6a-0d1c-4f4e-9a3b-2c6d7e8f9a01", candidateId: "21d2cb25-09be-456f-a4b4-9872e485445f", clientName: "Acme Corp", branch_key: "placed", stubbed: false },
        },
      ],


run: async (ctx: NodeRunCtx, input) => {
  const candidateId = candidateIdOf(input)!;
  const clientName = String(input.client_name ?? input.clientName);
  const body = {
    candidate_id: candidateId,
    requirement_id: input.requirement_id ?? input.requirementId ?? null,
    client_name: clientName,
    start_date: input.start_date ?? input.startDate,
    end_date: input.end_date ?? input.endDate ?? null,
    confirmed_bill_rate: input.confirmed_bill_rate ?? input.confirmedBillRate,
    confirmed_pay_rate: input.confirmed_pay_rate ?? input.confirmedPayRate,
    employment_model: input.employment_model ?? input.employmentModel ?? "C2C",
    work_mode: input.work_mode ?? input.workMode ?? "ONSITE",
    location: input.location ?? null,
    notes: input.notes ?? null,
    organization_id: input.organization_id ?? ctx.orgId,
  };
  ctx.logger.info("calling Orbit placement confirm", { candidateId, clientName, orgId: ctx.orgId });
  const r = await postOrbit("/internal/orbit/placements", body, { signal: ctx.signal });

  // The stub creates no row; the engine function minted an id so a local
  // flow could continue.
  const placementId = String(r.placement?.id ?? (r.stub ? crypto.randomUUID() : ""));
  if (!placementId) throw new Error("orbit.placement.confirm: Orbit returned no placement id");

  ctx.emit({
    event_type: "orbit.placement.confirmed",
    payload: { candidate_id: candidateId, placement_id: placementId, client_name: clientName, orbit: r },
  });
  return { placementId, candidateId, clientName, branch_key: "placed" as const, stubbed: r.stub === true };
},
});
