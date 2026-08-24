# @tekisho/routing-contract

Which workflow answers which event, for which tenants, in what order.

Two things live here, and nothing else:

- **`BindingEntrySchema`** — the routing entry from spec §6.4
- **`resolveRoutes()`** — the router's decision as a pure function

```bash
npm run typecheck -w @tekisho/routing-contract
npm test -w @tekisho/routing-contract
```

Design decisions and the open questions: [`docs/adr/bindings-allow-fanout.md`](../../docs/adr/bindings-allow-fanout.md).

---

## Why the resolver is a pure function

No database, no network, no clock, no randomness. Same event + entitlements +
table in, same routes out, forever.

That is not tidiness. It is what makes **routing simulation** possible: CI
commits an expected outcome for a set of bindings, and a PR that changes a
routing result fails with a diff instead of surprising someone in production.
The DB read and the enqueueing stay in the worker; this package only decides.

---

## A binding

```ts
{
  event_type: "astra.requirement.published",
  routing_group: "requirement.post-intake",
  mode: "fanout",              // or "exclusive"
  priority: 10,                // lower number wins
  conditions: { requires_entitlement: ["SYNTRA"] },
  target_kind: "graph",        // or terminal / resume / fail
  workflow_key: "syntra.jd.workflow",   // KEY only, never key@version
  module_queue: "module.syntra.jd",
  input_mapping: { jobId: "payload_ref.requirement_id" },
  org_id: null,                // null = every tenant
  status: "ACTIVE",
  owner_module: "syntra",
}
```

### Routing groups

A group is the set of bindings answering one event **for one purpose**.

- **`exclusive`** — one binding in the group fires. Use it when two answers
  would mean doing the same work twice.
- **`fanout`** — every matching binding fires. Use it when two modules answer
  the same fact independently, which is normal and is how a new module is added
  without touching an existing one.

The mode belongs to the group. Every binding in a group must agree, or
`resolveRoutes()` throws.

### `target_kind`

| Value | Means |
|---|---|
| `graph` | start a workflow — the only kind with `workflow_key` and `module_queue` |
| `terminal` | the fact is recorded and nothing runs |
| `resume` | continue a run parked at a human gate |
| `fail` | route the event to failure handling |

**`terminal` is a normal answer, not a gap.** Most events end somewhere. CI
checks that every event has at least a terminal route so that "nothing happens
next" is something somebody decided, rather than something nobody noticed.

---

## Three things you cannot write

Not conventions — parse errors.

**1. A version on a binding.** There is no `version` field, and
`workflow_key: "syntra.jd.workflow@3"` is rejected. Bindings hold keys. The
active version is resolved at routing time and pinned onto the run, so a run
finishes on the version it started with no matter what is promoted meanwhile.

**2. Business logic in `conditions`.** The only allowed key is
`requires_entitlement`:

```ts
conditions: { requires_entitlement: [], minScore: 0.8 }   // parse error
```

"Which process starts for this fact" is routing. "A decision inside a running
process" is a branch in the graph. Keep them apart and no judgement, and no
LLM, ever sits on the routing path.

**3. A terminal route that names a workflow.** `target_kind` discriminates the
union, so those fields do not exist on the other kinds.

---

## `input_mapping`

Per-binding field adapter, applied when the job payload is built:

```ts
input_mapping: { jobId: "payload_ref.requirement_id" }
```

This is what lets one graph answer several events whose payloads name the same
thing differently — the graph never learns which door fired.

Paths are read from the **envelope**, so the payload lives under `payload_ref`.
The spec's §6.4 example writes `payload.requirementId`, which would silently
resolve to nothing; a mapping starting `payload.` is rejected with the
corrected path in the message.

A path that resolves to nothing is left out rather than set to `undefined`, so
the node's own input schema reports it missing — one error, from the contract
that knows what the field is for.

---

## Tenant scoping

`org_id: null` means every tenant. Set it, and that binding **shadows the
global one inside its own routing group** — which is how a canary reaches one
customer without a second routing group existing. Other groups are unaffected.

---

## Errors

```
RoutingError: ROUTING_AMBIGUOUS
  exclusive routing group "requirement.post-intake" has 2 active bindings
  sharing priority 10 (a.workflow, b.workflow). Priorities must be unique
  inside a group.
```

The database enforces one active binding per exclusive group. The resolver
checks anyway and refuses rather than picking, because "silently picked one" is
the exact failure exclusivity exists to prevent.

---

## Not wired yet

This is the first half of the routing work. Still to come:

- the migration adding these columns, dropping `version`, and replacing
  `graph_event_bindings_one_active` with a per-exclusive-group index
- the router calling `resolveRoutes()` and enqueuing **every** returned route
- `input_mapping` applied when the job payload is built

Until then the live router still resolves one binding per event through
`resolveActiveEventBinding()`.