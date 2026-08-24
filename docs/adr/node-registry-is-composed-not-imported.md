# The node registry is composed, not imported

**Status:** accepted
**Date:** 2026-08-21

---

## The question this had to answer

The node contract package defined the shapes. Nothing ran through it. Making one node actually
execute forced two decisions, and both shape the nine node tickets that follow.

## Decision 1 — the declared `input` is real

The bridge parses the trigger event payload against the node's declared `input`
before `run` is called, and parses what `run` returns against its declared
`output`.

The alternative was to hand the node the whole graph state and ignore what it
declared. That is one line shorter and it is the wrong answer:

- `input` and `output` would be documentation, and the editor's type-compatible
  insert menu — the reason the schemas exist — could never be built on them.
- Fixtures would test a shape production does not enforce.
- **`persistence` governs what run detail renders.** Redacting fields of a shape
  nothing guarantees is not a safety mechanism; it is the appearance of one.
  This is the argument that settled it.

Consequences, both deliberate:

- A payload that does not satisfy a node's input fails at the boundary, with
  that node's own field names, before any HTTP call is made.
- A node returning something its contract does not describe fails too. A
  registry row that quietly lies is worse than a loud failure.

## Decision 2 — the registry is injected, not imported

`GraphCompiler` now takes a node registry, defaulting to the engine's built-in
one. `apps/worker` composes the real one: engine nodes plus contract-derived
adapters.

The engine could not import the adapter — the anti-requirement list forbids
`engine → adapters` — but the rule is not why this is right. It is right
because of what the system is.

The orchestrator owns order, durability, routing, versioning and audit. Modules
own meaning, data and AI. There are two modules today and roughly twelve
planned, each meant to plug in "with zero changes to existing modules." A
compile-time registry inside the engine breaks that at the deployment layer:

| With a static registry | With a composed one |
|---|---|
| a new node means editing and redeploying the engine — ORBIT ships when the platform team cuts a release | a module ships on its own timetable |
| one module's bad adapter breaks the worker for every module | the failure is at the composition root, explicit and contained |
| every worker carries every module's adapter code | a worker can be given only the nodes it serves, so per-module workers become a deployment choice rather than a rewrite |
| CI must mock imports to stub a node | CI composes a registry of stubs |
| one entry per bare key — two majors cannot coexist | `key@major` is expressible when the registry needs it |

The cost is one constructor parameter and one dull file,
[`apps/worker/src/node-registry.ts`](../../orchestrator/apps/worker/src/node-registry.ts).

## Decision 3 — nodes name an event; the runtime builds the envelope

`NodeRunCtx` gained `emit({ event_type, payload })`. Event ids, correlation,
causation and the aggregate are copied from the trigger by the bridge.

Adapters cannot import the engine's `EventInput`, so something had to change —
but this is the right shape regardless. Envelope construction is plumbing, and
a node that builds its own envelope is a node that can get correlation wrong.

## What this makes each node conversion

Each remaining node is now: write `adapters/<module>/nodes/<key>.node.ts`, add
it to `contractNodes` in the composition, delete the engine implementation.
The bridge and the wiring are done once, here.

## Known and deliberate

**`syntra.jd.process` accepts `jobId` or `requirement_id`.** Two producers of
the same event disagree, and the engine implementation did the same `??` inline.
This is exactly what the per-binding `input_mapping` removes; when bindings
can say `{ jobId: "payload_ref.requirement_id" }`, the alias goes and the node
stops knowing that producers disagree.

**Its fixtures are hand-written, not captured.** SYNTRA :4000 was not running
during the conversion, so only stub responses were available. They are labelled
as such in the file and must be re-captured before the fixture runner
lands. A guessed fixture is worse than none, because it looks like evidence.

**`nodeRegistry` still holds nine nodes.** Each leaves as it is converted. When
it is empty, delete it.

## Also fixed here

`upsertActiveEventBinding` took `PoolClient | DbQueryable`. A union of two call
signatures is not callable, which is why three lines in that file had never
typechecked. Narrowed to `DbQueryable`, which `PoolClient` satisfies
structurally. `authoring` moves from CI's known-debt job into the blocking one;
only `admin` remains.