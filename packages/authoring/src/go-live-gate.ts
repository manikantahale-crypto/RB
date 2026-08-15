import { createHash } from "node:crypto";
import {
  GraphDefinitionSchema,
  validateGraphTopology,
  type GraphDefinition,
} from "./graph-definition.js";
import { validateGraphNodeConfigs } from "./validate-llm-graph.js";

/**
 * Production keys from packages/orchestrator/src/nodes/registry.ts
 * (excludes test.resume.*).
 *
 * Check 1 uses THIS list — never the authoring TOOL_CATALOG alone.
 * Do not weaken: if an impl isn't here, go-live must block.
 * Becomes permissive only as real runtime tools are added to the registry.
 */
export const RUNTIME_RUNNABLE_IMPLS: readonly string[] = [
  "syntra.jd.process",
  "syntra.resume.process",
  "syntra.match.process",
  "human.gate",
] as const;

export type GoLiveGateCheckId =
  | "tools_runnable"
  | "structurally_valid"
  | "checksum_matches"
  | "no_runtime_key_collision"
  | "gap_acknowledged"
  | "one_active_safe";

export type GoLiveGateCheck = {
  id: GoLiveGateCheckId;
  ok: boolean;
  /** Plain English for the admin when blocked. */
  message: string;
};

export type GoLiveGateInput = {
  artifactSource: string;
  storedChecksum: string;
  /** Expected authored key, e.g. syntra.authored */
  expectedGraphKey: string;
  gapAck: {
    acknowledged: boolean;
    unsupported: string[];
  } | null;
  /**
   * Optional: result of verifying graph_definitions one-active index is
   * scoped per graph_key (Check 4 / 6). If omitted, only key-shape checks run.
   */
  oneActiveIndexPerGraphKey?: boolean;
};

export type GoLiveGateResult =
  | {
      ok: true;
      checks: GoLiveGateCheck[];
      definition: GraphDefinition;
      checksum: string;
      graphKey: string;
    }
  | {
      ok: false;
      checks: GoLiveGateCheck[];
      message: string;
      blockedBy: GoLiveGateCheckId[];
    };

function parseArtifactObject(
  artifactSource: string,
): { ok: true; obj: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(artifactSource) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        message: "Can't go live: the saved workflow isn't valid JSON.",
      };
    }
    return { ok: true, obj: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      message: "Can't go live: the saved workflow isn't valid JSON.",
    };
  }
}

/** Check 1 — every node.impl ∈ runtime nodeRegistry (production). */
function checkToolsRunnable(obj: Record<string, unknown>): GoLiveGateCheck {
  const runtime = new Set<string>(RUNTIME_RUNNABLE_IMPLS);
  const nodes = obj.nodes;
  if (!Array.isArray(nodes)) {
    return {
      id: "tools_runnable",
      ok: false,
      message: "Can't go live: workflow has no steps to check.",
    };
  }
  const missing: string[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const impl = (node as { impl?: unknown }).impl;
    if (typeof impl !== "string" || !impl.trim()) {
      missing.push("(empty)");
      continue;
    }
    if (!runtime.has(impl)) missing.push(impl);
  }
  const unique = [...new Set(missing)];
  if (unique.length > 0) {
    const first = unique[0]!;
    return {
      id: "tools_runnable",
      ok: false,
      message:
        unique.length === 1
          ? `Can't go live: '${first}' isn't available in the runtime yet.`
          : `Can't go live: '${unique.join("', '")}' aren't available in the runtime yet.`,
    };
  }
  return {
    id: "tools_runnable",
    ok: true,
    message: "Every step exists in the runtime registry.",
  };
}

/** Check 2 — GraphDefinitionSchema + validateGraphTopology (+ config shapes). */
function checkStructurallyValid(
  obj: Record<string, unknown>,
  expectedGraphKey: string,
): GoLiveGateCheck & { definition?: GraphDefinition } {
  try {
    const withKey =
      typeof obj.graphKey === "string" && obj.graphKey.trim()
        ? obj
        : { ...obj, graphKey: expectedGraphKey };
    const schema = GraphDefinitionSchema.safeParse(withKey);
    if (!schema.success) {
      const detail = schema.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "graph"}: ${i.message}`)
        .join("; ");
      return {
        id: "structurally_valid",
        ok: false,
        message: `Can't go live: ${detail}`,
      };
    }
    try {
      validateGraphTopology(schema.data);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        id: "structurally_valid",
        ok: false,
        message: `Can't go live: ${detail}`,
      };
    }
    try {
      validateGraphNodeConfigs(schema.data);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        id: "structurally_valid",
        ok: false,
        message: `Can't go live: ${detail}`,
      };
    }
    return {
      id: "structurally_valid",
      ok: true,
      message: "Workflow structure is valid.",
      definition: schema.data,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      id: "structurally_valid",
      ok: false,
      message: `Can't go live: ${detail}`,
    };
  }
}

/** Check 3 — checksum matches stored artifact. */
function checkChecksum(
  artifactSource: string,
  storedChecksum: string,
): GoLiveGateCheck & { checksum?: string } {
  const computed = createHash("sha256").update(artifactSource).digest("hex");
  if (!storedChecksum || computed !== storedChecksum) {
    return {
      id: "checksum_matches",
      ok: false,
      message:
        "Can't go live: the saved workflow doesn't match its integrity check. Accept it again, then retry.",
    };
  }
  return {
    id: "checksum_matches",
    ok: true,
    message: "Integrity check passed.",
    checksum: computed,
  };
}

/**
 * Check 4 — authored key only; never a runtime *.workflow key.
 * Also requires one-active index scoped per graph_key when that fact is supplied.
 */
