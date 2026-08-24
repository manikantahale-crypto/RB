# Stage 1 — Complete Audit

**Date:** 2026-08-11  
**Status:** Stage 1 done (Generate ends at `generated`)  
**Design we follow:** [`agent-authoring-admin-design-final.md`](./agent-authoring-admin-design-final.md)  
**Short plan:** [`STAGE_1.md`](./STAGE_1.md) · [`STATUS.md`](./STATUS.md)

This file explains Stage 1 in plain English: what we built, which files do what, what goes in, what comes out, and which gates stop bad work.

---

## 1. What Stage 1 is (one sentence)

An admin picks an agent, edits its **policy** (settings, not code), clicks **Generate**, and the system writes a **reviewable graph JSON** into the database at status **`generated`** — and **nothing runs**.

```text
Agent List → Policy Editor → Save (draft) → Generate → status = generated
```

**Not Stage 1:** Compile, Publish, activate, or writing live rows into `graph_definitions` for the worker. Those are Stage 2 / 3.

---

## 2. The big idea (why this shape)

| Idea | Meaning |
|------|---------|
| Policy is **data** | Admin edits JSON-like settings in a form |
| Behaviour is **code** | Real node/tool implementations live in the registry (git) |
| Template is **data** | Per-agent recipe: which nodes, how they wire, which extra fields |
| One **generator** | Same engine for every agent: `(policy, template) → graph` |
| Stage 1 stops early | Ends at `generated` so nothing can go live from one click |

---

## 3. End-to-end flow (what happens when you click)

### 3.1 You open the UI

| Step | Where | What happens |
|------|--------|----------------|
| 1 | Browser `http://localhost:5173` | SPA (`apps/admin`) |
| 2 | Agent List | Calls `GET /api/agents` → admin-api `:4200` |
| 3 | List shows agents | From DB table `agent_definitions` (seeded by runtime) |
| 4 | Edit only if entitled | `canEdit` from `admin_agent_entitlements` |

### 3.2 You edit policy

| Step | Where | What happens |
|------|--------|----------------|
| 5 | Policy Editor | `GET /agents/:id` loads policy + template |
| 6 | Form fields | Driven by **base** + template’s **`policyExt`** field list |
| 7 | Save draft | `PUT /agents/:id/policy` → row in `agent_policies`, status `draft` |

### 3.3 You Generate

| Step | Where | What happens |
|------|--------|----------------|
| 8 | Generate | `POST /agents/:id/generate` |
| 9 | Validate | Same Zod rules as Save (`AgentPolicyBase` + `policyExt`) |
| 10 | Load template | From `agent_templates` for that agent |
| 11 | Generate graph | `generateGraphFromTemplate(policy, template)` |
| 12 | Persist | Update policy → `generated`; insert `agent_versions` with graph JSON + checksum |

**Nothing after that in Stage 1.** Worker does not run this graph yet.

---

## 4. Status gates (lifecycle)

Only these matter in Stage 1:

| Status | Who sets it | Meaning |
|--------|-------------|---------|
| *(no row)* | — | Never saved |
| `draft` | Save | Policy stored; not generated yet |
| `generated` | Generate | Graph artifact written; still not live |

Later (not Stage 1): `compiled` → `published` → `active`.

**Rules that act as gates:**

| Gate | When | Result if fail |
|------|------|----------------|
| Entitlement (A3) | Save / Generate | `403 FORBIDDEN` |
| Policy Zod + tools | Save / Generate | `400 POLICY_INVALID` + field errors |
| Must have draft | Generate | `404 NO_DRAFT` |
| Latest must be draft | Generate | `409 NOT_DRAFT` (save a new draft first) |
| Version match | Save / Generate | `409 STALE_POLICY` (someone else changed it) |
| Template exists | Save / Generate | `404 TEMPLATE_NOT_FOUND` |
| Generator / topology | Generate | `500 GENERATION_FAILED` (draft kept) |
| Org RLS | Every DB access | Wrong org cannot see/write other tenants’ rows |

---

