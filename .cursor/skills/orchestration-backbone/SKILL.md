---
name: orchestration-backbone
description: >-
  Enforces the Hiring Assistant orchestrator design as a plug-and-play
  backbone independent of Syntra: graph_definitions + GraphCompiler +
  node registry + transactional event_outbox + relay, version pinning,
  RLS, error classes. Use when editing orchaestration code, workflows,
  LangGraph compiler, dispatcher, outbox, ingress, Syntra ORCH_API_URL
  publish, bridge, grants, or skills.md.
---

# Orchestration Backbone

## First actions

1. `git branch --show-current` and `pwd` inside the `orchaestration` repo.
2. Expect `feature/syntra-orch-worker` and a path ending in `\orchaestration`.
   Mismatch → STOP and report.
3. **Read and follow** the project manual: [skills.md](../../../skills.md)
   at `orchaestration/skills.md`. That file is authoritative.
4. Also read [FRONT_DOOR.md](../../../FRONT_DOOR.md) and [BRIDGE.md](../../../BRIDGE.md)
   when touching ingress or Syntra integration.

## Non-negotiables

- This orchestrator is a **backbone**: behavior in git (node registry), wiring
  in DB (`graph_definitions`), compile at runtime (`GraphCompiler`).
- **Ingress = transactional outbox only.**
  `POST /v1/events` → `event_outbox` (`published_at IS NULL`) → **outbox-relay**
  is the **only** pg-boss publisher (graph → `orchestration.ingress`, else
  `orchestration.dispatch`). Never enqueue pg-boss inside `acceptPlatformEvent`.
- **Independent of Syntra.** Syntra is an optional peer:
  - Product domain: `syntra.*` tables + Syntra HTTP (`nodes/syntra.ts`)
  - Platform events: Syntra sets `ORCH_API_URL` and POSTs envelopes (not bridge)
- **Bridge removed** — Syntra must use `ORCH_API_URL` → `POST /v1/events` (no `jd.uploaded` dual consumers)
  dual-consumer debugging only — see BRIDGE.md.
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
| Graph recipes | `graph_definitions` |
| Agent policy contracts | `agent_definitions` |
| Run audit (works today) | `orch.runs` / `orch.steps` |
| Design audit (needs GRANT) | `agent_runs` / `agent_steps` |
| Queue jobs | `pgboss.*` |
| Resume state | LangGraph checkpoints |

`syntra.ts` is **not** ingress — HTTP peer inside a running graph.

## Permissions (operator action)

If migrator lacks rights, run as **postgres**:

`packages/db/scripts/grant-orch-runtime.sql`

(also mirrored in `R__orch_runtime_grants.sql`). Seeds `syntra.match.requested`.

## Compiler / workflow rule

Compiled LangGraphs are **not** stored in the DB. On cache miss, compile once
and cache. Never compile a single global graph that ignores pins.

## After architecture changes

Update `orchaestration/skills.md` **and this SKILL.md** in the same change set.