function checkNoRuntimeKeyCollision(
  graphKey: string,
  expectedGraphKey: string,
  oneActiveIndexPerGraphKey: boolean | undefined,
): GoLiveGateCheck {
  if (graphKey.includes(".workflow")) {
    return {
      id: "no_runtime_key_collision",
      ok: false,
      message:
        "Can't go live: this would collide with a runtime workflow key. Authored workflows must use their own key.",
    };
  }
  if (graphKey !== expectedGraphKey) {
    return {
      id: "no_runtime_key_collision",
      ok: false,
      message: `Can't go live: workflow key must be '${expectedGraphKey}' (got '${graphKey}').`,
    };
  }
  if (oneActiveIndexPerGraphKey === false) {
    return {
      id: "no_runtime_key_collision",
      ok: false,
      message:
        "Can't go live: the one-active database rule isn't scoped per workflow key, so activation isn't safe.",
    };
  }
  return {
    id: "no_runtime_key_collision",
    ok: true,
    message:
      "Authored key only — will not retire or overwrite runtime workflow keys.",
  };
}

/** Check 5 — Accept recorded (gaps acknowledged). */
function checkGapAcknowledged(
  gapAck: GoLiveGateInput["gapAck"],
): GoLiveGateCheck {
  if (!gapAck || gapAck.acknowledged !== true) {
    return {
      id: "gap_acknowledged",
      ok: false,
      message:
        "Can't go live: accept the workflow preview first so any gaps are acknowledged.",
    };
  }
  return {
    id: "gap_acknowledged",
    ok: true,
    message:
      gapAck.unsupported.length > 0
        ? `Gaps acknowledged on Accept (${gapAck.unsupported.join(", ")}).`
        : "No gaps — Accept recorded.",
  };
}

/** Check 6 — only authored keys; activate supersedes prior authored-active per-key. */
function checkOneActiveSafe(graphKey: string): GoLiveGateCheck {
  if (!graphKey.endsWith(".authored")) {
    return {
      id: "one_active_safe",
      ok: false,
      message:
        "Can't go live: only authored workflows can be activated this way.",
    };
  }
  return {
    id: "one_active_safe",
    ok: true,
    message:
      "Activation will supersede the previous live authored version under this key only.",
  };
}

/**
 * Deterministic go-live gate — all 6 checks must pass.
 * No LLM judgment; pure verification. Order matches the product spec.
 */
export function evaluateGoLiveGate(input: GoLiveGateInput): GoLiveGateResult {
  const checks: GoLiveGateCheck[] = [];

  const parsed = parseArtifactObject(input.artifactSource);
  if (!parsed.ok) {
    checks.push({
      id: "structurally_valid",
      ok: false,
      message: parsed.message,
    });
    return failResult(checks);
  }

  // 1 — RUNTIME-RUNNABLE (before schema so missing tools surface clearly)
  checks.push(checkToolsRunnable(parsed.obj));

  // 2 — VALID
  const structural = checkStructurallyValid(
    parsed.obj,
    input.expectedGraphKey,
  );
  checks.push({
    id: structural.id,
    ok: structural.ok,
    message: structural.message,
  });
  const def = structural.definition;
  if (!structural.ok || !def) {
    return failResult(checks);
  }

  // 3 — CHECKSUM
  const checksum = checkChecksum(input.artifactSource, input.storedChecksum);
  checks.push({
    id: checksum.id,
    ok: checksum.ok,
    message: checksum.message,
  });

  const lockedKey = input.expectedGraphKey;
  const graphKey = def.graphKey || lockedKey;

  // 4 — NO RUNTIME-KEY COLLISION (+ optional index proof)
  checks.push(
    checkNoRuntimeKeyCollision(
      graphKey,
      lockedKey,
      input.oneActiveIndexPerGraphKey,
    ),
  );

  // 5 — GAP ACKNOWLEDGED
  checks.push(checkGapAcknowledged(input.gapAck));

  // 6 — ONE-ACTIVE (authored key; transactional supersede verified post-activate)
  checks.push(checkOneActiveSafe(lockedKey));

  if (checks.some((c) => !c.ok)) {
    return failResult(checks);
  }

  return {
    ok: true,
    checks,
    definition: { ...def, graphKey: lockedKey },
    checksum: checksum.checksum!,
    graphKey: lockedKey,
  };
}

function failResult(checks: GoLiveGateCheck[]): GoLiveGateResult {
  const failed = checks.filter((c) => !c.ok);
  return {
    ok: false,
    checks,
    blockedBy: failed.map((c) => c.id),
    message:
      failed[0]?.message ??
      "Can't go live: one or more safety checks failed.",
  };
}

export function buildGapAckMeta(unsupported: string[]): {
  gapAcknowledged: true;
  unsupported: string[];
  acknowledgedAt: string;
} {
  return {
    gapAcknowledged: true,
    unsupported: unsupported.filter((s) => typeof s === "string" && s.trim()),
    acknowledgedAt: new Date().toISOString(),
  };
}

export function readGapAckFromMeta(meta: unknown): GoLiveGateInput["gapAck"] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const m = meta as Record<string, unknown>;
  if (m.gapAcknowledged !== true) return null;
  const unsupported = Array.isArray(m.unsupported)
    ? m.unsupported.filter((x): x is string => typeof x === "string")
    : [];
  return { acknowledged: true, unsupported };
}

/**
 * True when pg index `graph_definitions_one_active` is unique on graph_key
 * (and org scope) — authored activate cannot retire a different key.
 */
export function oneActiveIndexIsPerGraphKey(indexDef: string | null | undefined): boolean {
  if (!indexDef) return false;
  const d = indexDef.toLowerCase();
  return (
    d.includes("unique") &&
    d.includes("graph_key") &&
    (d.includes("status") || d.includes("active"))
  );
}