## 5. What goes in / what comes out

### Inputs

| Input | From | Used for |
|-------|------|----------|
| Admin id | Header `x-admin-id` (default `admin-local`) | Entitlement + audit (`created_by` / `generated_by`) |
| Org id | Header `x-org-id` (empty = global) | Sets `app.org_id` for RLS; scopes policy rows |
| Policy JSON | Form / request body | Intent: thresholds, filters, retry, prompt, … |
| Template | `agent_templates` | Nodes, wiring, `policyExt`, `conditionalOn` |
| Tool registry | Code `TOOL_REGISTRY` | Only known impls allowed |

### Outputs (Generate success)

| Output | Where it lives |
|--------|----------------|
| Policy status `generated` | `agent_policies` |
| Graph JSON text | `agent_versions.artifact_source` |
| Path-style ref | `agent_versions.artifact_ref` e.g. `agents/syntra/v4/graph.json` |
| Checksum (sha256) | Both policy + version rows |
| Graph key | e.g. `syntra.authored` (inside JSON + API response) |
| API body | `status`, `version`, `checksum`, `graphKey`, `definition`, … |

**Example graph shape (simplified):**

```json
{
  "graphKey": "syntra.authored",
  "nodes": [
    { "id": "parse", "impl": "parse_jd", "config": { "retry": …, "prompt": "…" } },
    { "id": "match", "impl": "calculate_match_score", "config": { "matchThreshold": 75, … } }
  ],
  "edges": [["__start__", "parse"], ["parse", "normalize"], …, ["persist", "__end__"]]
}
```

If `hardFilters` is non-empty on SYNTRA, a **`filter`** node is inserted and edges become `… → filter → match`.

---

## 6. Where data comes from (sources)

| Data | Source table / file | Notes |
|------|---------------------|--------|
| List of agents | `agent_definitions` | Runtime seed `R__seed_agent_definitions.sql` — today **3** active agents |
| Orgs | `organizations` | Existing platform table |
| Policy drafts / generated | `agent_policies` | Authoring V12 |
| Generated artifacts | `agent_versions` | Authoring V12 |
| Templates | `agent_templates` | Authoring V13 + seeds |
| Who can edit | `admin_agent_entitlements` | Authoring V14; `admin-local` seeded |
| Form field lists | Code `policy-ext-ui.ts` (+ API returns them) | Base + per-`policyExt` |
| Validation rules | Zod in `agent-policy-base.ts` + `policy-ext.ts` | Shared client + server |
| Generator | `generate-graph.ts` | Pure function; no LLM |

**Why only 3 products, not 12?**  
The plan said seed SYNTRA first. Runtime only seeds three `agent_definitions` today (matching / intake / copilot). Templates need real product wiring — inventing nine more without product specs would be fake. Adding more later = new template rows (data), not a new generator.

---

## 7. Apps and how to run them

| Piece | Path | Port | Command |
|-------|------|------|---------|
| Admin SPA | `apps/admin` | 5173 | `npm run dev -w @tekisho/admin` |
| Admin API | `apps/admin-api` | 4200 | `npm run start -w @tekisho/admin-api` |
| Shared library | `packages/authoring` | — | imported by API (+ SPA subpaths) |

**Env (repo root `.env`):**

| Var | Role |
|-----|------|
| `DATABASE_MIGRATOR_URL` | Boot: create/ensure authoring tables + RLS + seeds |
| `DATABASE_RELAY_URL` | API data role (can read `agent_definitions` + authoring DML) |

SPA proxies `/api` → `:4200`.

---

## 8. File map — what each file is for

### 8.1 Docs (`apps/admin/`)

| File | What it is |
|------|------------|
| `agent-authoring-admin-design-final.md` | Full design (source of truth) |
| `STAGE_1.md` / `STAGE_2.md` / `STAGE_3.md` | Per-stage scope |
| `RUNTIME.md` | Runtime companion (not built in Stage 1) |
| `STATUS.md` | Checklist / changelog |
| `STAGE_1_AUDIT.md` | **This audit** |
| `README.md` | Folder index |

