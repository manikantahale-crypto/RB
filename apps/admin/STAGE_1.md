# Stage 1 — What we build

**Plan we follow:** [`agent-authoring-admin-design-final.md`](./agent-authoring-admin-design-final.md)  
**Status:** [`STATUS.md`](./STATUS.md)

**Pipeline:** Agent List → Policy Editor → Generate → **`generated`**  
**Constraint:** *nothing executes* (no compile / publish / activate / run).

---

## What’s in Stage 1

| Piece | What it is |
|-------|------------|
| **Agent List** | Table of product-agents (SYNTRA, …); Edit/Generate only if entitled |
| **Policy Editor** | Schema-driven form: shared base + per-agent `policyExt` from template |
| **Save** | `PUT /agents/:id/policy` → `agent_policies` status `draft` |
| **Generate** | `POST /agents/:id/generate` → validate → `(policy, template) → artifact` → `generated` |
| **Templates (A6)** | Per-agent data: nodes, wiring, `policyExt` — drives the **one** generic generator |
| **Entitlement + RLS** | Per-agent edit rights; org-scoped reads/writes |

**Not Stage 1:** Compile, Publish, activate, writing live `graph_definitions` for the runtime.

---

## Tables

### Already exist (reuse — do not recreate)

| Table | Role in Stage 1 |
|-------|-----------------|
| **`agent_definitions`** | The ~12 product-agents (list + FK target). Seeded by runtime. |
| **`organizations`** | Org scope for `org_id` (NULL = global). |

### Stage 1 must have (authoring)

| Table | Role | Status today |
|-------|------|----------------|
| **`agent_policies`** | Policy JSONB per agent/org/version; status `draft`→`generated` | ✅ V12 exists |
| **`agent_versions`** | Generated artifact (`artifact_ref` + source/blob), checksum, who/when | ✅ V12 exists |

### Stage 1 templates (final design A6)

| Table | Role | Status |
|-------|------|--------|
| **`agent_templates`** | Per-`agentKey` template JSON: `policyExt`, nodes, wiring, `conditionalOn` | ✅ V13 + boot seed (syntra, intake, copilot) |

### Exists but Stage 1 does **not** write (later stages)

| Table | When |
|-------|------|
| **`graph_definitions`** | Stage 2 Compile materialises topology the runtime reads |
| **`graph_versions`** | Stage 2/3 history (named in design) |

---

## Minimal ER (Stage 1)

```text
organizations          agent_definitions
      │                        │
      │ org_id (nullable)      │ agent_id
      ▼                        ▼
           agent_policies  ──1──N──▶  agent_versions
                ▲                         (artifact on Generate)
                │
           agent_templates
           (by agentKey / agent_id — drives form + generator)
```

---

## APIs (Stage 1 only)

| Method | Path |
|--------|------|
| `GET` | `/agents` |
| `GET` | `/agents/:id` |
| `PUT` | `/agents/:id/policy` |
| `POST` | `/agents/:id/generate` |

---

## Implementation order (final design)

1. Confirm / align `agent_policies` + `agent_versions` with §7 — ✅  
2. Add **`agent_templates`** (+ seed SYNTRA first) — ✅ (syntra, intake, copilot)  
3. Zod: `AgentPolicyBase` + per-agent `policyExt` from template — ✅  
4. Schema-driven generator `(policy, template) → artifact` — ✅ `generateGraphFromTemplate` → graph JSON  
5. Wire API + SPA to templates — ✅ Save/Generate validate via template `policyExt`; **Policy Editor renders base + ext from field descriptors** (`baseFields` / `policyExtFields`); Generate stores `graph.json`  
6. Entitlement + RLS — ✅ `admin_agent_entitlements` (fail-closed); RLS on policies/versions; `withOrgScope` sets `app.org_id`  
7. Tests (§16) — ✅ generator + policy schema unit; Generate API + access-control integration (live DB)
