import type { EventCatalogEntry } from "./event-catalog.js";
import type { GraphDefinition } from "./graph-definition.js";
import { buildGraphSystemPrompt } from "./build-graph-prompt.js";
import { getToolCatalog } from "./tool-registry.js";

export type GenerationMeta = {
  mode: "llm" | "template";
  model?: string | null;
  /** Plain-English request from the admin UI (LLM path). */
  userRequest?: string | null;
  /** System prompt sent to the LLM (LLM path) or template catalog snapshot. */
  systemPrompt?: string | null;
  /** Raw LLM response text (LLM path only). */
  rawText?: string | null;
  /** Code path for demos / audits. */
  pipeline?: string | null;
  /** Policy system prompt at generation time. */
  policyPrompt?: string | null;
  allowedTools: string[];
  triggerEventType?: string | null;
  toolsUsed: string[];
  graphKey?: string | null;
  builtSummary?: string | null;
  unsupported?: string[];
  gapAcknowledged?: boolean;
  acknowledgedAt?: string;
  /** Trigger event schema snapshot used for generation context. */
  triggerEventSchema?: {
    eventType: string;
    schemaVersion: string;
    description: string;
    payloadSchema: unknown;
    envelopeFields: unknown;
  } | null;
  generatedAt: string;
};

export type GenerationTrace = {
  mode: "llm" | "template";
  pipeline: string;
  userRequest?: string | null;
  systemPrompt?: string | null;
  rawText?: string | null;
  model?: string | null;
  /** Values extracted from generated graph node configs (proof for threshold tests). */
  extracted?: {
    matchThreshold?: number;
    rerank?: boolean;
    hardFilters?: string[];
  };
  codePaths: string[];
};

