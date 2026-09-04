import { createHash } from "node:crypto";
import type { LLMClient } from "./llm/types.js";
import type { EventCatalogEntry } from "./event-catalog.js";
import { buildGraphSystemPrompt } from "./build-graph-prompt.js";
import { getToolCatalog } from "./tool-registry.js";
import { resolveEdgeLabels } from "./graph-visual-registry.js";
import type { PromptNode } from "./describe-node-for-prompt.js";
import { proposeGraphFromLlm } from "./propose-graph-from-llm.js";
import { validateLlmGraphProposal } from "./validate-llm-graph.js";
import { mergeUnsupported, outOfScopeLabels } from "./request-scope.js";
import type { GraphDefinition } from "./graph-definition.js";
import { summarizeGraphWorkflow } from "./summarize-graph.js";
import { compileLlmProposalToGraph } from "./compile-llm-proposal.js";
import { applyDeterministicPolicyConfig } from "./apply-policy-config.js";

export type GenerateGraphFromLlmArgs = {
  llm: LLMClient;
  userRequest: string;
  events: EventCatalogEntry[];
  /** e.g. syntra.authored */
  graphKey: string;
  /**
   * The tools this author may actually use — their application's own, plus
   * anything another application marked shareable. Supply it from
   * `node_registry`, which is the same list the editor's palette reads.
   *
   * Omit it and the whole catalogue is offered, which is the old behaviour and
   * is how a single graph could end up containing two applications' steps: the
   * model cannot be talked out of a tool it can see, but it cannot use one it
   * was never shown.
   */
  allowedToolKeys?: readonly string[];
  /**
   * Nodes as `node_registry` has them — the schemas the runtime enforces.
   *
   * Supply this and the prompt is generated from the contracts rather than
   * from the prose catalogue, which has drifted from them. `allowedToolKeys`
   * is then unnecessary: the list of nodes IS the scope.
   */
  nodes?: readonly PromptNode[];
  temperature?: number;
};

export type GenerateGraphFromLlmResult = {
  definition: GraphDefinition;
  source: string;
  checksum: string;
  graphKey: string;
  /** Raw LLM text kept for audit; not required for storage. */
  rawText: string;
  model: string;
  /** Gap report: what the admin asked that we could not build. */
  unsupported: string[];
  /** Readable built steps (Layer 3). */
  builtSummary: string;
};

/**
 * Propose via LLM (structured output) → compile → normalize → validate.
 * On any failure throws GenerationFailedError — nothing to store.
 */
export async function generateGraphFromLlm(
  args: GenerateGraphFromLlmArgs,
): Promise<GenerateGraphFromLlmResult> {
  /**
   * An unknown key in `allowedToolKeys` is dropped rather than raised. The
   * registry holds nodes the prompt catalogue has never described — several
   * active graphs reference impls in one and not the other — and the model
   * cannot be asked to use a tool nothing can describe to it.
   */
  const tools = args.allowedToolKeys
    ? getToolCatalog().filter((t) => args.allowedToolKeys!.includes(t.key))
    : undefined;

  /**
   * Two things a node contract still cannot say: which event usually leads to
   * this node, and which one it publishes. Both are taken from the prose
   * catalogue where it happens to know them, and NEVER override a schema —
   * they are added beside it. When the contract grows an `emits` field this
   * lookup goes away.
   */
  const nodes = args.nodes?.map((n) => {
    const legacy = getToolCatalog().find((t) => t.key === n.key);
    const paths = resolveEdgeLabels(n.key);
    return {
      ...n,
      triggeredBy: n.triggeredBy ?? legacy?.triggeredBy ?? null,
      emits: n.emits ?? legacy?.output.event ?? null,
      ...(paths ? { paths } : {}),
    };
  });

  const systemPrompt = buildGraphSystemPrompt({
    events: args.events,
    tools,
    ...(nodes ? { nodes } : {}),
  });

  /**
   * ONE LIST, THREE PLACES.
   *
   * The catalogue in the prompt, the allowed-keys rule, and the enum in the
   * response schema must all be the same set. The enum is the one that
   * actually binds — structured output constrains the decoder to it — so when
   * it was wider than the other two it quietly overruled them, and a SYNTRA
   * author's workflow came back containing ASTRA steps.
   */
  const allowedToolKeys =
    nodes?.map((n) => n.key) ?? args.allowedToolKeys ?? undefined;
  const { rawText, proposal, unsupported: fromLlm, model } =
    await proposeGraphFromLlm({
      llm: args.llm,
      systemPrompt,
      userRequest: args.userRequest,
      temperature: args.temperature ?? 0.2,
      ...(allowedToolKeys ? { allowedToolKeys } : {}),
    });

  let compiled = compileLlmProposalToGraph(proposal, {
    graphKey: args.graphKey,
  });
  compiled = applyDeterministicPolicyConfig(compiled, args.userRequest);

  const definition = validateLlmGraphProposal(
    compiled as unknown as Record<string, unknown>,
    { defaultGraphKey: args.graphKey },
  );

  const locked: GraphDefinition = {
    ...definition,
    graphKey: args.graphKey,
  };

  const source = `${JSON.stringify(locked, null, 2)}\n`;
  const checksum = createHash("sha256").update(source).digest("hex");
  const unsupported = mergeUnsupported(
    fromLlm,
    outOfScopeLabels(args.userRequest),
  );
  const builtSummary = summarizeGraphWorkflow(locked).line;

  return {
    definition: locked,
    source,
    checksum,
    graphKey: args.graphKey,
    rawText,
    model,
    unsupported,
    builtSummary,
  };
}
