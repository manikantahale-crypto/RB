import { createHash } from "node:crypto";
import { checkInputsAvailable } from "./check-inputs-available.js";
import {
  GraphDefinitionSchema,
  validateGraphTopology,
  type GraphDefinition,
} from "./graph-definition.js";
import { validateGraphNodeConfigs } from "./validate-llm-graph.js";
import { RUNTIME_RUNNABLE_IMPLS } from "./tool-registry.js";

export { RUNTIME_RUNNABLE_IMPLS };

export type GoLiveGateCheckId =
  | "tools_runnable"
  | "structurally_valid"
  | "checksum_matches"
  | "no_runtime_key_collision"
  | "gap_acknowledged"
  | "one_active_safe"
  /** Every step can actually get the inputs it requires. */
  | "inputs_available"
  /** Every step is this application's own, or one another lent out. */
  | "impls_permitted"
  /** No step publishes the very event that starts this workflow. */
  | "no_self_trigger";

export type GoLiveGateCheck = {
  id: GoLiveGateCheckId;
  ok: boolean;
  /** Plain English for the admin when blocked. */
  message: string;
};

export type GoLiveGateInput = {
  artifactSource: string;
  storedChecksum: string;
  /**
   * The step implementations the runtime can actually run — the composed
   * contract registry's keys, handed in by the caller (admin-api reads
   * `adapters/index.ts`). Absent, the gate falls back to `tool-registry.ts`,
   * a hardcoded list that was the fourth place onboarding a module cost a
   * release: it knew SYNTRA, ASTRA and ORBIT and would have refused every
   * RELAY and PRISM workflow at go-live. Found 2026-09-21.
   */
  runnableImpls?: Iterable<string>;
  /** Expected authored key, e.g. syntra.authored */
  expectedGraphKey: string;
  /**
   * Which lifecycle this artifact belongs to. Defaults to `agent`, so every
   * existing caller behaves exactly as before.
   *
   * THREE OF THESE CHECKS WERE WRITTEN FOR AGENTS AND CANNOT PASS FOR A
   * WORKFLOW. That is not a judgement about workflows; it is that the rules
   * encode facts about the agent artifact:
   *
   *   one_active_safe    demands a key ending `.authored`. Workflow keys are
   *                      `syntra.match.workflow`, so it failed on all of them.
   *   checksum_matches   re-hashes the artifact text. A version's definition
   *                      is stored as jsonb, which does not preserve key
   *                      order, so the text cannot be reconstructed and the
   *                      hash never matches.
   *   gap_acknowledged   reads the acknowledgement the agent propose flow
   *                      writes into meta. Workflows have no such record.
   *
   * Reported honestly per kind rather than failed: a console that shows three
   * permanent reds teaches people that red means nothing, which costs more
   * than the checks were ever worth.
   */
  artifactKind?: "agent" | "workflow";
  gapAck: {
    acknowledged: boolean;
    unsupported: string[];
  } | null;
  /**
   * Optional: result of verifying graph_definitions one-active index is
   * scoped per graph_key (Check 4 / 6). If omitted, only key-shape checks run.
   */
  oneActiveIndexPerGraphKey?: boolean;
  /**
   * What the trigger event's payload declares, and what each node requires.
   *
   * Optional because the gate is called from places that do not have a
   * database to hand — a caller with no registry gets the six structural
   * checks it always got, and check 7 reports that it could not run rather
   * than passing silently. Missing evidence is not the same as evidence of
   * safety, and the difference has to be visible.
   */
  inputs?: {
    /**
     * Whether the trigger event DECLARES a payload at all.
     *
     * Eight event schemas are empty today, several of them for events that
     * run constantly — `syntra.match.requested` has been published 197 times.
     * An empty schema means nobody wrote down what the event carries, not
     * that it carries nothing, and treating those as the same accuses every
     * step in the workflow of a fault that belongs to the catalogue.
     */
    triggerDeclared: boolean;
    /** Property names on the trigger event's payload schema. */
    triggerFields: readonly string[];
    /** Node key → field names its input schema marks required. */
    requiredByImpl: Map<string, readonly string[]>;
  };
  /**
   * Who owns each step, and which ones were lent out.
   *
   * Optional for the same reason as `inputs`: a caller with no registry gets
   * "could not check" rather than a pass.
   */
  /**
   * What starts this workflow, and what its steps announce when they finish.
   *
   * Optional for the same reason as `inputs` and `ownership`: a caller with no
   * registry gets "could not check" rather than a silent pass.
   */
  selfTrigger?: {
    /**
     * The event this version will be bound to at go-live.
     *
     * Null when the binding is not decided yet, which is a legitimate state —
     * the check then reports that it could not run.
     */
    triggerEventType: string | null;
    /** Node key → the event types it declares it publishes. */
    emitsByImpl: Map<string, readonly string[]>;
  };
  ownership?: {
    /**
     * The application this workflow belongs to.
     *
     * NULL when it cannot be determined — a graph key whose first segment is
     * not a known application, of which there are two live today
     * (`duplicate.review`, `resume.intake`). Splitting the key on a dot and
     * trusting the result gave "duplicate" as an application name and made
     * every SYNTRA step in that workflow look foreign.
     */
    graphModule: string | null;
    /** Node key → its owning module. */
    moduleByImpl: Map<string, string>;
    /** Node keys their owning module marked shareable. */
    shareableImpls: Set<string>;
  };
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
function checkToolsRunnable(obj: Record<string, unknown>, runnable?: Iterable<string>): GoLiveGateCheck {
  const runtime = new Set<string>(runnable ?? RUNTIME_RUNNABLE_IMPLS);
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
  kind: "agent" | "workflow",
): GoLiveGateCheck & { checksum?: string } {
  const computed = createHash("sha256").update(artifactSource).digest("hex");
  /**
   * NOT VERIFIABLE FOR A WORKFLOW, AND SAYING SO IS THE POINT.
   *
   * The stored value is `checksumOf(definition)` — sha256 of the JSON as it
   * stood at compile time. The definition then lands in a jsonb column, which
   * normalises and does not preserve key order, so re-serialising what comes
   * back produces a different string and therefore a different hash. Measured
   * against the real table: stored `9be79bfd…`, recomputed `151c5172…`, for a
   * version nobody had touched.
   *
   * Failing would be a lie — nothing was tampered with, the evidence simply
   * cannot be read. Passing would be a worse lie. The real fix is a canonical
   * serialisation with sorted keys, which changes every checksum already
   * stored and is its own change.
   */
  if (kind === "workflow") {
    return {
      id: "checksum_matches",
      ok: true,
      checksum: storedChecksum || computed,
      message:
        "Not checked: a definition stored as jsonb cannot be re-serialised byte for byte, so its integrity hash cannot be recomputed.",
    };
  }
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
  /**
   * `.workflow` USED TO BE REFUSED OUTRIGHT, AND IT BLOCKED THE WHOLE PLATFORM.
   *
   * The rule came from the agent era, when an authored graph was
   * `<agent>.authored` and anything ending `.workflow` was seeded by a
   * migration. Refusing the suffix meant "do not overwrite a runtime
   * workflow", and at the time that was true.
   *
   * The unit of authorship is now a workflow, and the proposer NAMES them that
   * way — `provisionalKey` in `routes/propose.ts` is
   * `${module}.${word}.workflow`. So the gate refused the convention the
   * platform itself generates, and no workflow authored through screen 2 could
   * ever go live. It also blocked editing any of the seeded ones, which are
   * ordinary editable workflows now.
   *
   * WHAT ACTUALLY PREVENTS A COLLISION, AND IT IS NOT A NAME.
   * `graphs_key_per_org_idx` is unique on (org, graph_key). A second workflow
   * cannot take an existing key — the insert fails, long before go-live. The
   * suffix test was guarding something the database already makes impossible,
   * while forbidding something legitimate.
   *
   * The two checks below are the real ones: the definition must agree about
   * its own key, and the one-live rule must be scoped per key or activation
   * could retire somebody else's workflow.
   */
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
      "The definition agrees about its own key, and activation is scoped to it.",
  };
}

