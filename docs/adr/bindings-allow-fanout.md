# Bindings allow fan-out

**Status:** accepted — contract and resolver landed; migration and router still to come
**Date:** 2026-08-21

---

## The problem

Today one event can start exactly one workflow. Not by design — by an index:

```sql
CREATE UNIQUE INDEX graph_event_bindings_one_active
  ON graph_event_bindings (event_type, COALESCE(org_id::text, '~global~'))
  WHERE status = 'active'
```

One active binding per event per tenant. `resolveActiveEventBinding()` reads
`LIMIT 1`, the router enqueues one job, and that is the end of it.

That makes spec §6.4's `mode: "fanout"` **structurally impossible**, and with it
the promise in §2 that a new module plugs in "with zero changes to existing
modules". If ORBIT wants to answer `astra.requirement.published`, which SYNTRA
already answers, today the only options are to replace SYNTRA's binding or to
change SYNTRA's graph. Both are exactly the coupling the architecture exists to
prevent.

## Decision

Bindings become a group of rules per event, not a single row.

- A **routing group** is the set of bindings answering one event for one purpose.
- `mode: "exclusive"` — one binding in the group fires. Silent duplicate work is
  the failure this closes.
- `mode: "fanout"` — every matching binding fires. Two modules answering the
  same fact independently is normal.
- The one-active index is replaced by one enforcing a single active binding per
  **exclusive routing group**, so exclusivity is still structural, just scoped
  correctly.

## What landed in this half

`packages/routing-contract` — the §6.4 entry as Zod, plus `resolveRoutes()` as a
pure function with no database, no network, no clock. Given the same event,
entitlements and table it returns the same routes forever, which is what makes
routing simulation possible at all: CI commits an expected outcome
and fails the PR when a change alters it.

41 tests. The migration, the index swap, and the router rewiring are the second
half of the routing work.

## Rules the schema makes unrepresentable

**A binding cannot carry a version.** There is no `version` field, and a
`workflow_key` containing `@` is rejected. Bindings hold keys; the active
version is resolved at routing time and pinned onto the run. A version on a
binding would let it outlive the promotion that replaced it.

**Conditions cannot express business logic.** `conditions` is a `strictObject`
whose only key is `requires_entitlement`. Writing `{ minScore: 0.8 }` is a
parse error, not a code review conversation. "Which process starts for this
fact" is routing; "a decision inside a running process" is a branch in the
graph. Mixing them puts judgement on the routing path.

**A terminal route cannot name a workflow.** `target_kind` discriminates the
union, so `workflow_key` and `module_queue` exist only on a graph target.

## Decisions inside the resolver

**Lower priority number wins.** Inside an exclusive group the lowest fires;
inside a fanout group it only fixes the order, so results are stable rather than
dependent on the order rows came back. CI enforces unique priorities per group.

**Ambiguity throws rather than picks.** The new index means an exclusive group
can only hold one active binding. The resolver still checks, and if two ever
arrive sharing a priority it raises `ROUTING_AMBIGUOUS` instead of choosing.
"Silently chose one" is precisely the failure exclusivity exists to prevent, so
the pure function refuses to be the place it happens.

**A tenant binding shadows the global one, within its group.** Otherwise a
canary tenant would run both the canary and the default. Shadowing is scoped to
the group, so an override in one group leaves the others alone.

**A mapped path that resolves to nothing is omitted, not set to `undefined`.**
The node's own input schema then reports it missing — one error, from the
contract that knows what the field is for.

## An inconsistency in the spec, and what we did

§6.4's example writes `"input_mapping": {"jobId": "payload.requirementId"}`, but
§6.3 lists the envelope field as `payload_ref`, and the code agrees. Left alone
that mapping resolves to `undefined` silently.

Paths are read from the envelope, so `payload_ref.requirement_id` is correct. A
mapping beginning `payload.` is rejected with a message naming the corrected
path, because it is a mistake people will make from reading the spec.

## Open, for the second half of the routing work

**Does `org_id` stay on a binding?** §6.4's sketch has no `org_id`, but the
existing table has the column, the ticket does not say to drop it, and tenant
canaries need some way to be expressed. It is kept, and the resolver gives it
shadowing semantics. If §6.4 is meant to be exhaustive, this is the field to
argue about — before the migration, not after.

**`module_queue` likewise.** Not in §6.4's sketch, but the running router needs
to know which queue to enqueue onto. Kept on graph targets only.

**What `hasModule` reads** is unresolved. `resolveRoutes()` takes
entitlements as a plain string array, so it does not care where they come from —
which is the point of it being pure.