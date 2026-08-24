# Node contract shape

**Status:** accepted
**Date:** 2026-08-21

Spec §6.1 sketches the node contract in about twenty lines. Turning that sketch
into an enforced schema forced four decisions the sketch left open. They are
recorded here because registry materialisation and CI both build directly on them.

---

## 1 · The contract splits into a declarative half and a runtime half

**Decision.** `toRegistryRow()` projects everything except `run`, `stub` and
`execution.classifyError`. That projection is what `node_registry` stores and
what CI drift-checks; the three functions never leave the process.

**Why.** Registry materialisation writes one checksummed row per contract and fails CI when
git and the table disagree. Functions cannot be serialized or checksummed, so a
contract that mixes them with declared shapes has no stable hash. Splitting now
costs nothing; retrofitting it in three weeks means rewriting the generator.

**Consequence, and it is the right one.** Changing how a node classifies an
error does **not** move its checksum — behaviour is not shape. Changing its
declared timeout does. A reviewer reading a checksum diff is reading a change
to the contract, never to an implementation detail.

Zod schemas are serialized via `z.toJSONSchema()`, which also gives the editor its
config-form generation for free.

---

## 2 · `idempotency` requires the key, not just the strategy

**Decision.** `natural_key` requires `keyPaths`, `idempotency_key` requires
`keyPath`. A discriminated union, not a bare enum.

**Deviation from spec.** §6.1 writes `idempotency: { strategy: "pure" |
"natural_key" | "idempotency_key" }` — the strategy word alone.

**Why.** A bare strategy word is unfalsifiable. A developer types
`natural_key`, the PR looks complete, and nothing anywhere records *which* key —
so no reviewer, and no CI check, can tell a considered answer from a guess.

The plan makes this explicit: continuous match says "pick the natural key **and
defend it**", and duplicate merge says a retried merge "must not merge twice". Those
tickets are asking for a fact the spec's shape has nowhere to put. This is the
spec's own intent, given a field.

**Cost.** One extra line per writing node.

---

## 3 · Four incoherent combinations are rejected, not warned about

**Decision.** `defineNode()` throws at module load when:

1. a `internal_write` / `external` / `financial` node claims `idempotency: pure`
2. `dependencies: ["llm"]` and `llm.budget` are not both present
3. a node declaring `llm` or `external-api` has no `stub`
4. `persistence: redact` has no `redactPaths`, or `redactPaths` appear without
   a `redact` mode

**Why.** Principle 1 — impossible, not discouraged. Each of these is a rule the
spec states in prose and each is a rule a tired developer breaks silently. Rule
4 is the one that matters most: it is exactly the resume-process failure mode where a
node declares resume text redacted, lists nothing, and run detail renders the
candidate's resume to anyone who can read a run.

**Deliberately not enforced here:** whether a `sideEffect` is *correct*. The
schema cannot know whether `syntra.bench.alert` posts to an internal channel or
emails a client. That answer is not in the code, which is why every node is its
own ticket with an argument attached.

---

## 4 · `run` declares the spec's signature, not the runtime's

**Decision.** The contract declares `run: (ctx, input, config) => Promise<O>`
per §6.1. The engine today calls `(state, ctx) => Promise<Partial<State>>`. The
reference node's `run` throws; nothing is wired.

**Why not reconcile them now.** This package is explicitly shapes-only — it is three
days because three developers are blocked behind it. Wiring the calling
convention means touching `nodeRegistry` and the compiler, which the ticket puts
out of scope and the runtime bridge puts in scope, as a mob session.

`NodeRunCtx` is declared as a structural minimum (`orgId`, `logger`) that the
engine's fuller `NodeCtx` already satisfies. The contract package does not
import the engine: the constitution cannot depend on the runtime it governs.

**Open for the runtime bridge.** Whether the adapter maps graph state into `input` per node
(declared `input` becomes real) or passes state through (declared `input`
becomes decoration). The first is the point of the contract; the second is the
easy path. Decide it in the mob and record it in its own decision note.

---

## Also settled

- **`MODULES` and `DEPENDENCIES` are closed sets.** Onboarding a module edits
  this package. Friction accepted: an undeclarable dependency is one CI cannot
  stub, and an unknown module should not typecheck.
- **`NodeContractInput` is an interface, not an intersection**, so TypeScript
  names it in errors and editor hovers rather than expanding it inline.
- **`description` is `min(10)`.** A length check is not a quality check; "a
  human can tell when this fires" stays a review rule, not a schema rule.
