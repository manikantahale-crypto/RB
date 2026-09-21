/**
 * astra.jobboard.fetch
 *
 * Pull listings from a job board and turn each into a requirement. One node, many announcements — one astra.requirement.received per listing ASTRA created.
 *
 * Ported from the engine function `astraJobboardFetch` in packages/orchestrator/src/nodes/astra.ts
 * on 2026-09-20 — same request, same response fields read, same event
 * published. That function stays in the engine registry; this contract
 * overrides it by key when the worker composes the registry, the way the
 * nine SYNTRA nodes did. *
 * DOES NOT ANNOUNCE THE REQUIREMENT. ASTRA's service writes
 * `astra.requirement.received` to the outbox inside the transaction that
 * creates each row (astra.service.js `writeRequirementReceived`), with the
 * flow's correlation id this node hands it. The engine function emitted a
 * second copy — two announcements, two runs of whatever is bound to it
 * (onboarding path 4.4). Fixed 2026-09-20: the service owns the emit.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyAstraError, postAstra } from "../astra-http.js";
import { jobIdOf, rawTextOf } from "../fields.js";

const Input = z.object({
  source: z.string().optional(),
  keyword: z.string().optional(),
  query: z.string().optional(),
  title: z.string().optional(),
  location: z.string().optional(),
  listings: z.array(z.record(z.string(), z.unknown())).optional(),
  raw_text: z.string().optional(),
  rawText: z.string().optional(),
  body: z.string().optional(),
  content: z.string().optional(),
  jobId: z.string().optional(),
  requirement_id: z.string().optional(),
  requirementId: z.string().optional(),
});

const Output = z.object({
  /** Requirements CREATED (duplicates are not counted, nor announced again). */
  count: z.number().int().min(0),
  /** The first requirement with a row, new or duplicate — what the run continues with. */
  firstJobId: z.string(),
  source: z.string(),
  stubbed: z.boolean(),
});

const Config = z.object({
  /** Which board, when the event does not say. */
  source: z.string().optional().meta({ adminExposed: true, label: "Job board" }),
  agentName: z.string().optional(),
});

export const jobboardFetch = defineNode({
  key: "astra.jobboard.fetch",
  version: "1.0.0",
  module: "astra",
  shareable: false,

  title: "Fetch requirements from a job board",
  description:
    "Asks ASTRA to fetch listings for a keyword and location from a job board, creating a requirement for each, and announces every one.",
  tags: ["astra", "intake", "job-board"],

  input: Input,
  output: Output,
  config: Config,

  emits: [],
  sideEffect: "external",
  idempotency: { strategy: "natural_key", keyPaths: [["source", "jobId"], ["keyword", "query", "title", "location"]] },

  execution: {
    /** One ASTRA call that may call several boards. UNVERIFIED — not yet timed here. */
    timeoutMs: 120_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: (e) =>
      /no jobs created/.test(String((e as Error)?.message ?? e)) ? "permanent_input" : classifyAstraError(e),
    locks: [],
  },

  dependencies: ["http"],

  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
        {
          name: "a keyword on one board yields requirements",
          input: { source: "jsearch", keyword: "SAP ABAP", location: "Dallas, TX" },
          config: {},
          expectedOutput: { count: 3, firstJobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", source: "jsearch", stubbed: false },
        },
      ],


  run: async (ctx: NodeRunCtx, input, config) => {
    const body = {
      source: input.source ?? config.source ?? "manual",
      keyword: input.keyword ?? input.query ?? input.title ?? "software engineer",
      location: input.location ?? "",
      listings: input.listings,
      raw_text: rawTextOf(input),
      correlation_id: ctx.correlationId ?? undefined,
    };
    ctx.logger.info("calling Astra jobboard fetch", { source: body.source, orgId: ctx.orgId });
    const r = await postAstra("/internal/astra/jobboards/fetch", body, { signal: ctx.signal });

    // WHAT THE ENDPOINT ACTUALLY ANSWERS (node-api jobBoards.controller →
    // jobBoard.adapter.fetchAndIngest): `{ status, data: { created,
    // duplicates, items: [{ id, status: "New" | "Duplicate" | "Failed" }] } }`.
    // The engine function read `r.results[].jobId`, a field that does not
    // exist, so against the real backend it always threw "no jobs
    // created" — only the stub ever let it pass. Found while porting.
    //
    // The stub answers with no listings; one is invented, as the engine
    // did, so a local flow can continue.
    const items: Array<Record<string, unknown>> = Array.isArray(r.data?.items)
      ? r.data.items
      : r.stub
        ? [{ id: jobIdOf(input) ?? crypto.randomUUID(), status: "New" }]
        : [];

    let firstJobId: string | undefined;
    let created = 0;
    for (const item of items) {
      const id = item?.id;
      if (!id) continue; // a listing that failed to ingest has no row
      if (!firstJobId) firstJobId = String(id);
      // A duplicate is a requirement that already exists and was announced
      // by the service when it first arrived.
      if (item.status === "New") created += 1;
    }
    if (!firstJobId) throw new Error("astra.jobboard.fetch: no jobs created");

    return { count: created, firstJobId, source: body.source, stubbed: r.stub === true };
  },
});
