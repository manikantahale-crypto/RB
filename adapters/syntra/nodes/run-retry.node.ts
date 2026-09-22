/**
 * syntra.run.retry
 *
 * The question this node had to answer: "A node that retries runs, inside a run. Check this cannot loop."
 *
 * ── ADDED, NOT CONVERTED ────────────────────────────────────────────────
 * `maxRetryDepth` and `retryableErrorCodes`, and the two checks in `run` that
 * read them, are NEW BEHAVIOUR. The engine implementation this node replaces
 * had no loop guard at all — it called the endpoint and returned.
 *
 * This is called out because a conversion is supposed to add nothing, and this
 * one did. It is stated here rather than left for a reviewer to discover: the
 * rest of this file is a faithful conversion, and these two config fields are
 * the exception.
 *
 * Why it was kept rather than removed for parity: checking "can this loop?"
 * showed that it can (below), and the only other thing stopping it is an
 * assertion about a service another team owns which nobody has confirmed. A
 * brake we own is worth having on a loop that costs money every turn.
 *
 * Nothing routes to this node today — no active binding names a graph that
 * contains it — so the guard has never fired in production, and this comment
 * is the record of where it came from if it ever needs to be re-argued.
 * ────────────────────────────────────────────────────────────────────────
 *
 * THE LOOP, WRITTEN OUT, because "check this cannot loop" deserves an answer
 * rather than a reassurance:
 *
 *   a run fails
 *     → the runner emits syntra.agent_run.failed
 *       → routing sends that fact to a graph containing THIS node
 *         → this node asks SYNTRA to retry the failed run
 *           → the retried run fails again
 *             → the runner emits syntra.agent_run.failed
 *               → routing sends it back here … forever
 *
 * Nothing in the retry mechanism stops that. pg-boss retry limits do not
 * apply: each turn of this loop is a NEW run reacting to a NEW event, so every
 * counter starts again at zero. Left alone it would spin until someone noticed
 * the queue depth.
 *
 * Three things below close it, and all three are needed:
 *
 *   1. `idempotency: natural_key` on the failed run id — one retry per failed
 *      run, ever. The second time the same run id arrives, SYNTRA must answer
 *      "already retried" instead of retrying. This is the real stop.
 *   2. `retry.limit: 0` — never retry the retrier. A node whose job is
 *      retrying must not multiply attempts on its own account.
 *   3. `maxRetryDepth` in config, checked BEFORE the call — a cheap local
 *      brake that works even if SYNTRA's deduplication is wrong or absent,
 *      which is exactly the situation rule 1 cannot protect against.
 *
 * Rule 1 depends on another team's behaviour. Rule 3 does not. For a loop that
 * costs money every turn, one guarantee we own is worth having.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifySyntraError, postSyntra } from "../syntra-http.js";

const Input = z
  .object({
    agent_run_id: z.string().min(1).optional(),
    agentRunId: z.string().min(1).optional(),
    error_code: z.string().optional(),
    failed_node: z.string().nullable().optional(),
    /** How many times this lineage has already been retried, if the producer says. */
    attempts: z.number().int().min(0).optional(),
  })
  .refine((v) => Boolean(v.agent_run_id ?? v.agentRunId), {
    message: "needs agent_run_id — there is nothing to retry without one",
  });

const Output = z.object({
  agentRunId: z.string(),
  retried: z.boolean(),
  /** Set when the retry was refused, so run detail says WHY nothing happened. */
  skippedReason: z.string().nullable(),
  status: z.string(),
  stubbed: z.boolean(),
});

/** Both fields are the added behaviour the header describes — neither existed before. */
const Config = z.object({
  /**
   * Not adminExposed. This is a safety limit on an automatic loop, not a
   * preference — raising it is a decision that rides review.
   */
  maxRetryDepth: z.number().int().min(0).max(5).default(1),
  /**
   * Error codes worth retrying at all. Empty means "any". A permanent input
   * failure will fail identically every time, so retrying it is pure cost.
   */
  retryableErrorCodes: z.array(z.string()).default([]),
});

