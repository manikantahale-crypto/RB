## Ticket

<!-- T-0NN — one ticket per PR. Always. -->

## What

<!-- One or two sentences. What changed. -->

## Why

<!-- Why this way. For a node PR, say in one sentence why this side-effect
     class and this idempotency strategy. -->

## Evidence

<!-- Paste it. A passing check, a node test, a routed event, migrate output.
     "It works" is not evidence. -->

---

## Anti-requirement checklist

The spec spends two sections on ideas it deliberately rejected. Tick each.

- [ ] No business logic in a node — a peer node is an empty shell around one call
- [ ] No thresholds or field inspection in a routing entry; decisions inside a
      running process are branches in the graph
- [ ] No module calling another module directly, ever
- [ ] Events are facts in the past tense, never commands with a destination in the name
- [ ] No LLM anywhere on the routing path
- [ ] Writing nodes declare an idempotency strategy — the node boundary is the retry boundary
- [ ] External or financial nodes carry a written justification and are never added by generation
- [ ] No new hand-maintained metadata — if it can be derived, derive it
- [ ] No parallel identity table; the requirement id is the jobs row id everywhere
- [ ] Nothing edits an active version in place
- [ ] No cross-zone import added (`modules/` → `orchestrator/`, or engine → adapters)
