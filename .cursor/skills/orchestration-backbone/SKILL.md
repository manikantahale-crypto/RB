---
name: orchestration-backbone
description: >-
  Enforces the Hiring Assistant orchestrator design as a plug-and-play
  backbone independent of Syntra: graph_definitions + GraphCompiler +
  node registry + transactional event_outbox + relay, version pinning,
  RLS, error classes. Use when editing orchestrator code, workflows,
  LangGraph compiler, dispatcher, outbox, ingress, Syntra event publishing,
  bridge, or grants.
---

# Orchestration Backbone

## First actions

1. `git branch --show-current` and `pwd`. Confirm you are in the repository
   and on the branch you intend to change — do not trust prior chat reports.
2. This file deliberately does NOT name an expected branch. The version before
   it did, and the branch it named had not existed for weeks; the check passed
   by being ignored. Confirm the branch against the task, not against a
   hardcoded name.
3. Read [BRIDGE.md](../../../BRIDGE.md) when touching ingress or Syntra
   integration, and [UNIFIED_STACK.md](../../../UNIFIED_STACK.md) for how the
   services fit together.
4. Read [docs/adr/](../../../docs/adr/) before re-proposing a settled decision —
   the node contract shape, the composed node registry, and routing fan-out
   each have a written record there.

## Non-negotiables

- This orchestrator is a **backbone**: behavior in git (node registry), wiring
  in DB (`graph_definitions`), compile at runtime (`GraphCompiler`).
- **Ingress = transactional outbox only.**
  `POST /v1/events` → `event_outbox` (`published_at IS NULL`) → **outbox-relay**
  is the **only** pg-boss publisher (graph → `orchestration.ingress`, else
  `orchestration.dispatch`). Never enqueue pg-boss inside `acceptPlatformEvent`.
- **Independent of Syntra.** Syntra is an optional peer:
  - Product domain: `syntra.*` tables + Syntra HTTP. The nine `syntra.*` nodes
    now run from contracts in `adapters/syntra/nodes/`, composed by the worker;
    the engine's `nodes/syntra.ts` is still there and is overridden, not deleted.
  - Platform events: **two paths exist, and both end in `event_outbox`.**
    SYNTRA's own events are written to the table DIRECTLY
    (`node-api/src/repositories/outbox.repository.js`), gated by
    `PLATFORM_EVENTS_ENABLED`. ORBIT and recruiter-review POST to
    `ORCH_API_URL` (`/v1/events`) instead. An earlier version of this file
    claimed the POST was the only path; it is not.
- **Bridge removed** — no `jd.uploaded` dual consumers. See BRIDGE.md, which
  documents the HTTP path only and still needs the direct-write path added.
- **Do not rebuild** proven pieces unless explicitly asked.
- Topology change = **new graph version + promote**, never UPDATE active rows.
  Cache compiled graphs by **checksum**; pin `(graph_key, graph_version)` at
  enqueue (router / relay).

## Where data lives (do not confuse)

| Concern | Store |
|---------|--------|
| Uploaded JD/resume | `syntra.jobs` / `syntra.resumes` (Syntra) |
| Platform event trail | `event_outbox` |
| Event type registry | `event_schemas` |
| Graph recipes (runtime) | `graph_definitions` |
| Event → graph routing | `graph_event_bindings` |
| Authoring policy + artifacts | `agent_policies`, `agent_versions` |
| Agent catalog | `agent_definitions`, `agent_templates` |
| Run audit (works today) | `orch.runs` / `orch.steps` |
| Design audit (needs GRANT) | `agent_runs` / `agent_steps` |
| Queue jobs | `pgboss.*` |
| Resume state | LangGraph checkpoints |

Admin **writes** authoring tables + go-live materializes runtime tables. Worker
**reads** `graph_event_bindings` + `graph_definitions` only at event time.

`syntra.ts` is **not** ingress — HTTP peer inside a running graph.

## Permissions (operator action)

If migrator lacks rights, run as **postgres**:

- `packages/db/scripts/grant-orch-runtime.sql` (worker, relay, ingress)
- `packages/db/scripts/grant-admin-builder.sql` (admin go-live)

**Neither file is in the repository.** `packages/db/scripts/` is excluded by
`.gitignore` and holds nothing tracked, so these two are on somebody's laptop.
Find them and commit them, or write the grants down here — right now this
section describes a step nobody else can perform.

(orch grants also mirrored in `R__orch_runtime_grants.sql`, which has never been
applied — no migration runner has ever run against this database.)

## Compiler / workflow rule

Compiled LangGraphs are **not** stored in the DB. On cache miss, compile once
and cache. Never compile a single global graph that ignores pins.

## After architecture changes

Update this file in the same change set. It is the only copy — the root
`skills.md` it used to point at was removed, because it named a branch and a
laptop path that no longer existed and had drifted out of agreement with this
file.
