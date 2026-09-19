import {
  GraphDefinitionSchema,
  validateGraphTopology,
  type GraphDefinition,
} from "./graph-definition.js";
import { isRegisteredTool } from "./tool-registry.js";
import { GenerationFailedError } from "./parse-llm-graph.js";
import { closeOpenEnds } from "./close-open-ends.js";

/** Allowed hard-filter names on syntra.match.process config. */
export const HARD_FILTER_KEYS = [
  "location",
  "visa",
  "availability",
  "experience",
] as const;

/**
 * Router keys the runtime supports in conditionalEdges.
 * Must stay in sync with packages/orchestrator/src/graphs/routers.ts.
 */
/**
 * Written out rather than derived from `@tekisho/graph-contract`, on purpose:
 * `RouterKey` below is a union used for narrowing, and deriving the list would
 * widen it to `string` and lose that. `MODULES` in the node contract is written
 * out for the same reason.
 *
 * The cast is the one place this could drift from the contract, so a test
 * asserts they match — add a router to the contract without adding it here and
 * `validate-llm-graph.test.ts` fails.
 */
export const ALLOWED_ROUTER_KEYS = [
  "branch_key",
  "switch",
  "result.approved_or_end",
  "result.continue_or_gate",
  "result.has_duplicate_or_end",
] as const;

export type RouterKey = (typeof ALLOWED_ROUTER_KEYS)[number];

function isAllowedRouterKey(v: unknown): v is RouterKey {
  return (
    typeof v === "string" &&
    (ALLOWED_ROUTER_KEYS as readonly string[]).includes(v)
  );
}

export type HardFilterKey = (typeof HARD_FILTER_KEYS)[number];

export type ValidateLlmGraphOptions = {
  /**
   * If the proposal omits graphKey (or it's empty), use this.
   * Typical: `${agentKey}.authored`.
   */
  defaultGraphKey?: string;
};

function isHardFilterKey(v: unknown): v is HardFilterKey {
  return (
    typeof v === "string" &&
    (HARD_FILTER_KEYS as readonly string[]).includes(v)
  );
}

/**
 * Validate node.config shapes the runtime/policy model understands.
 * Catches LLM inventions like hardFilters: { visaRequired: false }.
 */
export function validateGraphNodeConfigs(def: GraphDefinition): void {
  for (const node of def.nodes) {
    const cfg = node.config;
    if (!cfg || typeof cfg !== "object") continue;

    if (cfg.hardFilters !== undefined) {
      if (!Array.isArray(cfg.hardFilters)) {
        throw new GenerationFailedError(
          `node "${node.id}" config.hardFilters must be an array of strings ` +
            `(e.g. ["visa"]), not ${typeof cfg.hardFilters}`,
        );
      }
      for (const f of cfg.hardFilters) {
        if (!isHardFilterKey(f)) {
          throw new GenerationFailedError(
            `node "${node.id}" config.hardFilters has invalid value "${String(f)}"; ` +
              `allowed: ${HARD_FILTER_KEYS.join(", ")}`,
          );
        }
      }
    }

    if (cfg.matchThreshold !== undefined) {
      if (
        typeof cfg.matchThreshold !== "number" ||
        Number.isNaN(cfg.matchThreshold) ||
        cfg.matchThreshold < 0 ||
        cfg.matchThreshold > 100
      ) {
        throw new GenerationFailedError(
          `node "${node.id}" config.matchThreshold must be a number from 0–100`,
        );
      }
    }

    if (cfg.rerank !== undefined && typeof cfg.rerank !== "boolean") {
      throw new GenerationFailedError(
        `node "${node.id}" config.rerank must be a boolean`,
      );
    }
  }
}

/**
 * LLMs often emit conditionalEdges as a single object instead of an array.
 * Coerce { from, router, map } → [{ from, router, map }] before schema parse.
 */
export function coerceConditionalEdges(
  proposal: Record<string, unknown>,
): Record<string, unknown> {
  const ce = proposal.conditionalEdges;
  if (ce === undefined || ce === null) return proposal;
  if (Array.isArray(ce)) return proposal;
  if (typeof ce === "object") {
    const obj = ce as Record<string, unknown>;
    // Single branch descriptor
    if (
      typeof obj.from === "string" &&
      typeof obj.map === "object" &&
      obj.map !== null &&
      !Array.isArray(obj.map)
    ) {
      return { ...proposal, conditionalEdges: [obj] };
    }
    // Map of from → { router, map } or from → map
    const entries = Object.entries(obj);
    if (entries.length > 0) {
      const asArray = entries.map(([from, val]) => {
        if (val && typeof val === "object" && !Array.isArray(val)) {
          const v = val as Record<string, unknown>;
          if (v.map && typeof v.map === "object") {
            return {
              from,
              router: typeof v.router === "string" ? v.router : "branch_key",
              map: v.map,
            };
          }
          return { from, router: "branch_key", map: v };
        }
        return { from, router: "branch_key", map: {} };
      });
      return { ...proposal, conditionalEdges: asArray };
    }
  }
  return proposal;
}

