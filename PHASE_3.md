# Phase 3 — Module fan-out plan (what we need to implement)

**Status:** ❌ **Not started as a phase** (~10% today = Syntra HTTP bridge only)  
**Depends on:** Phase 1 ✅ · Phase 2 strongly recommended first (errors / human gate / metrics)  
**Product:** Hiring Assistant Orchestrator only  
**Last updated:** 2026-08-10  

**Goal of Phase 3:** Grow from “Syntra one-HTTP-step workflows” into **real multi-step product modules** inside the orchestrator — with behavior in git, recipes in DB, and shared `NodeCtx` (llm / db / events).

**Not Phase 3:** Kafka / Recruiter Copilot. Deferred saga/compensation stays Phase 4-ish.

---

## 1. Where we are vs where Phase 3 goes

| | Today (after Phase 1) | After Phase 3 |
|--|----------------------|---------------|
| Steps | 3 Syntra HTTP nodes | Design nodes: summarize, embed, match, share, interview, … |
| Graphs | 1 node → Syntra → end | Multi-step graphs with branches / human gates |
| LLM | Noop slot; Syntra owns AI | Real `LLMClient` in orchestrator (Syntra may still own some domain writes) |
| Modules | Syntra only | Resume / JD / match **plus** share + interview (and more) |
| Queues | `module.syntra.*` | Broader `module.resume`, `module.jd`, `module.share`, … (design names) |

**One line:** Phase 3 = **real product brains in the orchestrator**, not only “call Syntra and finish.”

---

## 2. What “done” looks like for Phase 3

You can say Phase 3 is done when:

1. A real **`LLMClient`** is wired (not only Noop) — with tests using Noop/fake  
2. Core design nodes exist in the registry and are used by `.def.ts` recipes  
3. At least one **multi-step** workflow runs without being a single Syntra HTTP call  
4. **Share** module has a thin vertical slice (event → graph → emit)  
5. **Interview / mock-interview** module has a thin vertical slice  
6. Module queues follow design-style names (or documented mapping)  
7. Syntra bridge is either **shrunk** or clearly marked “legacy adapter nodes” only  
8. Docs + STATUS scores updated; smoke tests for each new module path  

**Estimated effort:** ~**4–8 weeks** focused (depends how deep share/interview go and how much stays in Syntra).

---

## 3. Big picture

```text
                    POST /v1/events  (Phase 1 front door)
                              │
                              ▼
                         ingress → router
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
        module.resume   module.jd/match   module.share / interview
              │               │                │
              ▼               ▼                ▼
        multi-step graph  multi-step graph  multi-step graph
        (cv.* / jd.*)     (jd.* / match)    (share.* / interview.*)
              │               │                │
              ├─ llm.complete ─┤                │
              ├─ db.withOrg ───┤                │
              ├─ events.emit ──┤                │
              └─ human.gate ───┴── (from Phase 2)
                              │
                              ▼
                    outbox → relay → next events
```

---

## 4. Work packages (implement in this order)

### Package A — Real LLMClient (replace Noop for prod)  
**Priority:** P0 · **Time:** ~2–4 days

**Problem today:** `noopLlm` returns empty text. Syntra does all AI over HTTP.

**Build:**

| Item | Detail |
|------|--------|
| `LLMClient` interface | Keep existing `packages/orchestrator/src/llm/types.ts` |
| Provider adapter | OpenAI-compatible / OpenRouter client (env-based) |
| Wire into `createNodeCtx` | Inject real client when `LLM_API_KEY` set; else Noop |
| Safety | Timeouts, max tokens, redaction in logs |
| Tests | Nodes unit-tested with Noop only (no paid calls in CI) |

**Files (expected):**
- `packages/orchestrator/src/llm/openrouter.ts` (or `openai-compatible.ts`) — new  
- `packages/orchestrator/src/nodes/ctx.ts` — choose client  
- `apps/worker/src/env.ts` — `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`  
- Docs: which env vars  

