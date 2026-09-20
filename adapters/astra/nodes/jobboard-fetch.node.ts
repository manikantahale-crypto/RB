/**
 * astra.jobboard.fetch — a DECLARATION, not an implementation.
 *
 * The engine runs this node: packages/orchestrator/src/nodes/astra.ts
 * (astraJobboardFetch). This file is what `node_registry` and the editor project
 * — input, output, settings, what it publishes — written from that code on
 * 2026-09-20, line by line. Like `orch.branch.decision`, it stays out of
 * `nodeContracts` until the implementation moves in here at stage 5; until
 * then a change to the engine file is a change to this one.
 *
 * Pull listings from a job board and turn each into a requirement. One node, many announcements — one astra.requirement.received per listing SYNTRA created.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";


/** astra.ts:236-247 */
const Input = z.object({
  source: z.string().optional(),
  keyword: z.string().optional(),
  query: z.string().optional(),
  title: z.string().optional(),
  location: z.string().optional(),
  listings: z.array(z.record(z.string(), z.unknown())).optional(),
  raw_text: z.string().optional(),
});

const Output = z.object({
  /** Requirements created, in SYNTRA's order; the first is what the run continues with. */
  count: z.number().int().min(0),
  firstJobId: z.string(),
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
    "Asks SYNTRA's ASTRA to fetch listings for a keyword and location from a job board, creating a requirement for each, and announces every one.",
  tags: ["astra", "intake", "job-board"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["astra.requirement.received"],
  sideEffect: "external",
  idempotency: { strategy: "natural_key", keyPaths: ["source", ["keyword", "query", "title"]] },

  execution: {
    /** One SYNTRA call that may call several boards. UNVERIFIED — not yet timed here. */
    timeoutMs: 120_000,
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
          name: "a keyword on one board yields requirements",
          input: { source: "jsearch", keyword: "SAP ABAP", location: "Dallas, TX" },
          config: {},
          expectedOutput: { count: 3, firstJobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11" },
        },
      ],

  /**
   * Never called. The engine's own function runs this node; this
   * declaration must not be in `nodeContracts`, and throwing is how that
   * stays true.
   */
  run: async (ctx: NodeRunCtx) => {
    ctx.logger.error(
      "astra.jobboard.fetch: declaration only — the live implementation is packages/orchestrator/src/nodes/astra.ts",
    );
    throw new Error("astra.jobboard.fetch is a declaration, not an implementation. It must not be in nodeContracts.");
  },
});