### 8.2 Admin SPA (`apps/admin/src/`)

| File | What it does |
|------|----------------|
| `main.tsx` / `App.tsx` | Boot + routes |
| `pages/AgentList.tsx` | Table of agents; Edit only if `canEdit` |
| `pages/PolicyEditor.tsx` | Schema-driven form; Save + Generate |
| `api.ts` | HTTP helpers to admin-api |
| `styles.css` | UI styles |

### 8.3 Admin API (`apps/admin-api/src/`)

| File | What it does |
|------|----------------|
| `index.ts` | Starts Fastify; migrator ensure then relay pool |
| `routes/agents.ts` | `GET/PUT/POST` agents + templates |
| `entitlement.ts` | `canEditAgent` / batch list (fail closed) |
| `with-org-scope.ts` | Transaction + `set_config('app.org_id', …)` |
| `entitlement.test.ts` | Unit tests for entitlement logic |
| `agents.integration.test.ts` | Live DB: Generate golden path, stale, invalid, 403 |

### 8.4 Authoring package (`packages/authoring/src/`)

| File | What it does |
|------|----------------|
| `agent-policy-base.ts` | Shared Zod: retry, escalation, guardrails, ids |
| `policy-ext.ts` | Syntra / Intake / Copilot extra Zod schemas |
| `validate-policy.ts` | Compose base+ext; check `allowedTools` against registry |
| `policy-ext-ui.ts` | Form field descriptors + path helpers for the editor |
| `agent-template.ts` | Zod for template JSON shape |
| `template-catalog.ts` | In-repo seed of 3 templates |
| `template-for.ts` | Load active template from DB by key / agent id |
| `tool-registry.ts` | Whitelist of tool / node impl names |
| `graph-definition.ts` | Graph JSON schema + topology checks |
| `generate-graph.ts` | **The A6 engine** `(policy, template) → graph` |
| `generate-agent-ts.ts` | Old interim artifact (kept; not used by Generate API) |
| `generate.ts` | Re-exports graph generator (+ legacy) |
| `ensure-schema.ts` | Boot DDL, RLS, template + entitlement seeds |
| `index.ts` | Package exports |
| `*.test.ts` | Unit tests (§16) |

### 8.5 Database migrations (`packages/db/migrations/`)

| File | What it does |
|------|----------------|
| `V12__agent_authoring_policies.sql` | `agent_policies`, `agent_versions` |
| `V13__agent_templates.sql` | `agent_templates` |
| `V14__authoring_rls_and_entitlements.sql` | Entitlements table + RLS policies |
| `R__seed_agent_templates.sql` | Seed templates (Flyway repeatable) |
| `R__rls_assert.sql` | Asserts RLS; exempts `agent_templates` from FORCE |
| `R__seed_agent_definitions.sql` | **Existing** runtime agents (not Stage 1–owned, but List reads them) |

Boot also mirrors V12–V14 via `ensureAuthoringSchema()` so local/dev works even before Flyway apply.

---

## 9. The generator (load-bearing piece)

**File:** `packages/authoring/src/generate-graph.ts`  
**Function:** `generateGraphFromTemplate(policy, template)`

What it does, in order:

1. Reject unknown `impl` names (must be in `TOOL_REGISTRY`)
2. Copy template **nodes**; stamp shared policy (retry, escalation, guardrails, prompt)
3. Apply each node’s **`configFrom`** (e.g. `matchThreshold`, `rerank` onto `match`)
4. Copy template **wiring** (edges)
5. Read **`conditionalOn`** — if key `hardFilters` and policy has a non-empty list → insert `filter` node and rewire `* → match` into `* → filter → match`
6. Validate with `GraphDefinitionSchema` + topology (`__start__` / `__end__`, no orphans)
7. Return JSON string + sha256 checksum

**Proof it is not a fixed graph:** tests assert  
`hardFilters: ["location","visa"]` → filter present  
`hardFilters: []` → filter absent  
(`generate-graph.test.ts` — both pass.)

