/**
 * The node contract — spec §6.1.
 *
 * Every node declares itself here, once, in the file next to its own code.
 * Everything else in the platform is a projection of these declarations:
 * the editor's insert menu, generated config forms, CI stubbing and fixtures,
 * run-detail redaction, the allowlist ceremony, the materialized registry.
 *
 * Rule of thumb when extending: if a screen needs to know something, the
 * contract declares it — never build a screen feature that reads data the
 * contract does not carry (principle 7). If it can be computed from what is
 * already declared, it is a projection at the bottom of this file and is
 * never typed by hand (principle 6).
 */
import { createHash } from "node:crypto";
import { z } from "zod";

/* ────────────────────────────── primitives ───────────────────────────── */

/** A Zod schema used as a contract field (input / output / config). */
const ZodSchemaField = z.custom<z.ZodType>((v) => v instanceof z.ZodType, {
  message: "expected a Zod schema",
});

const fn = <T>() =>
  z.custom<T>((v) => typeof v === "function", {
    message: "expected a function",
  });

/** `syntra.jd.process`, `human.gate` — lowercase dotted segments. */
const NodeKey = z
  .string()
  .regex(/^[a-z0-9]+(?:\.[a-z0-9-]+)+$/, "must look like `module.entity.verb`");

/** semver. A MAJOR bump creates a new registry entry `key@major`. */
const SemVer = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "must be semver, e.g. `1.0.0`");

/**
 * The modules, and what each one is for, live in `module-registry.ts`.
 *
 * They used to be a bare three-name tuple here, which is how `orbit`, `relay`
 * and `interview` came to be running in production while being unrepresentable
 * in a contract. Re-exported so every existing import keeps working.
 */
export { MODULES, type Module } from "./module-registry.js";
import { MODULES } from "./module-registry.js";

/**
 * Drives CI stubbing (§6.1). Closed set on purpose: a dependency CI cannot
 * stub is a dependency a node may not declare.
 */
export const DEPENDENCIES = [
  "llm",
  "db",
  "http",
  "object-storage",
  "external-api",
] as const;
export type Dependency = (typeof DEPENDENCIES)[number];

/** Dependencies whose real call must never happen in an automated test (§4). */
const MUST_BE_STUBBED: readonly Dependency[] = ["llm", "external-api"];

/* ──────────────────────────── side effect class ──────────────────────── */

/**
 * How much damage this node can do. The most load-bearing field on the form —
 * retries, the allowlist ceremony, and editor testability all key off it.
 */
export const SideEffectSchema = z.enum([
  "read", //            reads only; re-running is free
  "internal_write", //  writes inside our own boundary
  "external", //        something leaves the building — email, webhook
  "financial", //       money moves
  "control", //         human.gate, event.emit — orchestration, not business
]);
export type SideEffect = z.infer<typeof SideEffectSchema>;

/** Side-effect classes that change the world and so cannot be `pure`. */
const WRITING: readonly SideEffect[] = ["internal_write", "external", "financial"];

/** Side-effect classes that need a written justification per graph (§6.1). */
const NEEDS_ALLOWLIST: readonly SideEffect[] = ["external", "financial"];

/* ───────────────────────────── idempotency ───────────────────────────── */

/**
 * If this node is retried, does the thing happen twice? The node boundary is
 * the retry boundary — a failed run resumes at the node that failed.
 *
 * The spec sketches `{ strategy }` alone. We require the key alongside it: a
 * bare strategy word is unfalsifiable, and "which key" is exactly the argument
 * a writing node's PR is supposed to have. See docs/adr/node-contract-shape.md.
 */