export const runRetry = defineNode({
  key: "syntra.run.retry",
  version: "1.0.0",
  module: "syntra",
  /**
   * THE PLATFORM'S BUSINESS, NOT A MODULE'S.
   * Re-running a failed run belongs to whoever operates the orchestrator. A
   * module's workflow retrying another module's run is an operations action
   * wearing a business step's clothes. (It lives under `syntra.` for
   * historical reasons; the key is the only thing tying it there.)
   */
  shareable: false,

  title: "Retry a failed run",
  description:
    "When a workflow run has failed for a recoverable reason, asks SYNTRA to run it again — at most once.",
  tags: ["syntra", "recovery", "operations"],

  input: Input,
  output: Output,
  config: Config,

  /** Starting work again is a write, and it consumes real resources. */
  /**
   * What this node may publish.
   *
   * Re-queues work through the runner rather than by publishing.
   */
  emits: [],

  sideEffect: "internal_write",

  /**
   * One retry per failed run, for all time. Not "per request" — per RUN. This
   * is the property that turns an unbounded loop into at most one extra
   * attempt, and it is the whole safety argument for this node.
   */
  idempotency: { strategy: "natural_key", keyPaths: ["agent_run_id"] },

  execution: {
    timeoutMs: 30_000,
    /** Never retry the retrier. See the header. */
    retry: { limit: 0, backoff: "none", baseMs: 1 },
    classifyError: classifySyntraError,
    /** One retry decision per failed run at a time. */
    locks: ["syntra.run-retry"],
  },

  dependencies: ["http"],

  /**
   * Kept in full. When someone asks why a run was retried — or why it was
   * not — this record is the answer, and `skippedReason` is the part they
   * actually need.
   */
  persistence: {
    storeInput: "full",
    storeOutput: "full",
    redactPaths: [],
  },

  /**
   * Three fixtures because there are three outcomes, and the two refusals are
   * the ones worth protecting: a suite that only pins the happy path would
   * stay green while the loop guard rotted away.
   *
   * HONEST STATUS: hand-written, not captured. Re-capture before the fixture runner lands.
   */
  fixtures: [
    {
      name: "retries a run that failed once",
      input: {
        agent_run_id: "f1a2b3c4-0000-4000-8000-000000000606",
        error_code: "SYNTRA_TIMEOUT",
        failed_node: "process",
        attempts: 1,
      },
      config: { maxRetryDepth: 1, retryableErrorCodes: [] },
      expectedOutput: {
        agentRunId: "f1a2b3c4-0000-4000-8000-000000000606",
        retried: true,
        skippedReason: null,
        status: "retried",
        stubbed: false,
      },
    },
    {
      name: "refuses once the retry depth is reached — the loop guard",
      input: {
        agent_run_id: "f1a2b3c4-0000-4000-8000-000000000607",
        error_code: "SYNTRA_TIMEOUT",
        attempts: 2,
      },
      config: { maxRetryDepth: 1, retryableErrorCodes: [] },
      expectedOutput: {
        agentRunId: "f1a2b3c4-0000-4000-8000-000000000607",
        retried: false,
        skippedReason: "retry depth 2 reached the limit of 1",
        status: "skipped",
        stubbed: false,
      },
    },
    {
      name: "refuses an error that will fail the same way every time",
      input: {
        agent_run_id: "f1a2b3c4-0000-4000-8000-000000000608",
        error_code: "PERMANENT_INPUT",
        attempts: 1,
      },
      config: { maxRetryDepth: 1, retryableErrorCodes: ["SYNTRA_TIMEOUT"] },
      expectedOutput: {
        agentRunId: "f1a2b3c4-0000-4000-8000-000000000608",
        retried: false,
        skippedReason: 'error code "PERMANENT_INPUT" is not in the retryable list',
        status: "skipped",
        stubbed: false,
      },
    },
  ],

  run: async (ctx: NodeRunCtx, input, config) => {
    const agentRunId = input.agent_run_id ?? input.agentRunId!;
    const attempts = input.attempts ?? 0;

    const skip = (skippedReason: string) => {
      ctx.logger.info("run retry refused", { agentRunId, skippedReason });
      return { agentRunId, retried: false, skippedReason, status: "skipped", stubbed: false };
    };

    // Both checks happen BEFORE the call. A retry that should not happen must
    // not be attempted — refusing afterwards would already have cost the work.
    if (attempts > config.maxRetryDepth) {
      return skip(`retry depth ${attempts} reached the limit of ${config.maxRetryDepth}`);
    }

    const allowed = config.retryableErrorCodes;
    if (allowed.length > 0 && input.error_code && !allowed.includes(input.error_code)) {
      return skip(`error code "${input.error_code}" is not in the retryable list`);
    }

    ctx.logger.info("calling Syntra run retry", { agentRunId, orgId: ctx.orgId });
    const r = await postSyntra(`/internal/agent-runs/${agentRunId}/retry`, {
      agent_run_id: agentRunId,
      error_code: input.error_code,
      failed_node: input.failed_node,
    }, { signal: ctx.signal });

    return {
      agentRunId,
      retried: true,
      skippedReason: null,
      status: String(r.status ?? "ok"),
      stubbed: r.stub === true,
    };
  },
});