/**
 * Full authored-graph gate used at Generate **and** before Compile / go-live:
 *
 *  a. every node.impl ∈ real TOOL_REGISTRY
 *  b. GraphDefinitionSchema.parse
 *  c. validateGraphTopology
 *  d. known config shapes (hardFilters / matchThreshold / rerank)
 *
 * Failures throw {@link GenerationFailedError} — callers must not store / must not compile.
 */
export function validateLlmGraphProposal(
  proposal: Record<string, unknown>,
  opts: ValidateLlmGraphOptions = {},
): GraphDefinition {
  const withKeyRaw =
    typeof proposal.graphKey === "string" && proposal.graphKey.trim()
      ? proposal
      : opts.defaultGraphKey
        ? { ...proposal, graphKey: opts.defaultGraphKey }
        : proposal;

  const withKey = coerceConditionalEdges(withKeyRaw);

  const rawNodes = withKey.nodes;
  if (!Array.isArray(rawNodes)) {
    throw new GenerationFailedError("proposal.nodes must be an array");
  }

  // LangGraph terminals belong only on edges, not in nodes. Gemini often
  // emits { id: "__start__", impl: "__start__" } which is not a tool.
  const nodes = rawNodes.filter((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return true;
    const id = String((node as { id?: unknown }).id ?? "");
    const impl = String((node as { impl?: unknown }).impl ?? "");
    return (
      id !== "__start__" &&
      id !== "__end__" &&
      impl !== "__start__" &&
      impl !== "__end__"
    );
  });
  /**
   * The model chose the steps; it does not always say where the flow ends.
   *
   * Measured on gpt-4o-mini against the real registry, two requests in three
   * were refused for "nothing reaches __end__" and nothing else — right steps,
   * right order, every impl registered. The author then saw one arbitrary
   * placeholder step instead of the workflow that had just been built.
   *
   * Repaired in the same spirit as the filter above, which drops the
   * __start__/__end__ NODES Gemini invents: a mechanical omission gets a
   * mechanical fix. Nothing is invented — see close-open-ends.ts for exactly
   * what it will and will not touch.
   */
  const sanitized = closeOpenEnds({ ...withKey, nodes });

  const unknownImpls: string[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new GenerationFailedError("each node must be an object");
    }
    const impl = (node as { impl?: unknown }).impl;
    if (typeof impl !== "string" || !impl.trim()) {
      throw new GenerationFailedError("each node must have a non-empty impl");
    }
    if (!isRegisteredTool(impl)) {
      unknownImpls.push(impl);
    }
  }
  if (unknownImpls.length > 0) {
    const unique = [...new Set(unknownImpls)];
    throw new GenerationFailedError(
      `unknown tool impl(s) not in registry: ${unique.join(", ")}`,
    );
  }

  const parsed = GraphDefinitionSchema.safeParse(sanitized);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new GenerationFailedError(
      `graph failed schema validation: ${detail}`,
    );
  }

  try {
    validateGraphTopology(parsed.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GenerationFailedError(`graph failed topology validation: ${msg}`, {
      cause: err,
    });
  }

  // Validate conditionalEdges router keys and map targets.
  if (parsed.data.conditionalEdges?.length) {
    const nodeIds = new Set(parsed.data.nodes.map((n) => n.id));
    for (const ce of parsed.data.conditionalEdges) {
      if (!isAllowedRouterKey(ce.router)) {
        throw new GenerationFailedError(
          `conditionalEdges router "${ce.router}" is not in the allowed list: ` +
            ALLOWED_ROUTER_KEYS.join(", "),
        );
      }
      if (ce.from !== "__start__" && !nodeIds.has(ce.from)) {
        throw new GenerationFailedError(
          `conditionalEdges "from" node "${ce.from}" not found in nodes`,
        );
      }
      for (const [label, target] of Object.entries(ce.map)) {
        if (target !== "__end__" && target !== "__start__" && !nodeIds.has(target)) {
          throw new GenerationFailedError(
            `conditionalEdges map["${label}"] target "${target}" not found in nodes`,
          );
        }
      }
    }
  }

  try {
    validateGraphNodeConfigs(parsed.data);
  } catch (err) {
    if (err instanceof GenerationFailedError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new GenerationFailedError(`graph failed config validation: ${msg}`, {
      cause: err,
    });
  }

  return parsed.data;
}

/**
 * Re-run the full gate on a stored artifact before Compile / go-live.
 * Accepts already-parsed objects or JSON strings.
 */
export function validateAuthoredGraphForGoLive(
  artifact: unknown,
  opts: ValidateLlmGraphOptions = {},
): GraphDefinition {
  let proposal: Record<string, unknown>;
  if (typeof artifact === "string") {
    try {
      const parsed = JSON.parse(artifact) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new GenerationFailedError(
          "stored artifact is not a JSON graph object",
        );
      }
      proposal = parsed as Record<string, unknown>;
    } catch (err) {
      if (err instanceof GenerationFailedError) throw err;
      throw new GenerationFailedError("stored artifact is not valid JSON", {
        cause: err,
      });
    }
  } else if (artifact && typeof artifact === "object" && !Array.isArray(artifact)) {
    proposal = artifact as Record<string, unknown>;
  } else {
    throw new GenerationFailedError("stored artifact is missing or invalid");
  }

  return validateLlmGraphProposal(proposal, opts);
}
