# Agent Authoring — Status

**Updated:** 2026-08-11  
**Design / plan (final):** [`agent-authoring-admin-design-final.md`](./agent-authoring-admin-design-final.md)  
**Stages:** [`PLAN.md`](./PLAN.md) · [`STAGE_1.md`](./STAGE_1.md) · [`STAGE_1_AUDIT.md`](./STAGE_1_AUDIT.md) · [`STAGE_2.md`](./STAGE_2.md) · [`STAGE_2_AUDIT.md`](./STAGE_2_AUDIT.md) · [`STAGE_3.md`](./STAGE_3.md) · [`STAGE_3_AUDIT.md`](./STAGE_3_AUDIT.md) · [`RUNTIME.md`](./RUNTIME.md)  
**Compile / Publish designs:** [`COMPILE_DESIGN.md`](./COMPILE_DESIGN.md) · [`PUBLISH_DESIGN.md`](./PUBLISH_DESIGN.md)

Legend: ✅ Done · 🟡 Partial · ❌ Not started · ⛔ Blocked

---

## Overall

| Metric | Value |
|--------|--------|
| Stage 1 (Generate) | **Done** |
| Stage 2 (Compile) | **Done** |
| Stage 3 (Publish / activate / rollback) | **Done** (authored keyspace only) |
| Runtime go-live for authored graphs | **Not done** — needs runtime owner (router + node bridge) |

---

## What exists

| Item | Status | Notes |
|------|--------|-------|
| `apps/admin` SPA | ✅ | List (active + last generated) + Policy Editor (Save → Generate → Compile → Publish → Activate → Rollback) |
| `apps/admin-api` | ✅ | Full Stage 1–3 routes under entitlement + `withOrgScope` |
| Schema-driven generator | ✅ | `(policy, template) → graph.json` |
| Templates | 🟡 | 3 seeded (syntra, intake, copilot); DB seed has 3 agents today, not 12 |
| Entitlement / RLS | ✅ | Fail-closed; Stage 3 routes covered |
| Tests | ✅ | Authoring unit + admin-api integration (incl. Stage 3 + negatives) |

---

## Explicitly deferred (not Stage 1–3 solo)

| Item | Why |
|------|-----|
| Point router at `syntra.authored` | Production traffic switch; shared with runtime owner |
| Map authoring `TOOL_REGISTRY` → runtime `nodeRegistry` | Authored impls ≠ runtime nodes today |
| Invent remaining “12 products” templates | Only 3 agents exist in `agent_definitions` seed; more products are a product/data decision |

---

## Change log

| Date | Update |
|------|--------|
| 2026-08-11 | Stage 1 complete |
| 2026-08-11 | Stage 2 Compile complete |
| 2026-08-11 | Stage 3 Publish/Activate/Rollback + List active column + SPA actions |

---

*Do not track orchestrator Phase 2/3 internals here — see [`RUNTIME.md`](./RUNTIME.md).*