export const IdempotencySchema = z.discriminatedUnion("strategy", [
  z.object({
    /** Nothing happens twice because nothing happens. `read` / `control` only. */
    strategy: z.literal("pure"),
  }),
  z.object({
    /** "A row for this key already exists, so this is a no-op." */
    strategy: z.literal("natural_key"),
    /** Dot paths into `input` that together form the key. */
    keyPaths: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    /** The caller supplies a key and we dedupe on it. */
    strategy: z.literal("idempotency_key"),
    /** Dot path into `input` carrying the caller-supplied key. */
    keyPath: z.string().min(1),
  }),
]);
export type Idempotency = z.infer<typeof IdempotencySchema>;

/* ────────────────────────────── execution ────────────────────────────── */

/**
 * How the runtime should treat a thrown error. Only the node knows how to read
 * its own failures, so the classification ships with the node.
 *
 * - `transient`        the network blipped — retry with backoff
 * - `permanent_input`  the input was bad — a clean product outcome, not a bug
 * - `permanent_system` we are broken — stop and surface it
 */
export type ErrorClass = "transient" | "permanent_input" | "permanent_system";

export const ExecutionSchema = z.object({
  timeoutMs: z.int().positive(),
  retry: z.object({
    limit: z.int().min(0),
    backoff: z.enum(["exponential", "fixed", "none"]),
    baseMs: z.int().positive(),
  }),
  classifyError: fn<(e: unknown) => ErrorClass>(),
  /** Named advisory locks this node takes. Empty is the normal case. */
  locks: z.array(z.string().min(1)).default([]),
});

/* ───────────────────────────── persistence ───────────────────────────── */

/** Governs what run detail is allowed to render (screen 13). */
export const PersistenceModeSchema = z.enum(["full", "ref_only", "redact"]);

export const PersistenceSchema = z.object({
  storeInput: PersistenceModeSchema,
  storeOutput: PersistenceModeSchema,
  /** Dot paths never rendered. Required when either mode is `redact`. */
  redactPaths: z.array(z.string().min(1)).default([]),
});

/* ─────────────────────────────── fixtures ────────────────────────────── */

/**
 * A worked example CI replays. At least one is mandatory, and it must be
 * realistic — `{}` passes the schema and proves nothing.
 *
 * Exact-vs-shape comparison is derived from `dependencies`, never declared.
 */
export const FixtureSchema = z.object({
  name: z.string().min(1),
  input: z.unknown(),
  config: z.unknown(),
  expectedOutput: z.unknown(),
});

/* ─────────────────────────────── run ctx ─────────────────────────────── */

/**
 * What a node asks the platform to publish.
 *
 * Type and payload only. Event ids, correlation, causation and the aggregate
 * are copied from the trigger by the runtime — that is plumbing, and plumbing
 * is the orchestrator's job, not the module's. A node that builds its own
 * envelope is a node that can get correlation wrong.
 */
export interface EmittedEvent {
  event_type: string;
  payload: Record<string, unknown>;
}

/**
 * What a node says it may publish.
 *
 * WHY THIS IS DECLARED AND NOT INFERRED.
 *
 * Applications hand work to each other by publishing an event. When the
 * publisher never publishes, the next workflow is simply never triggered:
 * the first run SUCCEEDS, nothing errors, and the work stops. It is the one
 * failure in this design that leaves no trace anywhere.
 *
 * Nothing could catch it, because a node's emits were only ever visible by
 * reading its code. The editor could not warn, the go-live gate could not
 * check, and a chain drawn on screen was an assumption wearing the clothes of
 * a fact. Declaring it moves that from unknowable to checkable.
 *
 * Two forms, because nodes genuinely do both:
 *
 *   "syntra.jd.parsed"          — a fixed event, published from the node
 *   { fromConfig: "onActionable" } — the type is a design-time setting, so the
 *                                 event is whatever the graph author chose
 *
 * Conditional emits are still declared. This is what the node MAY publish, not
 * what it publishes every run — a list that only covered the guaranteed cases
 * would miss every branch, which is most of them.
 */
