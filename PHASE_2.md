# Phase 2 — Hardening plan (what we need to implement)

**Status:** ❌ **Not started** (~5% partial — basic DLQ / soft-disable patterns only)  
**Depends on:** Phase 1 ✅ (front door, recipes, runner, outbox, relay)  
**Product:** Hiring Assistant Orchestrator only  
**Last updated:** 2026-08-10  

**Goal of Phase 2:** Make the skeleton **safe to run for real** — clear failures, visibility, human pause/resume, and cleanup.  
**Not Phase 2:** New product modules (share / interview / in-orchestrator CV nodes) — that is mostly **Phase 3**.

---

## 1. Phase 1 vs Phase 2 (simple)

| | Phase 1 | Phase 2 |
|--|---------|---------|
| Focus | Make it **run** | Make it **operable** |
| Question | “Can a JD event reach Syntra?” | “When it breaks, do we know why and what to do?” |
| Output | Working spine | Hardened production spine |

**One line:** Phase 2 = errors + failed jobs + metrics + human gate + cleanup.

---

## 2. What “done” looks like for Phase 2

You can say Phase 2 is done when:

1. Every failed job is labeled: **retry** / **bad input** / **system bug**
2. Failures are stored in a **`failed_workflows`** (or equivalent) table you can query
3. Operators can **replay** a failed job safely (same pin / thread rules)
4. Basic **metrics** exist (step time, failures, queue age) — even if only logs + SQL at first
5. A workflow can **pause for a human** (`human.gate`) and **resume** after approve/reject
6. Old LangGraph checkpoints can be **pruned** on a schedule
7. Docs (`PHASE_2.md` outcomes + runbook) explain how to operate it

**Estimated effort:** ~**1.5–3 weeks** focused (one engineer who knows this repo).

---

## 3. Big picture (what Phase 2 adds)

```text
                    Phase 1 path (already works)
                              │
                              ▼
                    run module / dispatch job
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
         success          failure         human.gate
              │               │               │
              ▼               ▼               ▼
           outbox      classify error     pause + wait
              │               │               │
              ▼               ▼               ▼
            relay      failed_workflows    resume-thread
                              │               │
                              ▼               ▼
                           DLQ / replay    continue graph
                              │
                              ▼
                         metrics / alerts
```

---

## 4. Work packages (implement in this order)

### Package A — Error classification  
**Priority:** P0 · **Time:** ~2–4 days

**Problem today:** If a node throws, pg-boss just retries. We don’t say *why*.

**Build:**

| Item | Detail |
|------|--------|
| Error kinds | `TRANSIENT` (retry), `PERMANENT_INPUT` (bad payload / 4xx), `PERMANENT_SYSTEM` (bug / 5xx / unknown) |
| Mapper | Map HTTP status / known messages → kind (start with Syntra HTTP errors) |
| Runner behavior | Transient → throw (pg-boss retry). Permanent → record failure + ack (don’t infinite retry) |
| Tests | Unit tests for classifier |

**Files to add/change (expected):**
- `packages/orchestrator/src/errors/kinds.ts` (new)
- `packages/orchestrator/src/errors/classify.ts` (new)
- `packages/orchestrator/src/workflow/runner.ts` (use classifier)
- `apps/worker/src/workers/module-execute.worker.ts` (handle permanent vs throw)
- `apps/worker/src/bootstrap-pgboss.ts` (dispatch / bridge same rules)

**Done when:** A fake 400 vs timeout behave differently in logs + tests.

---

### Package B — Failed workflows + DLQ mirror  
**Priority:** P0 · **Time:** ~2–3 days

**Problem today:** Failed jobs live only in pg-boss state / logs.

**Build:**

| Item | Detail |
|------|--------|
| Table `failed_workflows` | org, event_id, graph_key, graph_version, job_id, error_kind, message, payload snapshot, created_at |
| Write on permanent failure | From runner / worker |
| Optional: copy exhausted DLQ jobs | Mirror `orchestration.dispatch.dlq` (and module DLQs if added) into the table |
| Simple query doc | SQL to list last 50 failures |

**Files to add/change (expected):**
- `packages/db/migrations/V__failed_workflows.sql` (new)
- `packages/orchestrator/src/ops/failed-workflows.ts` (new insert helper)
- Worker paths that catch permanent errors
- `PHASE_2` / ops section in docs

**Done when:** You can break a job on purpose and see a row in `failed_workflows`.

---

### Package C — Replay tooling  
**Priority:** P1 · **Time:** ~1–2 days (thin) or ~3 days (nice)

**Problem today:** No safe “run this again” tool.

**Build (thin first):**