**Done when:** A tiny test node can call `ctx.llm.complete` against a mock; prod path configurable.

---

### Package B — Core design nodes (resume / JD building blocks)  
**Priority:** P0 · **Time:** ~1–2 weeks

**Problem today:** Registry only has `syntra.*.process` (+ test resume nodes).

**Build these registry keys (names can match design doc):**

| Node key | Plain job |
|----------|-----------|
| `cv.extract` / `cv.summarize` | Turn resume text/doc ref into structured summary |
| `cv.embed` | Write embedding (DB / vector store via `ctx.db` or service) |
| `jd.parse` / `jd.normalize` | Structure JD skills / requirements |
| `jd.match` | Score candidate(s) against JD |
| `event.emit` | First-class emit helper node (optional if `ctx.events` enough) |
| Keep `syntra.*` | Thin **adapters** calling Syntra where domain writes still live there |

**Rules:**
- Nodes use **`NodeCtx` only** — no hidden singletons  
- Writes should be **idempotent** where they touch DB  
- Prefer returning state patches + `ctx.events.emit`  

**Files (expected):**
- `packages/orchestrator/src/nodes/cv/*.ts`  
- `packages/orchestrator/src/nodes/jd/*.ts`  
- `packages/orchestrator/src/nodes/registry.ts` — register keys  
- Unit tests per node with Noop LLM + fake db  

**Done when:** Registry lists design keys; unit tests green without live Syntra.

---

### Package C — Multi-step recipes (`.def.ts`) for resume + JD  
**Priority:** P0 · **Time:** ~3–5 days

**Problem today:** Each Syntra workflow is `start → one HTTP node → end`.

**Build example recipes:**

1. **Resume prepare (v2)**  
   `extract → summarize → embed → emit profile.prepared`  
2. **JD prepare (v2)**  
   `parse → normalize → emit jd.parsed`  
3. **Match (v2)**  
   `load context → score → emit match.completed`  
   (may still call Syntra for persistence)

Use `defineGraph` + catalog + `generate:graph-seeds`.  
Bump **version** (v2) — don’t silently rewrite active v1 (design rule).

**Files (expected):**
- `graphs/defs/syntra.resume.workflow.v2.def.ts` (or rename module keys)  
- `graphs/defs/syntra.jd.workflow.v2.def.ts`  
- `graphs/defs/syntra.match.workflow.v2.def.ts`  
- Regenerated `R__seed_*.sql`  
- Routing table: when to activate v2 (org override or global cutover)

**Done when:** A front-door event runs a **multi-node** graph and emits the same (or versioned) completion events.

---

### Package D — Module queue rename / expand (design topology)  
**Priority:** P1 · **Time:** ~2–3 days

**Problem today:** Queues are `module.syntra.jd` etc. Design prefers `module.resume`, `module.jd`, …

**Build:**

| Item | Detail |
|------|--------|
| Routing table | `EVENT_TO_MODULE_QUEUE` → design names |
| Workers | `startModuleWorkers` listens on new queues |
| Compatibility | Keep Syntra bridge queues **or** adapter that republishes into module.* |
| Docs | Update `WORKFLOW_MAP.md` / `FRONT_DOOR.md` |

**Done when:** New events land on design queue names; old bridge still documented.

---

### Package E — Share module (thin vertical slice)  
**Priority:** P1 · **Time:** ~1–2 weeks

**Plain meaning:** Recruiter shares a candidate / requirement with vendor or client; workflow tracks status.

**Build (thin slice first):**

| Piece | Detail |
|-------|--------|
| Events | e.g. `share.requested`, `share.sent`, `share.accepted` / `share.rejected` (exact names per product contract) |
| Nodes | `share.prepare`, `share.notify`, `share.record` (names TBD) |
| Recipe | `.def.ts` with optional `human.gate` (approve before send) |
| Module queue | `module.share` |
| Persistence | Prefer existing domain tables if present; else minimal orchestration-owned rows + events |