export const EmitDeclarationSchema = z.union([
  z.string().min(1),
  z.object({
    /** Name of the config field holding the event type. */
    fromConfig: z.string().min(1),
  }),
]);
export type EmitDeclaration = z.infer<typeof EmitDeclarationSchema>;

/**
 * The event types a node may publish, given the settings it was given.
 *
 * A `fromConfig` entry naming a field that is absent or is not a string
 * contributes nothing rather than an empty or `undefined` event type — an
 * unset optional setting means that exit is not wired, which is ordinary.
 */
export function resolveEmits(
  emits: readonly EmitDeclaration[] | undefined,
  config: Record<string, unknown> | undefined,
): string[] {
  const out: string[] = [];
  for (const e of emits ?? []) {
    if (typeof e === "string") {
      out.push(e);
      continue;
    }
    const v = config?.[e.fromConfig];
    if (typeof v === "string" && v.length > 0) out.push(v);
  }
  return [...new Set(out)];
}

/**
 * The structural minimum a node may rely on. Deliberately smaller than the
 * engine's `NodeCtx`, which satisfies it — the constitution cannot import the
 * runtime it governs, and an adapter may not import the engine.
 */
export interface NodeRunCtx {
  readonly orgId: string;
  readonly logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  /** Buffered. The runner drains these into the outbox after the node succeeds. */
  readonly emit: (event: EmittedEvent) => void;
}

/* ────────────────────────── the contract itself ──────────────────────── */

export const NodeContractSchema = z
  .object({
    // ── identity ──────────────────────────────────────────────────────
    key: NodeKey,
    version: SemVer,
    module: z.enum(MODULES),
    /** May graphs outside `module` use this node? */
    shareable: z.boolean(),

    title: z.string().min(1),
    /**
     * One plain sentence in business language. Read by humans browsing the
     * catalog and by the AI matching a plain-English request in screen 2.
     */
    description: z.string().min(10),
    tags: z.array(z.string().min(1)).default([]),

    // ── data shapes ───────────────────────────────────────────────────
    /** Runtime dataflow — changes every run, never edited in a UI. */
    input: ZodSchemaField,
    output: ZodSchemaField,
    /**
     * Design-time values, frozen into the graph version. Individual fields
     * carry `.meta({ adminExposed: true })` to appear on the admin's per-org
     * config form — the flag lives on the field, never in a parallel list.
     */
    config: ZodSchemaField,

    // ── what it publishes ─────────────────────────────────────────────
    /**
     * Every event this node may publish. Required, and `[]` is a real answer
     * meaning "publishes nothing" — which is why there is no default. An
     * absent declaration and a declaration of nothing must never look alike:
     * one is a node nobody has described, the other is a node described as
     * silent, and treating the first as the second is how a broken handoff
     * gets reported as fine.
     */
    emits: z.array(EmitDeclarationSchema),

    // ── danger ────────────────────────────────────────────────────────
    sideEffect: SideEffectSchema,
    idempotency: IdempotencySchema,

    // ── execution ─────────────────────────────────────────────────────
    execution: ExecutionSchema,
    /** Required iff `dependencies` includes "llm". Also caps editor node tests. */
    llm: z
      .object({
        budget: z.object({
          maxTokensPerRun: z.int().positive(),
          maxUSDPerRun: z.number().positive(),
        }),
      })
      .optional(),
    dependencies: z.array(z.enum(DEPENDENCIES)).default([]),
    persistence: PersistenceSchema,

    // ── evidence ──────────────────────────────────────────────────────
    fixtures: z.array(FixtureSchema).min(1, "at least one fixture is required"),
    /** Required iff the node declares "llm" or "external-api". */
    stub: fn<(input: never, config: never) => unknown>().optional(),

    // ── behaviour ─────────────────────────────────────────────────────
    /** The only imperative part. */
    run: fn<(ctx: NodeRunCtx, input: never, config: never) => Promise<unknown>>(),
  })
  .superRefine((c, ctx) => {
    const declares = (d: Dependency) => c.dependencies.includes(d);

    // 1 — an llm dependency and a budget travel together, both ways.
    if (declares("llm") && !c.llm) {
      ctx.addIssue({
        code: "custom",
        path: ["llm"],
        message: 'declares dependency "llm" — a token/USD budget is mandatory',
      });
    }
    if (!declares("llm") && c.llm) {
      ctx.addIssue({
        code: "custom",
        path: ["dependencies"],
        message: 'declares an llm budget but not the "llm" dependency',
      });
    }

    // 2 — anything CI must stub needs a stub.
    if (MUST_BE_STUBBED.some(declares) && !c.stub) {
      ctx.addIssue({
        code: "custom",
        path: ["stub"],
        message:
          "declares llm/external-api — a stub is required so CI never calls it for real",
      });
    }

    // 3 — a node that changes the world cannot claim to be pure.
    if (WRITING.includes(c.sideEffect) && c.idempotency.strategy === "pure") {
      ctx.addIssue({
        code: "custom",
        path: ["idempotency", "strategy"],
        message: `sideEffect "${c.sideEffect}" changes the world — it cannot be "pure". The node boundary is the retry boundary.`,
      });
    }

    // 4 — redact mode and redactPaths travel together, both ways.
    const redacting =
      c.persistence.storeInput === "redact" ||
      c.persistence.storeOutput === "redact";
    if (redacting && c.persistence.redactPaths.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["persistence", "redactPaths"],
        message:
          'persistence is "redact" but no paths are listed — run detail would render everything',
      });
    }
    if (!redacting && c.persistence.redactPaths.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["persistence", "storeInput"],
        message: 'redactPaths are listed but neither store mode is "redact"',
      });
    }
  });

