/**
 * syntra.jd.process — the first node moved to the contract.
 *
 * Converted, not rewritten. The HTTP call, the emitted event and its payload
 * are the same as the engine implementation this replaces. What changed is
 * that the node now DECLARES what it takes, returns, and does — so the editor,
 * CI and run detail can read it instead of guessing.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifySyntraError, postSyntra } from "../syntra-http.js";

/* ─────────────────────────────── shapes ──────────────────────────────── */

/**
 * Built from the trigger event payload.
 *
 * Two names for one thing, because two different producers publish this event:
 * `syntra.jd.received` carries `requirement_id`, while internally-raised ones
 * carry `jobId`. The engine implementation did the same `??` dance inline.
 *
 * This alias is TEMPORARY. It is exactly what the per-binding
 * `input_mapping` exists to remove — once bindings can say
 * `{ jobId: "payload_ref.requirement_id" }`, this becomes a single required
 * `jobId` and the node stops knowing that two producers disagree.
 */
const Input = z
  .object({
    jobId: z.string().min(1).optional(),
    requirement_id: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.jobId ?? v.requirement_id), {
    message: "needs jobId (or requirement_id until the binding maps it)",
  });

/**
 * What the graph gets back. Deliberately NOT the raw SYNTRA response: a node
 * is a shell that maps a response, not a pipe that forwards one. Declaring the
 * blob would mean run detail rendering a third-party shape we do not control.
 */
const Output = z.object({
  jobId: z.string(),
  status: z.string(),
  parserVersion: z.string(),
  stubbed: z.boolean(),
});

/**
 * Design-time knobs, frozen into the graph version.
 *
 * WHAT SYNTRA ACTUALLY HONOURS, which is not what this used to claim.
 *
 * `matchThreshold` and `topN` reach the matching funnel and change what a run
 * produces — the tier-2 skill floor and how many candidates survive it. Both
 * are adminExposed, both declare the default SYNTRA uses when they are unset,
 * and the editor shows that default so a person can decide against a number
 * rather than against a blank box.
 *
 * `rerank` and `hardFilters` are declared and NOT YET IMPLEMENTED anywhere in
 * node-api. They are sent, and dropped. Left here because both are real
 * features somebody will write — `hardFilters` maps onto the tier-1 filter
 * that already exists — but nobody should read this block and believe setting
 * them does something today.
 *
 * `prompt` was removed. See the note on it below.
 */
const Config = z.object({
  /**
   * How many times SYNTRA re-asks the model when the JD comes back unusable.
   *
   * Parsing is a structured extraction: the answer has to be JSON that
   * `validateJdSchema` accepts, and on a bad answer SYNTRA retries with a
   * correction instruction appended. Three attempts is its own default.
   *
   * This is a real trade and the only one this step has: more attempts costs
   * another model call each and rescues a JD that would otherwise fail; fewer
   * fails faster and cheaper on documents that were never going to parse.
   *
   * Distinct from `execution.retry` below, which is the ORCHESTRATOR retrying
   * this whole node after it throws. This one is SYNTRA retrying the model
   * inside a single call, and the two compose.
   */
  maxAttempts: z
    .int()
    .min(1)
    .max(5)
    .default(3)
    .meta({ adminExposed: true, label: "Parsing attempts before giving up" }),
});

/** Only send what was actually set — the engine implementation did the same. */
/**
 * PARSING OPTIONS ONLY, AND THAT IS THE WHOLE CORRECTION.
 *
 * This node sent `matchThreshold`, `topN`, `rerank` and `hardFilters` — four
 * matching knobs on a step that parses a requirement into structure and does
 * no matching at all. They came from the engine's one generic
 * `optionsFromNodeConfig()`, which forwarded the same four for every SYNTRA
 * node regardless of what the node did, and the contracts copied that shape
 * rather than asking what this step needs.
 *
 * They could not have worked even if SYNTRA read them: `handleJdUploaded`
 * returns before the matching funnel whenever `ORCH_DELEGATE_MATCH` is set,
 * which it is — matching belongs to `syntra.continuous.match`, reached by the
 * `syntra.jd.parsed` this node publishes.
 */
function optionsFor(config: z.infer<typeof Config>): Record<string, unknown> {
  return { maxAttempts: config.maxAttempts };
}

/* ────────────────────────────── contract ─────────────────────────────── */

