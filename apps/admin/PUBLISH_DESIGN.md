# Publish Internals Design (Stage 3)

**Canonical source:** `STAGE_3.md` + `agent-authoring-admin-design-final.md`  
**Prerequisite:** Stage 2 complete (`compiled`)  
**Boundary:** Publish / activate / rollback are **store writes only**. They never call the runtime worker. Making an authored graph serve live traffic is a **separate router decision** with the runtime owner — not part of Stage 3 alone.

---

## Decision #1 (load-bearing) — one-active scope is per `graph_key`

### The question

When Activate retires “previous active,” does that mean:

- **A)** previous active under the **same `graph_key`** (e.g. only among `syntra.authored` versions), or  
- **B)** previous active for this **agent** across keys (which would touch `syntra.jd.workflow`, etc.)?

### The answer (recorded here)

**A — per `graph_key` (+ org scope).**

Rationale:

1. Runtime live graphs already use different keys:
   - `syntra.jd.workflow` (active)
   - `syntra.match.workflow` (active)
   - `syntra.resume.workflow` (active)
2. Stage 1/2 authored material uses:
   - `syntra.authored` (draft today; never active yet)
3. The DB already encodes per-key one-active:

```sql
CREATE UNIQUE INDEX graph_definitions_one_active
  ON graph_definitions (graph_key, COALESCE(org_id, '~global~'))
  WHERE status = 'active';
```

So activating `syntra.authored` **cannot**, by construction of that index, retire `syntra.jd.workflow`.

### Hard rule for Stage 3 code

Activate / rollback **must**:

- only flip status among rows that share the **same `graph_key`** (the authored key for that agent template), and  
- **never** `UPDATE` / retire rows whose `graph_key` is a runtime seed key (`*.workflow`, etc.).

`agent_policies` one-active remains per `(agent_id, org scope)` as already designed — that is the **authoring** “which policy version is live for this agent,” not a signal to kill runtime graph keys.

---

## Decision #2 — Activate ≠ go-live for production traffic

Even after an authored row is `active` under `syntra.authored`:

- the runtime still resolves events to whatever key the **router / runbook** points at (today: `syntra.jd.workflow`, etc.);
- pointing the router at `syntra.authored` is a **shared decision** with the runtime owner;
- Stage 3 builds the **mechanism** (publish / activate / rollback) inside the authored keyspace only.

---

## Gate before trusting Activate as “runnable”

Authoring `TOOL_REGISTRY` and runtime `nodeRegistry` are **not the same set**.

| Layer | Example keys |
|-------|----------------|
| Authoring (`packages/authoring` TOOL_REGISTRY) | `parse_jd`, `hard_filter`, `normalize_skills`, … |
| Runtime (`packages/orchestrator` nodeRegistry) | `syntra.jd.process`, `syntra.match.process`, `syntra.resume.process`, … |

Compile (Stage 2) checks `isRegisteredTool` (authoring registry).  
Runtime hydrate checks `node.impl in nodeRegistry`.

**Consequence:** an authored `syntra.authored` graph can be valid for Stage 2 and still be **non-runnable** if the router ever pointed at it today. Stage 3 Activate under `syntra.authored` is therefore **safe for the store**, but **not** a claim that the graph can execute.

Activate may run as a status flip among authored keys. Declaring the graph production-runnable requires a later bridge (map authoring tools → runtime nodes, or register node factories) — **out of Stage 3 solo scope**.

---

## Lifecycle

```text
compiled ──Publish──▶ published ──Activate──▶ active
                              ▲
                              └── Rollback (to a prior published version under the same graph_key)
```

| Status | Meaning | Touches runtime keys? |
|--------|---------|------------------------|
| `published` | Reviewed; ready but not the active authored version | No |
| `active` (authored key) | Current active **among that `graph_key`** | No (does not retire `*.workflow`) |
| Runtime traffic | Router points at a key | Separate decision |

---

## API (Stage 3)

### `POST /agents/:id/publish` — build now (safe)

**Input:** latest (or `expectedVersion`) **compiled** artifact for this agent+scope.  
**Effect:**

- `agent_policies` / `agent_versions`: `compiled → published`
- matching `graph_definitions` row (same `graph_key` + version): stay or mark ready for activate — **do not set `active`**
- optional: `graph_versions` history note

**Does not:** activate, retire any other key, call the worker.

Auth: entitlement + RLS (`withOrgScope` + `canEditAgent`), same as Compile.

### Activate — `POST /agents/:id/activate` (authored key only)

**Effect (same transaction):**

1. Require latest **published** artifact for this agent+scope.
2. Parse `graphKey` from the artifact; **refuse** unless it equals `{agentKey}.authored` (never `*.workflow`).
3. Set any other `active` row with the **same `graph_key` + org scope** to `retired`.
4. Set target `graph_definitions` row to `active`, set `activated_at`.
5. Mirror on authoring side: previous `active` policy for `(agent_id, scope)` → `published`; this version → `active`.
6. Set matching `agent_versions` / `graph_versions` to `active`.

**Forbidden:** any query that retires by agent alone across `graph_key`s, or that targets `syntra.jd.workflow` / `syntra.match.workflow` / `syntra.resume.workflow`.

### `POST /agents/:id/rollback` — same scoping

**Body:** `{ targetVersion: number }` (required)

Revert `active` to a **prior published** (or currently active) version under the **same authored `graph_key`**.

Effect (same transaction):

1. Load target `agent_versions` at `targetVersion` with status `published` or `active`.
2. Refuse unless artifact `graphKey === {agentKey}.authored`.
3. Retire other `active` `graph_definitions` rows for that **same** `graph_key` only.
4. Set target `graph_definitions` → `active`.
5. Demote other active `agent_policies` / `agent_versions` for this agent+scope → `published`; set target → `active`.
6. Mirror on `graph_versions` under the same authored key.

Never touch runtime seed keys.

---

## What Stage 3 builds vs what it does not

| Build in Stage 3 | Do **not** build solo |
|------------------|------------------------|
| Publish design (this doc) | Router remapping to `syntra.authored` |
| `POST /publish` | Retiring / replacing `syntra.*.workflow` |
| Activate / rollback **within authored `graph_key`** | Claiming authored graphs are production-runnable without node bridge |
| List UI “active version” for authored policy | |

---

## Open questions (from STAGE_3 §17) — working stance

2. **Generate overwrite vs new version:** keep **new version** after publish (one-directional statuses). Rollback picks an older published version under the same key.  
6. **Audit depth:** `agent_versions` + `graph_versions` are enough for Stage 3; separate immutable audit log deferred.

---

## Build order (safe)

1. **This doc** — one-active = per `graph_key` (done).  
2. **`POST /publish`** — status only; verify.  
3. **Activate / rollback** — authored keyspace only; verify they never change `syntra.*.workflow`.  
4. List UI active column.  
5. Router / runnable-node bridge — **with runtime owner**, later.
