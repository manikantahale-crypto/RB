# Stage 3 — Publish (+ activate)

**Canonical source:** [`agent-authoring-admin-design-final.md`](./agent-authoring-admin-design-final.md)  
**Prerequisite:** Stage 2 complete (status `compiled`)  
**Transitions:** `compiled ──Publish──▶ published ──activate──▶ active`  
**Owns:** review-gate publish; activate so runtime can resolve the graph; rollback

The final design **names** Publish and activate and places them in the lifecycle, boundary, and API table. Full Publish internals are out of scope of the Stage 1 document; this file collects **everything the final design already says** about Publish / activate / rollback so nothing is missed.

---

## Pipeline position (§1.1 / §6)

```text
Agent List → Policy Editor → Generate → Compile → Publish
└──────────── Stage 1 ────────────┘     Stage 2    ▲
                                                   Stage 3
```

```
   draft ──Generate──▶ generated ──Compile──▶ compiled ──Publish──▶ published ──activate──▶ active
                         Stage 1              Stage 2              └──────── Stage 3 ────────┘
                                                                                      runtime reads
```

| Status | Meaning | Set by | Stage 3? |
|---|---|---|---|
| `compiled` | Artifact parsed + validated into a graph | Compiler (Stage 2) | Input |
| `published` | Reviewed and marked ready | **Publish** | **Yes** |
| `active` | Live; runtime router resolves events to it | **activate** | **Yes** (runtime reads) |

---

## From §9 — Boundary hand-off

```
   Stage 1                     Later stages              Runtime (built)
   ─────────────────           ────────────              ───────────────
   writes agent_policies  ──▶  Compile validates    ──▶  router resolves a
   + agent_versions            Publish activates          *published* graph
   at status=generated         (status → active)          from graph_definitions
```

Publish / activate is the last authoring gate before the **already-built** runtime may execute the graph. Stage 3 still does not call the runtime process — it writes status / active flags into the shared store; the runtime **reads**.

---

## From §6 — Rationale (applies through Publish)

Each transition is a review gate. Distance from “admin changed a form” (`draft`) to “live in production” (`active`) is three deliberate, separately-owned steps (Generate → Compile → Publish/activate). No single Stage 1 action can reach the runtime.

Statuses are one-directional within a version; a change after `generated` (and after publish) is a **new version**, never an in-place edit — same immutability reason the runtime pins `(graphKey, version)`.

---

## From §7 — One-active invariant

```sql
CREATE UNIQUE INDEX agent_policies_one_active
  ON agent_policies (agent_id, COALESCE(org_id,'~global~'))
  WHERE status = 'active';
```

**At most one `active` version per `(agent_id, scope)`** — enforced at DB level (Appendix A invariant 6). Activate must uphold this (flip previous active off / insert new active in one transaction as designed for graphs).

`org_id IS NULL` = global default; org override else global — same two-level resolution as runtime.

---

## From §14 — What Publish makes live

```
 graph_definitions
   (topology the runtime reads; graph_versions tracks history)
```

Runtime router resolves a **published** / **active** graph from `graph_definitions`. Stage 3 is what makes a compiled definition eligible for that read.

---

## From §15 — API

| Method + path | Stage | Purpose |
|---|---|---|
| `POST /agents/:id/publish` | **3 (later in Stage 1 doc)** | Review-gate and publish (`compiled → published`). |
| `POST /agents/:id/rollback` | **3 (later)** | Revert the active version to a prior published one. |

Request/response contracts for Publish / rollback are **out of scope of the Stage 1 document** — to be specified in the Publish design. Auth: admin-authenticated, per-agent entitlement (A3); RLS by `org_id`.

**Activate** is named in the lifecycle (`published ──activate──▶ active`) as the step after which “the runtime router resolves events to it.” Whether activate is a separate route or part of publish is left to the Publish design; the final design requires the **active** status and the one-active index.

---

## From §8.1 — List UI (consumes Stage 3 outcomes)

Agent List shows **current active version** (read-only) and last-generated metadata. Stage 3 is what populates “active” for that column.

---

## From §17 — Open questions that may affect Stage 3

2. Generate overwrite vs new version alongside published — affects how Publish/rollback treat version history.  
6. Audit trail depth — `agent_versions` vs separate immutable audit log (compliance), relevant when publishing/activating.

---

## From Appendix A — Invariants that bind Publish / activate

5. One-directional status within a version; edits after publish → new version.  
6. At most one `active` per `(agent_id, scope)`.  
7. RLS + per-agent entitlement on all writes.  
9. Authoring and runtime share only the graph store; neither calls the other (activate = data write, not an RPC into the worker).

---

## Stage 3 deliverable checklist (from final design text)

- [x] `POST /agents/:id/publish` (`compiled → published`) — contract in [`PUBLISH_DESIGN.md`](./PUBLISH_DESIGN.md)
- [x] Activate path (`POST /agents/:id/activate`, `published → active`) — **per `graph_key` only** (never retire runtime `*.workflow` keys); see Publish design Decision #1
- [x] `POST /agents/:id/rollback` to a prior published version (same authored `graph_key` only)
- [x] Entitlement (A3) + RLS — `withOrgScope` + `canEditAgent` on publish / activate / rollback (403 if no grant)
- [x] Agent List reflects active version (§8.1) — `GET /agents` returns `activeVersion` + `lastGenerated`; List UI columns updated
- [x] Dedicated Publish design doc for internals ([`PUBLISH_DESIGN.md`](./PUBLISH_DESIGN.md)) — includes one-active scoping + authored≠runtime node registry gate
- [x] Resolve open questions 2 / 6 as they affect publish history and audit (working stance in Publish design)

**Safety constraint (Stage 3):** Activate/rollback operate only inside the authored keyspace (e.g. `syntra.authored`). Pointing the runtime router at an authored key is a separate shared decision with the runtime owner.

**Not Stage 3:** implementing the orchestrator (§10) — already built; see [`RUNTIME.md`](./RUNTIME.md).
