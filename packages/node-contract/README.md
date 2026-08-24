# @tekisho/node-contract

Every node declares itself here, once, in the file next to its own code.

Everything else is a projection of those declarations — the editor's insert
menu, generated config forms, CI stubbing and fixtures, run-detail redaction,
the allowlist ceremony, the materialized registry. That is why the spec calls
this the constitution: **never build a screen feature that needs data the
contract does not declare — extend the contract first.**

Start by reading
[`orchestrator/adapters/platform/nodes/human-gate.node.ts`](../../adapters/platform/nodes/human-gate.node.ts).
Copy its **shape**, not its answers.

```bash
npm run typecheck -w @tekisho/node-contract
npm test -w @tekisho/node-contract
npm run typecheck:adapters          # typechecks every *.node.ts
```

---

## The form

| Group | Fields | Effort |
|---|---|---|
| Identity | `key` `version` `module` `shareable` `title` `description` `tags` | minutes |
| Data shapes | `input` `output` `config` | ~an hour, from real payloads |
| **Danger** | **`sideEffect` `idempotency`** | **argue it** |
| Execution | `execution` `llm` `dependencies` | copy the node next door, then think about retries |
| **Privacy** | **`persistence`** | **argue it** |
| Evidence | `fixtures` `stub` | capture from a real run |
| Behaviour | `run` | you already wrote it |

Four fields carry real judgement: `sideEffect`, `idempotency`, `persistence`,
and which `config` fields are `adminExposed`. Everything else is transcription.
Your PR body must say **in one sentence** why this side-effect class and this
idempotency strategy — that sentence is the point of the ticket.

---

## `input` vs `config`

The distinction people get wrong on their first node:

- **`input`** — runtime data. The resume id flowing down the graph on *this
  run*. Different every run. Never edited in a UI.
- **`config`** — design-time data. `acceptThreshold: 0.92`, chosen when the
  workflow was built and **frozen into that graph version**. Same for every run
  of that version.

Mark a config field for the admin's per-org tuning form by flagging the field
itself — there is no separate list to keep in sync:

```ts
matchThreshold: z.number().min(0).max(1)
  .meta({ adminExposed: true, label: "Accept above" }),
```

Expose wording and thresholds. Do not expose anything that changes structure or
has queue-depth consequences — that is an engineer's PR, not an admin's form.

---

## `sideEffect` — how much damage can this do

| Value | Means | Consequences |
|---|---|---|
| `read` | reads only | re-running is free |
| `internal_write` | writes inside our boundary | must declare a real idempotency strategy |
| `external` | **something leaves the building** — email, webhook | per-graph allowlist entry with written justification; never added by AI generation; not testable in the editor |
| `financial` | money moves | same, more so |
| `control` | `human.gate`, `event.emit` | orchestration, not business |

When unsure between `internal_write` and `external`, ask: *if this runs twice by
accident, does a person outside the company notice?* If yes, it is `external`.

---

## `idempotency` — if this is retried, does it happen twice

The node boundary is the retry boundary: a failed run resumes **at the node that
failed**. So a retried `duplicate.merge` must not merge twice.

```ts
idempotency: { strategy: "pure" }                                  // read / control only
idempotency: { strategy: "natural_key", keyPaths: ["jobId", "resumeId"] }
idempotency: { strategy: "idempotency_key", keyPath: "requestId" }
```

Naming the key is required, not decorative — a bare strategy word cannot be
checked by anyone. Pick the key that is already unique in the table you write
to, and say so in the PR.

---

## `persistence` — what run detail is allowed to show

```ts
persistence: { storeInput: "redact", storeOutput: "full", redactPaths: ["resumeText"] }
```

`full` stores it, `ref_only` stores a pointer, `redact` stores it minus
`redactPaths`. **If your input carries a resume, a JD body, an email address or
anything a candidate would not want shown, this is the field that stops run
detail leaking it.** Nothing else does.

---

## `fixtures` — at least one, and realistic

A fixture is a worked example CI replays. `{}` satisfies the schema and proves
nothing; capture a real payload from a dev run instead. Pin both arms of any
node that can go two ways.

Exact-vs-shape comparison is derived from `dependencies` — declare `llm` and CI
compares shape only. You never choose this.

A node declaring `llm` or `external-api` **must** supply a `stub`, because no
automated test ever calls a real LLM or sends a real anything.

---

## The four things the schema refuses

Not style advice — `defineNode()` throws at module load, naming the field:

1. A node with `sideEffect` `internal_write` / `external` / `financial` cannot
   be `idempotency: pure`.
2. `dependencies: ["llm"]` and `llm.budget` must both be present, or neither.
3. `llm` or `external-api` without a `stub` is rejected.
4. `persistence` `redact` with no `redactPaths` — or `redactPaths` with no
   `redact` — is rejected.

```
NODE_CONTRACT_INVALID: syntra.bench.alert
  idempotency.strategy: sideEffect "external" changes the world — it cannot be
                        "pure". The node boundary is the retry boundary.
```

Fixtures are typed from your own schemas, so a mistyped fixture fails
**typecheck**, before CI ever runs.

---

## Projections — never type these by hand

Computed from what you already declared. If you find yourself wanting to
declare one of these, the answer is already in the contract:

| Function | Derived from |
|---|---|
| `registryKey()` → `human.gate@1` | `version`, MAJOR only |
| `isEditorTestable()` | `sideEffect` |
| `requiresAllowlist()` | `sideEffect` |
| `fixtureMatchMode()` → exact / shape | `dependencies` |
| `adminExposedFields()` | the `.meta()` flags |
| `toRegistryRow()` + `checksumOf()` | everything declarative |

`toRegistryRow()` deliberately drops `run`, `stub` and `classifyError` —
functions cannot be checksummed, and behaviour is not shape. Change how a node
classifies an error and the registry checksum does **not** move; change its
declared timeout and it does.

---

## Not wired yet

- `run` here is not the runtime's calling convention. The engine currently
  calls `(state, ctx) => Partial<State>`; the contract declares
  `(ctx, input, config)`. The runtime bridge adapts one to the other. See
  [`docs/adr/node-contract-shape.md`](../../docs/adr/node-contract-shape.md).
- `NodeRunCtx` is the structural minimum — `orgId` and `logger`. The engine's
  fuller `NodeCtx` satisfies it. The constitution cannot import the runtime it
  governs.
- Nothing materializes these to `node_registry` yet.
- `MODULES` is a closed set. Onboarding a module adds a line here, on purpose.