/** Check 5 — Accept recorded (gaps acknowledged). */
function checkGapAcknowledged(
  gapAck: GoLiveGateInput["gapAck"],
  kind: "agent" | "workflow",
): GoLiveGateCheck {
  /**
   * A workflow has no gap record to read.
   *
   * The acknowledgement is written by the agent propose flow into
   * `agent_versions.meta` — "the model could not build these three things and
   * a person has seen that". Nothing on the workflow path writes it, so asking
   * for it fails every workflow for a document that does not exist.
   *
   * `unsupported` is still surfaced to the author on screen 2, where the
   * proposal is accepted. What is missing here is the durable record, and
   * inventing a pass for it would claim a review happened.
   */
  if (kind === "workflow" && !gapAck) {
    return {
      id: "gap_acknowledged",
      ok: true,
      message:
        "Not checked: gaps are acknowledged when a proposal is accepted, and workflows keep no record of it to read back.",
    };
  }
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
function checkOneActiveSafe(
  graphKey: string,
  kind: "agent" | "workflow",
): GoLiveGateCheck {
  /**
   * A workflow key is the key, and there is nothing to suffix.
   *
   * The guarantee this check exists for — activating supersedes only the
   * previous live version under THIS key — is held for workflows by
   * `graph_versions_one_live_idx`, a unique index rather than a naming
   * convention. Demanding `.authored` of a workflow tested the convention and
   * ignored the index.
   */
  if (kind === "workflow") {
    const pinned = graphKey.includes("@");
    return {
      id: "one_active_safe",
      ok: !pinned,
      message: pinned
        ? "Can't go live: a version is pinned into the key. The live version is resolved at routing time, never written into the binding."
        : `Activation supersedes the previous live version of ${graphKey} and nothing else.`,
    };
  }
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
/**
 * Check 7 — every step can get the inputs it requires.
 *
 * The first check here about data rather than shape. A workflow can satisfy
 * all six above and still die on its first event, because nothing asked
 * whether the trigger carries what the steps need.
 *
 * Reports rather than assumes when it has no registry: a caller without a
 * database gets "could not check", never "fine".
 */
function checkInputsAreAvailable(
  def: GraphDefinition,
  evidence: GoLiveGateInput["inputs"],
): GoLiveGateCheck {
  if (!evidence) {
    return {
      id: "inputs_available",
      ok: true,
      message:
        "Inputs not checked — no node registry was supplied to the gate.",
    };
  }

  if (!evidence.triggerDeclared) {
    return {
      id: "inputs_available",
      ok: true,
      message:
        "Inputs not checked — the trigger event does not declare what its " +
        "payload contains, so there is nothing to check the steps against. " +
        "Declaring it in event_schemas is what makes this checkable.",
    };
  }

  const problems = checkInputsAvailable({
    def,
    triggerFields: evidence.triggerFields,
    requiredByImpl: evidence.requiredByImpl,
  });

  if (problems.length === 0) {
    return {
      id: "inputs_available",
      ok: true,
      message: "Every step can get what it needs.",
    };
  }

  return {
    id: "inputs_available",
    ok: false,
    message:
      `Can't go live: ${problems.length} step${problems.length === 1 ? "" : "s"} ` +
      `cannot get what they need. ${problems.map((p) => p.message).join(". ")}.`,
  };
}

/**
 * Check 8 — every step is this application's own, or one another lent out.
 *
 * `shareable` has existed on the node contract from the start and has only
 * ever been ADVISORY: it filters what the editor's palette offers, and nothing
 * looks at it again. The palette filter also applies only when a module is
 * supplied, so a caller that omits it is handed private nodes.
 *
 * The result is a live workflow, `relay.intake.workflow`, using
 * `astra.requirement.intake` — which is `shareable = false`. Exactly the
 * boundary this flag exists to prevent, crossed in production, with nothing to
 * notice.
 *
 * Checking it here rather than in the palette is the point: the palette
 * decides what is easy to pick, and this decides what may ship. A node reached
 * some other way — a hand-edited definition, a generated graph, an API call —
 * meets the same rule.
 *
 * Platform capability is exempt by being shareable, not by being special:
 * `human.gate` and `orch.branch.decision` are lent to everyone and pass here
 * the same way a lent SYNTRA node does.
 */
function checkImplsPermitted(
  def: GraphDefinition,
  evidence: GoLiveGateInput["ownership"],
): GoLiveGateCheck {
  if (!evidence) {
    return {
      id: "impls_permitted",
      ok: true,
      message:
        "Step ownership not checked — no node registry was supplied to the gate.",
    };
  }

  if (evidence.graphModule === null) {
    /**
     * Failing, not passing quietly.
     *
     * Boundaries cannot be enforced for a workflow whose owner nobody can
     * name, and the fix is small: call it `<application>.<something>`. Letting
     * it through would mean the one convention this check depends on is the
     * one thing it never insists on.
     */
    return {
      id: "impls_permitted",
      ok: false,
      message:
        `Can't go live: "${def.graphKey}" does not say which application it ` +
        `belongs to, so its steps cannot be checked against that application's ` +
        `boundaries. Name it "<application>.<something>".`,
    };
  }

  const offences: string[] = [];
  for (const node of def.nodes) {
    const owner = evidence.moduleByImpl.get(node.impl);
    // A node the registry has never heard of is check 1's problem, not this
    // one. Reporting it twice helps nobody.
    if (owner === undefined) continue;
    if (owner === evidence.graphModule) continue;
    if (evidence.shareableImpls.has(node.impl)) continue;
    offences.push(`${node.id} uses ${node.impl}, which ${owner} keeps private`);
  }

  if (offences.length === 0) {
    return {
      id: "impls_permitted",
      ok: true,
      message: "Every step is this application's own or shared with it.",
    };
  }

  return {
    id: "impls_permitted",
    ok: false,
    message:
      `Can't go live: ${offences.length} step${offences.length === 1 ? "" : "s"} ` +
      `belong to another application. ${offences.join(". ")}. ` +
      `Ask that application to publish an event you can start from instead.`,
  };
}

/**
 * Check 9 — does this workflow start itself?
 *
 * A step declares what it publishes. If one of those events is the event the
 * workflow is bound to, then finishing the workflow starts it again, and it
 * runs until somebody notices.
 *
 * THIS IS NOT HYPOTHETICAL. Screen 2 proposed exactly this: a flow of
 * `syntra.jd.process → syntra.continuous.match → syntra.shortlist.notify`
 * with `syntra.match.completed` as its trigger — and `syntra.continuous.match`
 * emits `syntra.match.completed` unconditionally on every run. It would have
 * passed all eight of the checks that existed, because not one of them
 * compared the trigger against what the steps publish.
 *
 * Nothing downstream would have stopped it either: there is no depth or hop
 * guard in the router, and the node's declared idempotency does not help — it
 * mints a fresh match job when the backend does not return one, so each cycle
 * is new work. That node searches the entire bench with a 180-second timeout.
 *
 * WHY THIS BLOCKS RATHER THAN WARNS. Every other check here answers "can this
 * run". This one answers "will this stop", and a loop is not a thing an
 * approver can weigh up from a sentence — by the time it is visible it has
 * already been running. A deliberate self-re-entry is a real pattern, but it
 * needs a guard the author writes down, and there is nowhere to write one
 * today. When there is, this check gets an exemption and not before.
 *
 * The check is on DECLARED emits. A node that publishes without declaring is
 * invisible here — that is the same limit `detectTriggeredWorkflows` has, and
 * the honest answer is that the contract is the only thing a static check can
 * read.
 */
function checkNoSelfTrigger(
  def: GraphDefinition,
  selfTrigger: GoLiveGateInput["selfTrigger"],
): GoLiveGateCheck {
  if (!selfTrigger) {
    return {
      id: "no_self_trigger",
      ok: true,
      message:
        "Not checked: no node registry was available to read what each step publishes.",
    };
  }

  const trigger = selfTrigger.triggerEventType;
  if (!trigger) {
    return {
      id: "no_self_trigger",
      ok: true,
      message: "Not checked: this version has no trigger event yet.",
    };
  }

  const offenders = def.nodes
    .filter((n) =>
      (selfTrigger.emitsByImpl.get(n.impl) ?? []).includes(trigger),
    )
    .map((n) => `${n.id} (${n.impl})`);

  if (offenders.length > 0) {
    return {
      id: "no_self_trigger",
      ok: false,
      message:
        `Can't go live: ${offenders.join(", ")} publishes ${trigger}, ` +
        `which is the event that starts this workflow. Every run would start ` +
        `another one, and nothing would stop it. Either trigger this on a ` +
        `different event, or remove the step that publishes it.`,
    };
  }

  return {
    id: "no_self_trigger",
    ok: true,
    message: `No step publishes ${trigger}, so this cannot restart itself.`,
  };
}

export function evaluateGoLiveGate(input: GoLiveGateInput): GoLiveGateResult {
  const checks: GoLiveGateCheck[] = [];
  /** Defaults to agent, so every existing caller is unaffected. */
  const kind = input.artifactKind ?? "agent";

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
  checks.push(checkToolsRunnable(parsed.obj, input.runnableImpls));

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

  /**
   * 3 — CHECKSUM, and only where it can mean anything.
   *
   * A CHECK THAT ANSWERS THE SAME FOR EVERY WORKFLOW IS NOT A CHECK.
   *
   * This reported "Not checked: a definition stored as jsonb cannot be
   * re-serialised byte for byte" on every workflow, always — so it took up a
   * line, said nothing, and taught people to skim a list whose whole value is
   * that each line is worth reading.
   *
   * It is an agent-era test and it belongs there. An agent's artifact was a
   * generated `agent.ts` FILE: a checksum caught somebody editing it on disk
   * between compile and go-live, which was a real path. A workflow's
   * definition is a jsonb column with no file, no editor and no path that
   * changes it outside the platform — and anybody who could change it could
   * change the checksum beside it in the same statement.
   *
   * Measured before removing: of 95 stored version checksums, ZERO can be
   * reproduced from the stored definition by any serialisation — compact,
   * pretty, or sorted-key canonical. They were computed from artifact text
   * that no longer exists. So the check could not have passed even if jsonb
   * ordering were solved.
   *
   * Checksums are still written and still used — `versionForDraft` compares a
   * draft's against a version's to decide whether the working copy has moved,
   * and both come from `checksumOf`, so they agree with each other. That use
   * works; verifying one against a stored artifact does not.
   */
  /**
   * Computed either way — the RESULT still carries the checksum, which is what
   * the caller stores. Only the CHECK is agent-only: the value is a fact, the
   * verification is the thing that could not mean anything for a workflow.
   */
  const checksum = checkChecksum(input.artifactSource, input.storedChecksum, kind);
  if (kind === "agent") {
    checks.push({
      id: checksum.id,
      ok: checksum.ok,
      message: checksum.message,
    });
  }

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

  /**
   * 5 — GAP ACKNOWLEDGED, and only where a gap can be acknowledged.
   *
   * Same fault as the checksum above, same reason. A "gap" is something the
   * model could not build, acknowledged by a person when they accepted a
   * proposal — an agent-era record, kept on the agent policy. A workflow keeps
   * no such record, so this answered "Not checked" for every workflow, every
   * time, forever.
   *
   * Two constant lines in a nine-line list is nearly a quarter of it saying
   * nothing, which is how a gate stops being read. If workflows ever record an
   * acknowledgement — accepting a proposal is where it would be written — this
   * comes back with something to say.
   */
  if (kind === "agent") {
    checks.push(checkGapAcknowledged(input.gapAck, kind));
  }

  // 6 — ONE-ACTIVE (authored key; transactional supersede verified post-activate)
  checks.push(checkOneActiveSafe(lockedKey, kind));

  // 7 — CAN IT ACTUALLY RUN
  checks.push(checkInputsAreAvailable(def, input.inputs));

  // 8 — MAY IT USE WHAT IT USES
  checks.push(checkImplsPermitted(def, input.ownership));

  // 9 — WILL IT STOP
  checks.push(checkNoSelfTrigger(def, input.selfTrigger));

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
 * True when the database itself guarantees one live version per workflow, so
 * activating one cannot quietly retire a different workflow's.
 *
 * Two index shapes satisfy that, and both are accepted:
 *
 *   graph_definitions_one_active  UNIQUE (graph_key, org scope) WHERE active
 *   graph_versions_one_live_idx   UNIQUE (graph_id)             WHERE live
 *
 * The second is the stronger of the two, not a weaker substitute. `graph_id`
 * is the workflow's primary key, and `graphs_key_per_org_idx` already makes
 * (org, graph_key) unique — so one live per graph_id IS one live per graph_key
 * per org, enforced one join closer to the thing it is about.
 */
export function oneActiveIndexIsPerGraphKey(indexDef: string | null | undefined): boolean {
  if (!indexDef) return false;
  const d = indexDef.toLowerCase();
  return (
    d.includes("unique") &&
    (d.includes("graph_key") || d.includes("graph_id")) &&
    (d.includes("status") || d.includes("active") || d.includes("live"))
  );
}