**Files (expected):**
- `nodes/share/*.ts`  
- `graphs/defs/share.*.def.ts`  
- Routing + event schemas seed  
- Ingress examples in docs  

**Done when:** One share request goes front door → graph → outbox event(s). Human gate optional but recommended.

---

### Package F — Interview / mock-interview module (thin vertical slice)  
**Priority:** P1 · **Time:** ~1–2 weeks

**Plain meaning:** Schedule or run a mock interview flow; store outcome; emit completion.

**Build (thin slice first):**

| Piece | Detail |
|-------|--------|
| Events | e.g. `interview.requested`, `interview.completed` |
| Nodes | `interview.plan`, `interview.score` / `interview.summarize` (LLM) |
| Recipe | Multi-step + optional human review gate |
| Module queue | `module.interview` |
| Integration | May call external interview service **or** stay LLM-only for v1 |

**Done when:** One interview request completes through orchestrator with emitted result event.

---

### Package G — State schemas & graph richness  
**Priority:** P2 · **Time:** ~3–5 days

**Problem today:** Shared Syntra Annotation state; little use of conditional edges.

**Build:**
- Per-module Zod state schemas (or typed Annotation roots)  
- Use `conditionalEdges` in at least one recipe (e.g. low match score → human.gate)  
- Compiler support already partial — exercise it in defs + validation tests  

**Done when:** One graph branches on score/decision without hardcoding in a single mega-node.

---

### Package H — Shrink Syntra HTTP bridge  
**Priority:** P2 · **Time:** ongoing / ~3–5 days for a clear cut

**Options:**
1. **Keep Syntra as system of record** — orchestrator nodes call Syntra only for writes  
2. **Move logic into orchestrator** — Syntra becomes UI/API only  
3. **Hybrid** (likely) — adapters remain for a while  

**Phase 3 exit criteria for this package:**
- Document which nodes are “pure orchestrator” vs “Syntra adapter”  
- No new product feature should be “one opaque Syntra HTTP node” without a plan to split it  

---

## 5. Suggested schedule (6-week solid plan)

| Week | Focus |
|------|--------|
| 1 | Package A (LLMClient) + start Package B (cv/jd nodes) |
| 2 | Finish Package B + unit tests |
| 3 | Package C (multi-step `.def.ts` v2) + smoke via front door |
| 4 | Package D (queue names) + Package G (branching) start |
| 5 | Package E (share thin slice) |
| 6 | Package F (interview thin slice) + Package H docs/adapters |

*Thin Phase 3 (~4 weeks):* A + B + C + one of E/F.  
*Full Phase 3 (~8 weeks):* all packages with real share + interview depth.

---

## 6. What we reuse from Phase 1 / 2

| Piece | Why it matters in Phase 3 |
|-------|---------------------------|
| Front door + router | All new modules enter the same way |
| `.def.ts` + catalog + seed | New graphs are authored in git |
| `NodeCtx` (db / events / llm) | New nodes plug in cleanly |
| Version pin + checkpointer | Multi-step + human gate need resume |
| `human.gate` (Phase 2) | Share/interview approvals |
| Error kinds + failed_workflows (Phase 2) | LLM/network failures classified |
| Metrics (Phase 2) | Track slow LLM nodes |

**Recommendation:** Do **Phase 2 Packages A/B/E** before deep Phase 3 LLM graphs — otherwise failures and pauses will be painful.

---

## 7. New env / config Phase 3 will likely need

| Env | Purpose |
|-----|---------|
| `LLM_API_KEY` | Provider key |
| `LLM_BASE_URL` | e.g. OpenRouter URL |
| `LLM_MODEL` | Default model |
| `LLM_MAX_TOKENS` | Cap spend/latency |
| `SYNTRA_API_URL` | Still used by adapter nodes |
| Feature flags | e.g. `GRAPH_RESUME_V2=1` for cutover |

