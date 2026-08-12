# Stage 3 — Complete Audit

**Date:** 2026-08-11  
**Status:** Stage 3 done (`compiled → published → active` + rollback)  
**Design we follow:** [`agent-authoring-admin-design-final.md`](./agent-authoring-admin-design-final.md)  
**Short plan:** [`STAGE_3.md`](./STAGE_3.md) · [`PUBLISH_DESIGN.md`](./PUBLISH_DESIGN.md) · [`STATUS.md`](./STATUS.md)  
**Earlier stages:** [`STAGE_1_AUDIT.md`](./STAGE_1_AUDIT.md) · [`STAGE_2_AUDIT.md`](./STAGE_2_AUDIT.md)

This file explains Stage 3 in plain English: what we built, which files changed and why, what goes in, what comes out, and what you still do **not** get.

---

## 1. What Stage 3 is (one sentence)

After Compile has put a graph in the store as `compiled`, Stage 3 lets an admin **Publish** it (review gate), then **Activate** it as the current authored version — and **Rollback** to an older published authored version if needed — **without turning off the live runtime workflows**.

```text
compiled ──Publish──▶ published ──Activate──▶ active
                              ▲
                              └── Rollback (to a prior published authored version)
```

**Prerequisite:** Stage 2 done (status `compiled`, rows in `graph_definitions` + `graph_versions`).

---

## 2. The big safety idea (read this first)

| Idea | Meaning |
|------|---------|
| Authored graphs use key `syntra.authored` | Admin-built graphs live under this key |
| Runtime live graphs use `syntra.*.workflow` | Real production traffic today |
| Activate is **per `graph_key`** | Activating authored only swaps among `syntra.authored` versions |
| Never retire runtime keys from admin | Activating authored must **not** turn off `syntra.jd.workflow` etc. |
| Activate ≠ “go live in production” | Worker still follows the router; pointing the router at authored is a **later, shared** decision |

So Stage 3 finishes the **authoring mechanism**. It does **not** flip production traffic onto the authored graph by itself.

---

## 3. Start → end flow (what happens)

### 3.1 You already have Stage 2 output

| You have | Meaning |
|----------|---------|
| `agent_policies.status = compiled` | Policy passed Compile |
| `agent_versions.status = compiled` | Artifact checked and stored |
| `graph_definitions` row | Usually `status = draft` for that authored key + version |
| `graph_versions` history row | Compile history |

### 3.2 Publish (`POST /agents/:id/publish`)

| Step | What happens |
|------|----------------|
| 1 | Check entitlement (`canEditAgent`) + org scope (`withOrgScope`) |
| 2 | Find latest **compiled** artifact for this agent |
| 3 | Set `agent_policies` + `agent_versions` → **`published`** |
| 4 | Mark matching `graph_versions` → `published` (history note) |
| 5 | Leave `graph_definitions` as **`draft`** (not live yet) |

**You get:** a reviewed, ready version. Still not the “active” authored version.

### 3.3 Activate (`POST /agents/:id/activate`)

| Step | What happens |
|------|----------------|
| 1 | Entitlement + org scope again |
| 2 | Find latest **published** artifact |
| 3 | Read `graphKey` from the artifact — must be `{agentKey}.authored` |
| 4 | Refuse if it looks like a runtime `*.workflow` key |
| 5 | Retire other `active` rows **only under that same `graph_key`** |
| 6 | Set this `graph_definitions` row → **`active`** |
| 7 | Set this policy / version → **`active`** (demote previous authoring active to `published`) |

**You get:** one active authored version for that agent. Runtime `*.workflow` rows stay active.

### 3.4 Rollback (`POST /agents/:id/rollback`)

| Step | What happens |
|------|----------------|
| 1 | Body must include `targetVersion` (number) |
| 2 | That version must be `published` or `active` and authored-key |
| 3 | Same per-key activate rules: make that version active again |

**You get:** authored active flipped back to an older published version.

### 3.5 Agent List

| Column | Source |
|--------|--------|
| Status | Latest policy status (draft / generated / …) |
| Active version | Policy with `status = active` (or `—`) |
| Last generated | Latest `agent_versions` row (time + author) |

---

## 4. Status gates (lifecycle)

| Status | Who sets it | Meaning |
|--------|-------------|---------|
| `compiled` | Stage 2 | Input to Stage 3 |
| `published` | Publish | Reviewed; ready to activate |
| `active` | Activate / Rollback | Current authored version for that agent/key |

Within one version, status moves forward. After publish/activate, further edits = **new version** (not in-place rewrite).

---

## 5. What you get when Stage 3 is done

| You get | You do **not** get (yet) |
|---------|---------------------------|
| Full API: publish / activate / rollback | Runtime automatically running authored graphs |
| Authored `graph_definitions` can be `active` under `*.authored` | Router remapped from `*.workflow` → `*.authored` |
| List shows active version | Guarantee that authored node names run in the worker |
| SPA buttons for the whole pipeline | All 12 product templates (DB still has 3 agents) |
| Entitlement 403 if no grant | Billing / infra |