| Item | Detail |
|------|--------|
| Replay API or script | Re-enqueue same envelope to `orchestration.ingress` **or** module queue |
| Respect version pin | Reuse original `graph_key` / `graph_version` if present |
| Idempotency note | Document: may re-call Syntra; Syntra must tolerate retries where possible |
| Guardrails | Require org + event_id; don’t replay terminal completion events by accident |

**Files to add/change (expected):**
- `apps/api/src/routes/replay.ts` or `packages/orchestrator/scripts/replay-event.ts`
- Optional: `POST /v1/replay` with auth later

**Done when:** One failed JD event can be replayed and shows `[Router]` / `[Module]` again.

---

### Package D — Metrics & observability spine  
**Priority:** P1 · **Time:** ~2–4 days

**Problem today:** Mostly `console.log`.

**Build (start simple — no need for full Prometheus day 1):**

| Metric | Plain meaning |
|--------|----------------|
| `workflow_started` / `completed` / `failed` | Counts by graph_key |
| `node_duration_ms` | How long each step took |
| `queue_oldest_age_seconds` | How stale the oldest job is |
| `outbox_pending_count` | Unpublished outbox rows |
| Correlation | Always log `event_id`, `org_id`, `job_id`, `graph_key@version` |

**Implementation options (pick one for Phase 2):**
1. **Structured JSON logs** + SQL dashboards (fastest)
2. Simple in-process counters + `/metrics` scrape later
3. OpenTelemetry hooks (heavier)

**Files to add/change (expected):**
- `packages/orchestrator/src/obs/logger.ts` or `metrics.ts` (new)
- Wrap nodes in `GraphCompiler` compile loop (time each node)
- Worker bootstrap: periodic outbox/queue age log
- Optional: `apps/api` `GET /health` expands to deps check

**Done when:** One successful run prints durations; one failure is grep-able by `event_id`.

---

### Package E — Human gate (`human.gate`) + resume  
**Priority:** P0 for design completeness · **Time:** ~3–5 days

**Problem today:** No pause for a human. Graphs are auto fire-and-forget.

**Build:**

| Item | Detail |
|------|--------|
| Node `human.gate` | Registered in `nodeRegistry` |
| Behavior | Interrupt / wait for external decision (approve / reject / modify) |
| Storage | Approval id + thread_id link (may reuse existing approvals ideas in DB, or a thin `orchestration_approvals` table) |
| Resume API | `POST /v1/threads/:threadId/resume` with decision payload |
| Checkpointer | Resume uses existing LangGraph checkpoint (`invoke` after decision) |
| Recipe example | Optional tiny `.def.ts` demo graph with a gate (test org only) |

**Design rules to respect:**
- Progress key stays worker-minted / stable (`orgId:job.id` or documented equivalent)
- Decision is an event (or API) that **resumes** — does not start a new unrelated graph blindly

**Files to add/change (expected):**
- `packages/orchestrator/src/nodes/human-gate.ts` (new)
- `packages/orchestrator/src/nodes/registry.ts` (register)
- `apps/api` resume route
- Migration if new table needed
- `graphs/defs/` example + seed (optional)

**Done when:** A test graph pauses, you approve via API, and it continues to `__end__`.

---

### Package F — Checkpoint retention prune  
**Priority:** P2 · **Time:** ~1 day

**Problem today:** Checkpoints grow forever.

**Build:**
- Scheduled job / script: delete LangGraph checkpoint rows older than N days (config, e.g. 30)
- Only delete completed / abandoned threads (document rule)
- Log how many rows pruned

**Files to add/change (expected):**
- `apps/worker/src/workers/checkpoint-prune.worker.ts` (new) or cron script
- Env: `CHECKPOINT_RETENTION_DAYS`

**Done when:** Dry-run + real prune logs a count without breaking active jobs.

---

### Package G — Hardening polish (small but useful)  
**Priority:** P2 · **Time:** ~1–2 days

| Item | Detail |
|------|--------|
| Stricter ingress payloads | Zod per `event_type` (at least JD/resume/match) |
| Same-tx note / improve | Document limitation; improve if feasible with boss + pool |
| Module queue DLQs | Align retry/DLQ with dispatch |
| Clean stub files | Delete or implement empty `runbooks/*`, `policy/*` stubs |
| Ops runbook | “What to do when X fails” in this file or `OPS.md` |

---

## 5. Suggested schedule (2-week solid plan)

| Day | Focus |
|-----|--------|
| 1–2 | Package A — error kinds + wire runner/workers |
| 3–4 | Package B — `failed_workflows` table + writes |
| 5 | Package C — thin replay script/API |
| 6–7 | Package D — structured metrics/logs + node timers |
| 8–11 | Package E — `human.gate` + resume API |
| 12 | Package F — checkpoint prune |
| 13–14 | Package G — polish, tests, docs, verify checklist |