---

## 10. APIs (Stage 1 only)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness |
| `GET` | `/templates` | List active templates + field descriptors |
| `GET` | `/agents` | Agent list + latest policy summary + `canEdit` |
| `GET` | `/agents/:id` | One agent + policy + template + form fields |
| `PUT` | `/agents/:id/policy` | Save → `draft` |
| `POST` | `/agents/:id/generate` | Validate → generate → `generated` |

**Headers:**

| Header | Meaning |
|--------|---------|
| `x-admin-id` | Who is acting (entitlement) |
| `x-org-id` | Tenant scope (omit = global `org_id NULL`) |

---

## 11. Database picture

```text
organizations                 agent_definitions  (runtime seed; List)
      │                              │
      │ org_id (nullable)            │ agent_id
      ▼                              ▼
           agent_policies  ──1──N──▶  agent_versions
                ▲                         (graph JSON on Generate)
                │
           agent_templates            (drives form + generator)
           
           admin_agent_entitlements   (who may Edit/Generate)
```

**RLS (simple):**

- Read: global rows (`org_id` null) **or** current org  
- Write: only matching org, **or** global when org GUC is unset  
- Templates: readable by app roles; platform reference (no FORCE)

---

## 12. Templates seeded today

| agentKey | Links to agent | policyExt | Special behaviour |
|----------|----------------|-----------|-------------------|
| `syntra` | matching-agent `…501` | `SyntraPolicyExt` | `conditionalOn.hardFilters` can insert filter |
| `intake` | intake-agent `…502` | `IntakePolicyExt` | No conditionals yet |
| `copilot` | copilot `…503` | `CopilotPolicyExt` | No conditionals yet |

---

## 13. Tests (§16) — what we prove

| Kind | Where | Proves |
|------|--------|--------|
| Generator unit | `generate-graph.test.ts` | Registry-only impls, configFrom, hardFilters on/off, determinism |
| Policy schema | `validate-policy.test.ts` | Valid/invalid; unknown tools; field paths |
| Form UI helpers | `policy-ext-ui.test.ts` | Path get/set; build payload |
| Templates | `agent-template.test.ts` | Seeds parse; policyExt registered |
| Entitlement unit | `entitlement.test.ts` | Deny by default; org override |
| API integration | `agents.integration.test.ts` | Save→Generate golden; 409 stale; invalid writes nothing; stranger 403 |

Run:

```powershell
npm test -w @tekisho/authoring -- --run
npm test -w @tekisho/admin-api -- --run
```

(Integration tests skip if DB URLs are missing.)

---

## 14. What Stage 1 deliberately does **not** do

- Does not call the worker / LangGraph runtime  
- Does not write `graph_definitions` for live execution  
- Does not compile, publish, or activate  
- Does not call an LLM during Generate  
- Does not ship all ~12 portfolio products (machinery is ready; catalog is 3)

---

## 15. Honest “done” checklist

| Item | Done? |
|------|-------|
| Agent List | ✅ |
| Policy Editor driven by template schema | ✅ |
| Save → `draft` | ✅ |
| Generate → graph JSON → `generated` | ✅ |
| One schema-driven generator (A6) | ✅ |
| Policy change can change graph (`hardFilters`) | ✅ (code + tests) |
| Entitlement + RLS (A3) | ✅ |
| §16 tests | ✅ |
| All 12 product templates | ❌ (out of Stage 1 minimum; add as data later) |
| Real login / IdP | ❌ (headers stub for Stage 1) |
| Stage 2 Compile / Stage 3 Publish | ❌ (separate stages) |

---

## 16. Bottom line

Stage 1 is a **working authoring slice**: list agents, edit policy from a template-driven form, save a draft, generate a **different graph when policy conditionals say so**, store it with a checksum, and stop before runtime. The important proof is not the file list — it is `generate-graph.ts` + the hardFilters present/absent tests.

Next real product work (when you want it): more templates for more agents, or Stage 2 Compile into `graph_definitions`.