---

## 6. Files changed (and why)

### 6.1 API (backend)

| File | Why we changed it |
|------|-------------------|
| `apps/admin-api/src/routes/agents.ts` | Added **Publish**, **Activate**, **Rollback**. Extended **GET /agents** with `activeVersion` + `lastGenerated`. All Stage 3 writes use entitlement + org scope. Activate/rollback refuse non-authored keys. |
| `apps/admin-api/src/agents.integration.test.ts` | Proves publish/activate/rollback work; stranger gets 403; runtime `*.workflow` stay active; list fields exist; bad inputs rejected. |
| `apps/admin-api/src/entitlement.ts` | Already existed (Stage 1); Stage 3 routes reuse `canEditAgent`. |
| `apps/admin-api/src/with-org-scope.ts` | Already existed; Stage 3 routes reuse `withOrgScope` for RLS. |

### 6.2 Admin UI (frontend)

| File | Why we changed it |
|------|-------------------|
| `apps/admin/src/api.ts` | Client helpers: `compileAgent`, `publishAgent`, `activateAgent`, `rollbackAgent`. List types include `activeVersion` / `lastGenerated`. |
| `apps/admin/src/pages/PolicyEditor.tsx` | Buttons: Compile / Publish / Activate / Rollback (enabled by current status). |
| `apps/admin/src/pages/AgentList.tsx` | Columns for **Active version** and **Last generated**. |
| `apps/admin/src/styles.css` | Badge colors for compiled / published / active. |

### 6.3 Docs

| File | Why we changed / added it |
|------|---------------------------|
| `apps/admin/PUBLISH_DESIGN.md` | Records the **per-key one-active** rule and API contracts so activate stays safe. |
| `apps/admin/STAGE_3.md` | Checklist marked complete. |
| `apps/admin/STATUS.md` | Stages 1–3 marked done; deferred go-live called out. |
| `apps/admin/README.md` | Links to Stage 3 audit + publish design. |
| `apps/admin/STAGE_3_AUDIT.md` | This file — full Stage 3 story. |

### 6.4 Database (used by Stage 3; mostly from Stage 2)

| Piece | Role in Stage 3 |
|-------|-----------------|
| `graph_definitions` | Activate sets authored row to `active` / `retired` (same key only) |
| `graph_versions` | History statuses: published / active |
| `agent_policies` | `published` / `active` (one active per agent + scope) |
| `agent_versions` | Same status mirror |
| `admin_agent_entitlements` | Who may call Stage 3 routes |

Stage 3 itself does **not** invent new tables; it uses the store Stage 2 prepared.

---

## 7. API cheat sheet

| Method | Path | Needs | Result |
|--------|------|-------|--------|
| `POST` | `/agents/:id/publish` | Latest **compiled** | `published` |
| `POST` | `/agents/:id/activate` | Latest **published** + authored key | `active` (authored only) |
| `POST` | `/agents/:id/rollback` | `{ targetVersion }` published/active authored | That version `active` |
| `GET` | `/agents` | — | Includes `activeVersion`, `lastGenerated` |

All writes: admin id + entitlement; missing grant → **403 FORBIDDEN**.

---

## 8. Tests (what we ran)

```text
npm run test -w @tekisho/admin-api
```

Covered:

- Stranger → publish / activate / rollback = **403**
- Publish → statuses published; graph stays draft; runtime keys still active
- Activate → authored active; runtime `syntra.*.workflow` still active
- Rollback → older authored version active again; runtime untouched
- List → `activeVersion` + `lastGenerated` present
- Bad inputs → rejected (no compiled / no published / missing target version)

---

## 9. Simple picture (start → end)

```text
  Stage 1                         Stage 2                      Stage 3
  ───────                         ───────                      ───────
  Edit policy                     Parse + checksum             Publish (review)
  Generate graph.json             Write graph_definitions      Activate (authored key)
  status = generated              status = compiled            status = active
                                                               Rollback if needed
                                      │
                                      ▼
                         Shared DB (graph store)
                                      │
                                      │  (NOT automatic)
                                      ▼
                         Runtime still reads *.workflow
                         until router is pointed at authored
                         (separate decision with runtime owner)
```

---

## 10. Completeness statement

**Stage 3 authoring checklist: complete.**

You can: Publish → Activate → Rollback → see Active on the list → do it from the SPA.

You still need a **separate project** (with the runtime owner) to:

1. Point the router at `syntra.authored` (or map tools so authored graphs are runnable), and  
2. Add more product agents/templates beyond the 3 seeded today.

That is **not** missing Stage 3 work — it is the production go-live switch we deliberately did not flip alone.
