/**
 * orbit.activity.note
 *
 * A line on a person's timeline — what happened, said by whom. Every module appends to the same feed (core.activities, decision D2); this is ORBIT's node for doing it from a workflow.
 *
 * Ported from the engine function `orbitActivityNote` in packages/orchestrator/src/nodes/orbit.ts
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
    summary: z.string().optional(),
    note: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Boolean(candidateIdOf(v)), { message: "needs candidate_id" })
  .refine((v) => Boolean((v.summary ?? v.note ?? "").trim()), { message: "needs a summary or note" });

const Output = z.object({
  candidateId: z.string(),
  summary: z.string(),
  activityType: z.string(),
  stubbed: z.boolean(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const activityNote = defineNode({
  key: "orbit.activity.note",
  version: "1.0.0",
  module: "orbit",
  shareable: true, // the activity feed is everyone's (migration decision D2)

  title: "Note something on a person's timeline",
  description:
    "Writes an activity line — a note, a call, a status — on a person's timeline and announces it.",
  tags: ["orbit", "activity", "timeline"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["orbit.activity.noted"],
  sideEffect: "internal_write",
  idempotency: { strategy: "natural_key", keyPaths: [["candidate_id", "candidateId"], ["summary", "note"]] },

  execution: {
    /** One ORBIT call. UNVERIFIED — not yet timed here. */
    timeoutMs: 15_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: classifyOrbitError,
    locks: [],
  },

  dependencies: ["http"],

  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
        {
          name: "a recruiter's note",
          input: { candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f", summary: "Spoke on the phone; available from October." },
          config: {},
          expectedOutput: { candidateId: "21d2cb25-09be-456f-a4b4-9872e485445f", summary: "Spoke on the phone; available from October.", activityType: "NOTE", stubbed: false },
        },
      ],


  run: async (ctx: NodeRunCtx, input) => {
    const candidateId = candidateIdOf(input)!;
    const summary = String(input.summary ?? input.note).trim();
    ctx.logger.info("calling Orbit activity note", { candidateId, orgId: ctx.orgId });
    const r = await postOrbit(
      `/internal/orbit/candidates/${candidateId}/activities`,
      { summary, payload: input.payload ?? {} },
      { signal: ctx.signal },
    );
    ctx.emit({
      event_type: "orbit.activity.noted",
      payload: { candidate_id: candidateId, summary, orbit: r },
    });
    return {
      candidateId,
      summary,
      activityType: String(r.activity?.activity_type ?? "NOTE"),
      stubbed: r.stub === true,
    };
  },
});