*Thin Phase 2 (~1.5 weeks):* A + B + thin C + basic D + skip or stub E.  
*Full Phase 2 (~3 weeks):* all packages including a solid human gate.

---

## 6. What we already have (don’t rebuild)

Reuse Phase 1:

| Piece | Where |
|-------|--------|
| Front door | `acceptPlatformEvent`, `apps/api` |
| Router / modules | `ingress-router.worker`, `module-execute.worker` |
| Version pin | `version-pin.ts`, relay stamps |
| Org DB helper | `withOrgConnection` |
| Node toolbox | `createNodeCtx` |
| Recipes | `graphs/defs/*.def.ts` |
| Outbox + relay | `WorkflowRunner`, `outbox-relay.worker` |
| Checkpointer / resume invoke | `WorkflowRunner` + PostgresSaver |
| Dispatch DLQ name | `orchestration.dispatch.dlq` (config exists; mirror incomplete) |

---

## 7. Out of scope for Phase 2 (Phase 3+)

- `cv.summarize`, `cv.embed`, `jd.match` as real in-orchestrator nodes  
- Share / interview product modules  
- Replacing Syntra HTTP with full local AI pipeline  
- Fancy UI dashboards (metrics can be logs/SQL first)  
- Kafka / Recruiter Copilot  

---

## 8. Acceptance checklist (copy when verifying)

### Errors
- [ ] Transient error retries in pg-boss  
- [ ] Permanent input failure does **not** retry forever  
- [ ] Failure row appears in `failed_workflows`  

### Replay
- [ ] Replay reuses graph version pin  
- [ ] Replay shows Router/Module (or documented path)  

### Metrics
- [ ] Node duration visible in logs (or metrics endpoint)  
- [ ] Can find a run by `event_id` in logs  

### Human gate
- [ ] Graph pauses at `human.gate`  
- [ ] Resume API continues to completion  
- [ ] Reject path ends cleanly / emits expected event  

### Prune
- [ ] Prune job runs without deleting active threads  

### Docs
- [ ] This file updated to ✅ with evidence (dates + log snippets)  
- [ ] `plan.md` / `STATUS_TRACKER.md` scores updated  

---

## 9. Env / config Phase 2 will likely add

| Env | Purpose |
|-----|---------|
| `CHECKPOINT_RETENTION_DAYS` | Prune age |
| `METRICS_ENABLED` | Optional toggle |
| `HUMAN_GATE_TIMEOUT_HOURS` | Expire waiting approvals (optional) |
| API auth later | Protect `/v1/replay` and `/v1/threads/.../resume` |

Keep existing: `DATABASE_MIGRATOR_URL`, `DATABASE_RELAY_URL`, `SYNTRA_API_URL`.

---

## 10. Risks & decisions (decide early)

| Topic | Options | Recommendation |
|-------|---------|----------------|
| Metrics backend | Logs only vs Prometheus | Start **logs + SQL**; add scrape later |
| Human gate storage | New table vs reuse approvals domain | New thin `orchestration_approvals` unless domain table already fits |
| Permanent failures | Ack vs DLQ | **Ack + `failed_workflows`** so queues don’t jam; DLQ for exhausted retries |
| Replay safety | Always allowed vs admin-only | Admin/script first; HTTP with auth later |
| Syntra non-idempotent calls | Replay may double-process | Document; prefer Syntra-side idempotency keys when possible |

---

## 11. How Phase 2 touches the live path

```text
POST /v1/events
  → ingress → router → module.*
       │
       ├─ on success → outbox → relay          (Phase 1)
       ├─ on failure → classify → failed_workflows / retry   (Phase 2 A/B)
       └─ on human.gate → pause → resume API → continue      (Phase 2 E)

Background:
  metrics ticks, checkpoint prune, optional DLQ mirror        (Phase 2 D/F/B)
```

---

## 12. Docs to update when Phase 2 lands

| Doc | Update |
|-----|--------|
| `PHASE_2.md` | Mark packages ✅ + verification notes |
| `plan.md` | Phase 2 status / next = Phase 3 |
| `STATUS_TRACKER.md` | Errors, human gate, metrics rows |
| `ORCHESTRATOR_AUDIT.md` | Hardening section |
| `WORKFLOW_MAP.md` | Add failure + human-gate branches |
| Optional `OPS.md` | Operator playbook |

---

## 13. Bottom line

**Phase 2 is the “production toughness” layer on top of the Phase 1 skeleton.**

Implement in order:  
**errors → failed table → replay → metrics → human gate → prune → polish.**

When those are verified, Phase 2 is done — then Phase 3 can grow real product nodes beyond Syntra HTTP.

---

*This is an implementation plan, not completed work. Start with Package A when ready.*
