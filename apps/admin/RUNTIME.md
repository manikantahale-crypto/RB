# Runtime companion (already built — not an authoring stage)

**Canonical source:** [`agent-authoring-admin-design-final.md`](./agent-authoring-admin-design-final.md) §10, §11 (runtime column), §12.2  
**Plan index:** [`PLAN.md`](./PLAN.md)

This is **not** Stage 1 / 2 / 3 work. The final design includes it so the whole loop is legible. Authoring stages **write** to the graph store; this runtime **reads** published/active graphs and executes them.

---

## Separation (§11)

| | Design-Time (Stages 1–3) | Runtime (Phase 1, built) |
|---|---|---|
| Trigger | Admin edits / Generate / Compile / Publish | Producer emits a domain event |
| Primary action | Creates versions and artifacts | Executes a compiled graph |
| Graph store | **Writes** | **Reads** a published definition |
| Execution | None until after activate | Only execution |
| Who acts | Human admin | System, autonomously |

**design-time writes and never executes; runtime executes and never authors.** Same product (e.g. SYNTRA) on both sides; graph store is the meeting point.

---

## Event-chaining loop (§10)

Agents do not call each other directly. Completion → domain event → outbox → relay → router → next agent’s workflow. Orchestrator coordinates; no point-to-point agent calls.

```
 Event producers (Syntra, ATS, website, CRM, …)
        │  emit a domain event
        ▼
 ┌──────────────┐   validate envelope (Zod), write to event_outbox
 │   INGRESS    │   (built: Syntra may publish directly to module queues — bridge)
 └──────┬───────┘
        ▼
 ┌──────────────┐   (event.type, org) → graph_key
 │   ROUTER     │   resolve version, route to module queue
 └──────┬───────┘
        ▼
 ┌──────────────┐   resolve pinned graph → compile/get → invoke → checkpoint
 │   WORKER     │
 └──────┬───────┘
        ▼
 ┌──────────────┐   node bodies (built: Syntra HTTP bridge; target: in-process)
 │  EXECUTE     │
 └──────┬───────┘
        ▼
 ┌──────────────┐   follow-on events → event_outbox
 │   OUTBOX     │
 └──────┬───────┘
        ▼
 ┌──────────────┐   syntra_relay → orchestration.dispatch
 │    RELAY     │
 └──────────────┘
```

Details in final design §10: Router, version pinning (design D3 vs built consume-time pin), graph loading, Worker + LangGraph, tool execution, outbox + relay.

---

## §12.2 Runtime execution sequence

```
Producer   Ingress/Queue   Router     Worker      Node/Tool    Outbox   Relay
   │            │            │           │             │          │        │
   │─event─────▶│            │           │             │          │        │
   │            │─enqueue───▶│           │             │          │        │
   │            │            │─route────▶│             │          │        │
   │            │            │           │─resolve ver.│          │        │
   │            │            │           │─compile+get─│          │        │
   │            │            │           │─invoke─────▶│          │        │
   │            │            │           │             │─call ────│        │
   │            │            │           │◀ state patch│          │        │
   │            │            │           │─emit events──────────▶│        │
   │            │            │           │  (checkpoint each node)│        │
   │            │            │           │             │          │◀ read ─│
   │            │            │           │             │          │─publish▶ dispatch
```

---

## Implication for authoring stages

Stages 1–3 must leave artifacts such that, once `active`, this runtime can `compiler.get` them from `graph_definitions` without any callback into `apps/admin` / `apps/admin-api`.