export type NodeContract = z.infer<typeof NodeContractSchema>;

/* ──────────────────────────── defineNode() ───────────────────────────── */

/** The declared half, minus the schema-typed fields. Inferred, never retyped. */
type NodeContractMeta = Omit<
  NodeContract,
  "input" | "output" | "config" | "fixtures" | "stub" | "run"
>;

/** One worked example, typed from the node's own schemas. */
export interface NodeFixture<I, O, C> {
  name: string;
  input: I;
  config: C;
  expectedOutput: O;
}

/**
 * The authored shape. Generic over the node's own schemas so `run`, `stub` and
 * `fixtures` are typed from `input` / `output` / `config`: a fixture whose
 * input does not satisfy the declared schema fails typecheck, long before CI.
 *
 * Declared as an interface rather than an intersection so TypeScript names it
 * in errors and hovers — this is the type three teams read while copying the
 * reference node.
 */
export interface NodeContractInput<I, O, C> extends NodeContractMeta {
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  config: z.ZodType<C>;
  fixtures: Array<NodeFixture<I, O, C>>;
  stub?: (input: I, config: C) => O;
  run: (ctx: NodeRunCtx, input: I, config: C) => Promise<O>;
}

/** Any authored contract, when the specific I/O/C do not matter. */
export type AnyNodeContract = NodeContractInput<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Validates at module load and names the offending field. A broken contract
 * fails when the file is imported — not at the first run in production.
 */