export function extractConfigProof(
  definition: GraphDefinition,
): GenerationTrace["extracted"] {
  const match = definition.nodes.find((n) => n.impl === "syntra.match.process");
  const cfg = match?.config;
  if (!cfg || typeof cfg !== "object") return undefined;
  const out: GenerationTrace["extracted"] = {};
  if (typeof cfg.matchThreshold === "number") {
    out.matchThreshold = cfg.matchThreshold;
  }
  if (typeof cfg.rerank === "boolean") {
    out.rerank = cfg.rerank;
  }
  if (Array.isArray(cfg.hardFilters)) {
    out.hardFilters = cfg.hardFilters.filter(
      (f): f is string => typeof f === "string",
    );
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildLlmGenerationTrace(args: {
  userRequest: string;
  systemPrompt: string;
  rawText: string;
  model: string;
  definition: GraphDefinition;
}): GenerationTrace {
  return {
    mode: "llm",
    pipeline:
      "policy/request → buildGraphSystemPrompt → proposeGraphFromLlm (structured JSON schema) → compileLlmProposalToGraph → validateLlmGraphProposal → graph JSON",
    userRequest: args.userRequest,
    systemPrompt: args.systemPrompt,
    rawText: args.rawText,
    model: args.model,
    extracted: extractConfigProof(args.definition),
    codePaths: [
      "packages/authoring/src/build-graph-prompt.ts",
      "packages/authoring/src/propose-graph-from-llm.ts",
      "packages/authoring/src/generate-graph-from-llm.ts",
      "apps/admin-api/src/routes/agents.ts (POST /agents/:id/generate)",
    ],
  };
}

export function buildTemplateGenerationTrace(): GenerationTrace {
  return {
    mode: "template",
    pipeline:
      "policy JSON → generateGraphFromTemplate (fixed template.nodes + template.wiring) — does NOT parse policy prose for topology",
    codePaths: [
      "packages/authoring/src/generate-graph.ts",
      "packages/authoring/src/template-catalog.ts",
    ],
  };
}

/** Rebuild UI trace from stored agent_versions.meta. */
export function generationMetaToTrace(
  meta: GenerationMeta,
  definition?: GraphDefinition | null,
): GenerationTrace {
  const extracted = definition ? extractConfigProof(definition) : undefined;
  if (meta.mode === "template") {
    return {
      ...buildTemplateGenerationTrace(),
      extracted,
    };
  }
  return {
    mode: "llm",
    pipeline:
      meta.pipeline ??
      "policy/request → buildGraphSystemPrompt → proposeGraphFromLlm (structured JSON) → compileLlmProposalToGraph → validateLlmGraphProposal",
    userRequest: meta.userRequest,
    systemPrompt: meta.systemPrompt,
    rawText: meta.rawText,
    model: meta.model,
    extracted,
    codePaths: [
      "packages/authoring/src/build-graph-prompt.ts",
      "packages/authoring/src/propose-graph-from-llm.ts",
      "packages/authoring/src/generate-graph-from-llm.ts",
      "apps/admin-api/src/routes/agents.ts (POST /agents/:id/generate)",
    ],
  };
}

export function toolsFromGraph(definition: GraphDefinition | null | undefined): string[] {
  if (!definition?.nodes?.length) return [];
  return [
    ...new Set(
      definition.nodes
        .map((n) => n.impl)
        .filter((k): k is string => typeof k === "string" && k.length > 0),
    ),
  ];
}

export function buildGenerationMeta(args: {
  mode: "llm" | "template";
  model?: string | null;
  userRequest?: string | null;
  rawText?: string | null;
  events?: EventCatalogEntry[];
  policy: Record<string, unknown>;
  definition: GraphDefinition;
  unsupported?: string[];
  builtSummary?: string | null;
  triggerEventSchema?: GenerationMeta["triggerEventSchema"];
}): GenerationMeta {
  const allowedTools = Array.isArray(args.policy.allowedTools)
    ? args.policy.allowedTools.filter((t): t is string => typeof t === "string")
    : [];
  const triggerEventType =
    typeof args.policy.triggerEventType === "string"
      ? args.policy.triggerEventType
      : null;
  const policyPrompt =
    typeof args.policy.prompt === "string" ? args.policy.prompt : null;

  const toolsUsed = toolsFromGraph(args.definition);
  const unsupported = (args.unsupported ?? []).filter(
    (s) => typeof s === "string" && s.trim(),
  );

  let systemPrompt: string | null = null;
  let rawText: string | null = null;
  let pipeline: string | null = null;
  if (args.mode === "llm") {
    systemPrompt = buildGraphSystemPrompt({
      events: args.events ?? [],
    });
    pipeline =
      "policy/request → buildGraphSystemPrompt → proposeGraphFromLlm (structured JSON) → compileLlmProposalToGraph → validateLlmGraphProposal";
  } else {
    systemPrompt = [
      "Template-driven graph generation.",
      "Tools catalog:",
      ...getToolCatalog().map((t) => `- ${t.key}: ${t.description}`),
    ].join("\n");
    pipeline = "generateGraphFromTemplate (fixed template topology)";
  }

  const rawFromArgs = args.rawText?.trim();
  if (rawFromArgs) rawText = rawFromArgs;

  return {
    mode: args.mode,
    model: args.model ?? null,
    userRequest: args.userRequest?.trim() || null,
    systemPrompt,
    rawText,
    pipeline,
    policyPrompt,
    allowedTools,
    triggerEventType,
    toolsUsed,
    graphKey: args.definition.graphKey ?? null,
    builtSummary: args.builtSummary ?? null,
    unsupported,
    gapAcknowledged: true,
    acknowledgedAt: new Date().toISOString(),
    triggerEventSchema: args.triggerEventSchema ?? null,
    generatedAt: new Date().toISOString(),
  };
}

export function readGenerationMeta(meta: unknown): GenerationMeta | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const m = meta as Record<string, unknown>;
  if (m.mode !== "llm" && m.mode !== "template") return null;
  return {
    mode: m.mode,
    model: typeof m.model === "string" ? m.model : null,
    userRequest: typeof m.userRequest === "string" ? m.userRequest : null,
    systemPrompt: typeof m.systemPrompt === "string" ? m.systemPrompt : null,
    rawText: typeof m.rawText === "string" ? m.rawText : null,
    pipeline: typeof m.pipeline === "string" ? m.pipeline : null,
    policyPrompt: typeof m.policyPrompt === "string" ? m.policyPrompt : null,
    allowedTools: Array.isArray(m.allowedTools)
      ? m.allowedTools.filter((t): t is string => typeof t === "string")
      : [],
    triggerEventType:
      typeof m.triggerEventType === "string" ? m.triggerEventType : null,
    toolsUsed: Array.isArray(m.toolsUsed)
      ? m.toolsUsed.filter((t): t is string => typeof t === "string")
      : [],
    graphKey: typeof m.graphKey === "string" ? m.graphKey : null,
    builtSummary: typeof m.builtSummary === "string" ? m.builtSummary : null,
    unsupported: Array.isArray(m.unsupported)
      ? m.unsupported.filter((t): t is string => typeof t === "string")
      : undefined,
    gapAcknowledged: m.gapAcknowledged === true ? true : undefined,
    acknowledgedAt:
      typeof m.acknowledgedAt === "string" ? m.acknowledgedAt : undefined,
    triggerEventSchema:
      m.triggerEventSchema && typeof m.triggerEventSchema === "object"
        ? (m.triggerEventSchema as GenerationMeta["triggerEventSchema"])
        : null,
    generatedAt:
      typeof m.generatedAt === "string"
        ? m.generatedAt
        : new Date().toISOString(),
  };
}