export const jdProcess = defineNode({
  key: "syntra.jd.process",
  version: "1.0.0",
  module: "syntra",
  /** Any module's graph may parse a JD; nothing about it is SYNTRA-private. */
  shareable: true, // parsing a requirement is a service any flow may need

  title: "Process a job description",
  description:
    "Sends a requirement to SYNTRA to be parsed and structured, then announces that the JD is ready for matching.",
  tags: ["syntra", "jd", "intake"],

  input: Input,
  output: Output,
  config: Config,

  /**
   * `internal_write`, not `read`. The call looks like a request but SYNTRA
   * persists the parse against the requirement — running it twice writes
   * twice. Not `external`: SYNTRA is ours, and nothing leaves the building.
   */
  /**
   * What this node may publish.
   *
   * Published once the description has been read and structured, so
   * anything that needs a parsed JD can wait for this rather than guess.
   */
  emits: ["syntra.jd.parsed"],

  sideEffect: "internal_write",

  /**
   * The requirement id IS the natural key — one parse per job, and SYNTRA
   * overwrites rather than appends, so a retry after a timeout re-parses the
   * same job instead of creating a second one.
   *
   * The honest caveat, and it is the argument this node needs: we assert this
   * about a service we do not own. The spec's rule is that a peer node
   * wrapping a multi-stage pipeline MUST be stage-idempotent server-side or be
   * decomposed. If SYNTRA's parse ever appends, this declaration becomes a lie
   * and the answer is to fix SYNTRA, not to relax this line.
   */
  idempotency: {
    strategy: "natural_key",
    // Matches this node's refine: jobId or requirement_id. syntra.jd.received
    // carries requirement_id only.
    keyPaths: [["jobId", "requirement_id"]],
  },

  execution: {
    /** JD parsing is LLM-backed inside SYNTRA and genuinely slow. */
    timeoutMs: 60_000,
    /** Safe to retry because the write is keyed on the job. */
    retry: { limit: 3, backoff: "exponential", baseMs: 1_000 },
    classifyError: classifySyntraError,
    locks: [],
  },

  /**
   * `http` only. SYNTRA calls an LLM internally, but this node does not — the
   * budget and the stub belong to whoever holds the SDK, and that is SYNTRA.
   * Declaring `llm` here would demand a stub for a call we never make.
   */
  dependencies: ["http"],

  /**
   * A requirement id and a status. No candidate data, no resume text, nothing
   * a person could be identified from — so run detail may show all of it, and
   * showing it is what makes a failed run diagnosable.
   *
   * Contrast syntra.resume.process, where the payload carries a CV and
   * this block must redact.
   */
  persistence: {
    storeInput: "full",
    storeOutput: "full",
    redactPaths: [],
  },

  /**
   * CAPTURED from a live SYNTRA on 2026-08-24. This is no longer a guess.
   *
   * `POST /internal/jobs/<id>/process` answered, in 8.6s:
   *
   *     HTTP 200  { "status": "processed", "jobId": "<id>" }
   *
   * The guessed `status: "processed"` was right, and `parserVersion: "syntra"`
   * is correct because the node derives it from `r.stub !== true` rather than
   * from anything SYNTRA sends.
   *
   * What the call did, confirmed on the row afterwards: parsed the JD with an
   * LLM (`primary_role`, `jd_summary`, 5 skills), generated a
   * `text-embedding-3-small` v1 embedding, set `processing_status=processed`,
   * and wrote one `syntra.jd.parsed` event to the outbox. The matching funnel
   * did NOT run — `ORCH_DELEGATE_MATCH=1` with `PLATFORM_EVENTS_ENABLED=1`
   * defers it to the orchestrator.
   *
   * Captured against a throwaway job created for the purpose and deleted
   * afterwards, because this endpoint OVERWRITES the parse of whatever job it
   * is given (`saveAiResultAndEmbedding`). Never point it at a real
   * requirement to "just check something".
   *
   * Fixture 2 (`requirement_id` from the astra producer) is NOT captured — it
   * exercises this node's input aliasing, not a different SYNTRA response, so
   * the same response applies.
   */
  fixtures: [
    {
      name: "parses a requirement",
      input: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11" },
      config: { maxAttempts: 3 },
      expectedOutput: {
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        status: "processed",
        parserVersion: "syntra",
        stubbed: false,
      },
    },
    {
      name: "accepts requirement_id from the astra producer",
      input: { requirement_id: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11" },
      config: { maxAttempts: 3 },
      expectedOutput: {
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        status: "processed",
        parserVersion: "syntra",
        stubbed: false,
      },
    },
  ],

  /** No `llm` or `external-api` dependency, so no stub is required. */

  run: async (ctx: NodeRunCtx, input, config) => {
    const jobId = input.jobId ?? input.requirement_id!;

    ctx.logger.info("calling Syntra JD process", { jobId, orgId: ctx.orgId });
    const r = await postSyntra(`/internal/jobs/${jobId}/process`, optionsFor(config), {
      signal: ctx.signal,
    });

    const stubbed = r.stub === true;
    const parserVersion = stubbed ? "orch.stub.v1" : "syntra";

    // Same event, same payload as the engine implementation. The envelope —
    // ids, correlation, aggregate — is built by the runtime, not here.
    ctx.emit({
      event_type: "syntra.jd.parsed",
      payload: {
        jobId,
        requirement_id: jobId,
        status: r.status,
        syntra: r,
        parser_version: parserVersion,
      },
    });

    return {
      jobId,
      status: String(r.status ?? "ok"),
      parserVersion,
      stubbed,
    };
  },
});