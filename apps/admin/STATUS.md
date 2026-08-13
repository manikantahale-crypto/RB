# Agent Authoring — Status

**Updated:** 2026-08-12  
**Design / plan (final):** [`agent-authoring-admin-design-final.md`](./agent-authoring-admin-design-final.md)  
**LLM generator:** [`llm-graph-generator-design.md`](./llm-graph-generator-design.md)  
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
| Runtime go-live for authored graphs | **Not done** — **held** (router remount); do not flip until asked |
| LLM graph generator (Stage 1 evolution) | **Done** — steps 1–9 (engine + Generate API + Policy Editor UX + tests) |

---

## What exists

| Item | Status | Notes |
|------|--------|-------|
| `apps/admin` SPA | ✅ | List + Policy Editor with LLM request + workflow summary |
| `apps/admin-api` | ✅ | Stage 1–3 routes; LLM generate path wired |
| Schema-driven generator | ✅ | Template path still available |
| LLM tool catalog (§4.1) | ✅ | 3 runtime tools with desc + I/O |
| Event catalog reader (§4.2) | ✅ | `loadEventCatalog` from `event_schemas` |
| Generic `LLMClient` (§9 #1) | ✅ | openai / openrouter / anthropic / noop via env |
| System-prompt builder (§4.3) | ✅ | `buildGraphSystemPrompt` |
| LLM call + parse + validate | ✅ | propose → validate → checksum |
| Generate API LLM path | ✅ | `request` → LLM; regenerate while `generated`; template fallback without `request` |
| Policy Editor LLM UX | ✅ | Freeform request + hint; readable current workflow; Generate & accept / Regenerate |
| LLM step-9 tests | ✅ | Fake tool / bad JSON → rejected; valid English → real tools; stops at `generated` |
| Templates | 🟡 | 3 seeded; impls = runtime nodes only |
| Entitlement / RLS | ✅ | Fail-closed; Stage 3 routes covered |
| Tests | ✅ | Authoring unit (56) + admin-api integration (LLM cases covered) |

---

## Explicitly deferred

| Item | Why |
|------|-----|
| Point router at `syntra.authored` | **Held** — shared with runtime owner; do not remount yet |
| Invent remaining “12 products” templates | Product/data decision |
| Teammate’s ~6 extra tools | Catalog-only when they land (§9 #5) |

---

## Change log

| Date | Update |
|------|--------|
| 2026-08-11 | Stage 1 complete |
| 2026-08-11 | Stage 2 Compile complete |
| 2026-08-11 | Stage 3 Publish/Activate/Rollback + List active column + SPA actions |
| 2026-08-12 | Authoring tools aligned to runtime nodeRegistry only (3 Syntra process nodes) |
| 2026-08-12 | LLM generator §9 locked; catalog + LLMClient + prompt builder landed |
| 2026-08-12 | Generate API LLM path + Policy Editor UX (request + workflow summary) |
| 2026-08-12 | LLM step-9 tests: fake tool, bad JSON, valid English, stops at generated |

---

*Do not track orchestrator Phase 2/3 internals here — see [`RUNTIME.md`](./RUNTIME.md).*