export function defineNode<I, O, C>(
  spec: NodeContractInput<I, O, C>,
): NodeContractInput<I, O, C> {
  const parsed = NodeContractSchema.safeParse(spec);
  if (!parsed.success) {
    const where = spec?.key ?? "<unknown node>";
    const lines = parsed.error.issues.map(
      (i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new Error(`NODE_CONTRACT_INVALID: ${where}\n${lines.join("\n")}`);
  }
  // Cross-checks Zod cannot express, because one field validates a sibling.
  for (const [n, f] of spec.fixtures.entries()) assertFixture(spec, n, f);
  return spec;
}

function assertFixture<I, O, C>(
  spec: NodeContractInput<I, O, C>,
  n: number,
  f: { name: string; input: I; config: C; expectedOutput: O },
): void {
  const check = (label: string, schema: z.ZodType, value: unknown) => {
    const r = schema.safeParse(value);
    if (!r.success) {
      throw new Error(
        `NODE_CONTRACT_INVALID: ${spec.key} fixture[${n}] "${f.name}" ${label} ` +
          "does not satisfy the declared schema:\n  " +
          r.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("\n  "),
      );
    }
  };
  check("input", spec.input, f.input);
  check("config", spec.config, f.config);
  check("expectedOutput", spec.output, f.expectedOutput);
}

/* ───────────────────────────── projections ───────────────────────────── */
/* Derived, never hand-maintained (principle 6). Every function below is a
   pure read of the contract — this is what the screens and CI consume.     */

/** `human.gate@1` — the registry entry key. MAJOR only, per §6.1. */
export function registryKey(c: Pick<NodeContract, "key" | "version">): string {
  return `${c.key}@${c.version.split(".")[0]}`;
}

/** `external` / `financial` are never node-testable in the editor (§6.1). */
export function isEditorTestable(c: Pick<NodeContract, "sideEffect">): boolean {
  return !NEEDS_ALLOWLIST.includes(c.sideEffect);
}

/** `external` / `financial` need a per-graph allowlist entry with justification. */
export function requiresAllowlist(c: Pick<NodeContract, "sideEffect">): boolean {
  return NEEDS_ALLOWLIST.includes(c.sideEffect);
}

/** Exact match for deterministic nodes, shape-only for LLM nodes (§6.1). */
export function fixtureMatchMode(
  c: Pick<NodeContract, "dependencies">,
): "exact" | "shape" {
  return c.dependencies.includes("llm") ? "shape" : "exact";
}

/** Config fields an admin may tune per org (screen 11). */
export function adminExposedFields(c: Pick<NodeContract, "config">): string[] {
  const shape = (c.config as z.ZodObject<z.ZodRawShape>)?.shape;
  if (!shape) return [];
  return Object.entries(shape)
    .filter(([, f]) => (f as z.ZodType).meta()?.adminExposed === true)
    .map(([name]) => name);
}

/* ────────────────────────── the serializable half ────────────────────── */

/**
 * `run`, `stub` and `classifyError` are functions and cannot be checksummed.
 * This projects the declarative half — what `node_registry` stores and what
 * CI drift-checks. Zod schemas become JSON Schema so they compare stably.
 */
export function toRegistryRow(c: AnyNodeContract) {
  return {
    registry_key: registryKey(c),
    key: c.key,
    version: c.version,
    module: c.module,
    shareable: c.shareable,
    title: c.title,
    description: c.description,
    tags: c.tags,
    input_schema: z.toJSONSchema(c.input),
    output_schema: z.toJSONSchema(c.output),
    config_schema: z.toJSONSchema(c.config),
    admin_exposed: adminExposedFields(c),
    emits: c.emits,
    side_effect: c.sideEffect,
    idempotency: c.idempotency,
    execution: {
      timeoutMs: c.execution.timeoutMs,
      retry: c.execution.retry,
      locks: c.execution.locks,
      // classifyError deliberately absent — behaviour, not shape
    },
    llm: c.llm ?? null,
    dependencies: c.dependencies,
    persistence: c.persistence,
    fixture_names: c.fixtures.map((f) => f.name),
    has_stub: c.stub !== undefined,
  };
}

/** Stable hash of the declarative half — lets CI fail when git and DB differ. */
export function checksumOf(row: unknown): string {
  return createHash("sha256").update(stableStringify(row)).digest("hex");
}

/** Key-sorted JSON, so reordering a field does not move the checksum. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as object).sort();
  return `{${keys
    .map(
      (k) =>
        `${JSON.stringify(k)}:${stableStringify(
          (v as Record<string, unknown>)[k],
        )}`,
    )
    .join(",")}}`;
}
