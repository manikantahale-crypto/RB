---
name: orchestration-backbone
description: >-
  Enforces the Hiring Assistant orchestrator design as a plug-and-play
  backbone independent of Syntra: graph_definitions + GraphCompiler +
  node registry + event_outbox, version pinning, RLS, error classes.
  Use when editing orchaestration code, workflows, LangGraph compiler,
  dispatcher, outbox, graph_definitions, agents, or skills.md — and on
  any request to add modules, ingress, or Syntra integration.
---

# Orchestration Backbone

## First actions

1. `git branch --show-current` and `pwd` inside the `orchaestration` repo.
2. Expect `feature/syntra-orch-worker` and a path ending in `\orchaestration`.
   Mismatch → STOP and report.
3. **Read and follow** the project manual: [skills.md](../../../skills.md)
   at `orchaestration/skills.md`. That file is authoritative.

## Non-negotiables

- This orchestrator is a **backbone**: behavior in git (node registry), wiring
  in DB (`graph_definitions`), compile at runtime (`GraphCompiler`), dispatch
  via `event_outbox` → relay → `orchestration.dispatch`.
- **Independent of Syntra.** Syntra is one optional peer behind node adapters
  (`workflow/nodes/syntra.ts` + `SYNTRA_API_URL`). Do not bake Syntra into
  compiler, resolver, or runner core.
- **Do not rebuild** proven pieces unless explicitly asked:
  `DBRunbookResolver`, `GraphCompiler`, `dispatcher.worker.ts`,
  `syntra.ts` nodes, seeded graphs.
- **Do not create** duplicate upload/product APIs that reimplement Syntra
  unless the user explicitly chooses orchestrator-owned outbox-only ingress.
- Topology change = **new graph version + promote**, never UPDATE active
  definition rows. Cache compiled graphs by **checksum**; pin
  `(graph_key, graph_version)` at **enqueue**.

## Compiler / workflow rule

Compiled LangGraphs are **not** stored in the DB. On cache miss (new
checksum or cold process), compile once and cache. Recompiling when
definitions change is correct; compiling a single global graph that ignores
pins is not.

## After architecture changes

Update `orchaestration/skills.md` in the same change set so the next session
inherits the new rule.