---

## 8. Event & schema work

For each new module:
1. Add `EVENT_TYPES` in `packages/domain`  
2. Seed `event_schemas` (Flyway) so outbox FK works  
3. Add routing rows: event → graph_key → module queue  
4. Document payload fields in simple English  

Don’t invent event names in nodes without registering them.

---

## 9. Testing strategy (Phase 3)

| Level | What |
|-------|------|
| Node unit | Noop LLM + fake `db` / `events` |
| Compiler | New defs pass `validateDefinition` |
| Graph integration | Multi-node with mocked LLM HTTP |
| Smoke | Front door → module queue → completion event in outbox |
| Live | One org flag for v2 graphs before global cutover |

CI must **not** call paid LLM by default.

---

## 10. Acceptance checklist

### Platform
- [ ] Real LLMClient behind env flag; Noop in tests  
- [ ] Design nodes registered and documented  

### Resume / JD / Match
- [ ] Multi-step v2 recipes seeded  
- [ ] Front-door smoke for each  
- [ ] Completion events still land in outbox  

### Share
- [ ] `module.share` path works end-to-end (thin)  
- [ ] At least one emit + optional human gate  

### Interview
- [ ] `module.interview` path works end-to-end (thin)  

### Topology
- [ ] Queue names documented (design vs legacy bridge)  
- [ ] Syntra adapter boundaries written down  

### Docs
- [ ] `PHASE_3.md` marked with verification dates  
- [ ] `WORKFLOW_MAP.md` / STATUS / plan updated  

---

## 11. Risks & decisions (decide early)

| Topic | Recommendation |
|-------|----------------|
| Who owns embeddings / profiles DB? | Prefer existing Syntra/domain tables via `ctx.db` or Syntra write APIs — don’t fork data blindly |
| Cutover v1 → v2 graphs | Org override first; global later |
| LLM cost | Low max_tokens defaults; cache where safe |
| Share/interview depth | **Thin slice first**; deep product UX later |
| Phase 2 not done | Block human-gated share/interview until `human.gate` exists |

---

## 12. Out of scope (Phase 4 / later)

- Full saga / compensation across modules  
- Fancy NBA / policy engines as product features  
- Recruiter Copilot / Kafka blueprint  
- Perfect UI for every module (orchestrator delivers events + APIs)  

---

## 13. How Phase 3 relates to Syntra

```text
Today:   Event → Orchestrator → ONE Syntra HTTP call → done

Phase 3: Event → Orchestrator multi-step graph
              ├─ LLM nodes (orchestrator)
              ├─ DB nodes (orchestrator / domain)
              ├─ human.gate (Phase 2)
              └─ Syntra adapter nodes ONLY where Syntra must write domain data
```

Syntra can remain the **product UI + some domain APIs**. The orchestrator becomes the **workflow brain**.

---

## 14. Docs to update when Phase 3 lands

| Doc | Update |
|-----|--------|
| `PHASE_3.md` | Mark packages ✅ + smoke evidence |
| `plan.md` | Phase 3 status; next = Phase 4 / polish |
| `STATUS_TRACKER.md` | Registry nodes, modules, queues |
| `WORKFLOW_MAP.md` | New modules + multi-step flows |
| `FRONT_DOOR.md` | Example events for share/interview |
| Node README under `nodes/` | How to add a node |

---

## 15. Bottom line

**Phase 3 grows the hiring product inside the orchestrator:** real LLM, real multi-step recipes, share + interview slices, and less “single Syntra HTTP blob.”

**Best order:**  
**LLMClient → core cv/jd nodes → multi-step defs → queue cleanup → share → interview → shrink adapters.**

Prefer finishing **Phase 2 human gate + errors** before deep share/interview graphs.

---

*This is an implementation plan, not completed work. Start after Phase 2 (or after Phase 2 A/B/E minimum).*
