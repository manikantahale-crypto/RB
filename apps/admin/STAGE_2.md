# Stage 2 — Compile

**Canonical source:** [`agent-authoring-admin-design-final.md`](./agent-authoring-admin-design-final.md)  
**Plan index:** [`PLAN.md`](./PLAN.md)  
**Prerequisite:** Stage 1 complete (status `generated`)  
**Transition:** `generated ──Compile──▶ compiled`  
**Owns:** parse + validate artifact into a graph; checksum; version; **does not** publish or activate

The final design **names** Compile and shows its place in the lifecycle, API, and diagrams. Full Compile internals are out of scope of the Stage 1 document and are to be specified in a dedicated Compile design; this file collects **everything the final design already says** about Compile so nothing is missed.

---

## Pipeline position (§1.1 / §6)

```text
Agent List → Policy Editor → Generate → Compile → Publish
└──────────── Stage 1 ────────────┘     ▲
                                        Stage 2
```

```
   draft ──Generate──▶ generated ──Compile──▶ compiled ──Publish──▶ published ──activate──▶ active
                         Stage 1              Stage 2              Stage 3
```

| Status | Meaning | Set by | Stage 2? |
|---|---|---|---|
| `generated` | Artifact rendered; not validated as a graph | Generate (Stage 1) | Input |
| `compiled` | Artifact parsed + validated into a graph, checksummed, versioned | **Compiler** | **Yes — Stage 2 ends here** |
| `published` / `active` | — | Publish / activate | No (Stage 3) |

---

## From §9 — Boundary hand-off

```
   Stage 1                     Stage 2                 Stage 3 / Runtime
   ─────────────────           ────────────            ─────────────────
   writes agent_policies  ──▶  Compile validates  ──▶  Publish activates
   + agent_versions            (generated→compiled)    (→ published → active)
   at status=generated                                 runtime reads published
                                                       graph from graph_definitions
```

Compile never calls the runtime. It writes validated graph material into the shared graph store for Publish (Stage 3) to gate.

---

## From §13.3 — Compiler component diagram

```
   agent.ts ──▶ parse (AST) ──▶ validate ──▶ resolve deps ──▶
                checksum ──▶ graph definition + version (status: compiled)
```

*(Shown for continuity in the final design; not built in Stage 1.)*

---

## From §14 — Entity relationships (Compile produces)

```
 agent_versions
   (artifact at generated)
        │
        │ compile (Stage 2) produces
        ▼
 graph_definitions
   (topology the runtime reads; graph_versions tracks history)
```

Relationships (final design): generating a policy produces an `agent_versions` row; **a later compile stage materialises a `graph_definitions` row** that the runtime reads. `graph_versions` mirrors `agent_versions` on the graph side. Runtime doc’s `graph_definitions` schema is authoritative for its columns.

---

## From §15 — API

| Method + path | Stage | Purpose |
|---|---|---|
| `POST /agents/:id/compile` | **2 (later in Stage 1 doc)** | Parse + validate artifact into a graph (`generated → compiled`). |

Request/response contract for Compile is **out of scope of the Stage 1 document** — to be specified in the Compile design. Auth still: admin-authenticated, per-agent entitlement (A3); RLS by `org_id`.

---

## From §4.3 / A4 — Schema continuity

The **same** `AgentPolicySchema` (base + agent `policyExt`) that validated at Save and Generate must also validate at **Compile** — no drift between consumers (Appendix A invariant 8 / decision A4).

Compile additionally validates the **emitted graph** against `GraphDefinitionSchema` (same schema the runtime uses — A5).

---

## From §5 / §5A — What Compile receives

- Artifact produced by the schema-driven generator: graph-shaped definition referencing **only registered node keys**.
- Checksum on `agent_versions` / policy row — Compile should verify the artifact matches what policy+template emitted (audit: “what was generated for this agent on this date” — §7 rationale).

---

## From §6 / Appendix A — Invariants that bind Compile

5. Statuses one-directional within a version; change after `generated` / `compiled` is a **new version**, not in-place edit.  
6. At most one `active` per `(agent_id, scope)` — Compile must not activate.  
8. Shared Zod policy schema at Compile.  
9. Still no direct calls to the runtime — store only.

---

## Stage 2 deliverable checklist (from final design text)

- [x] `POST /agents/:id/compile` (contract in [`COMPILE_DESIGN.md`](./COMPILE_DESIGN.md))
- [x] Parse + validate artifact (§13.3)
- [x] Resolve deps; checksum; write `graph_definitions` (+ `graph_versions` as designed)
- [x] Status `generated → compiled` only
- [x] Re-validate policy with same schema (A4); validate graph with `GraphDefinitionSchema` (A5)
- [x] Verify artifact checksum vs Stage 1 generation
- [x] Entitlement (A3) + RLS
- [x] Dedicated Compile design doc for internals (`COMPILE_DESIGN.md`)

**Not Stage 2:** Publish, activate, runtime execution.
