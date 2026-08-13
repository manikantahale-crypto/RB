# Orchestration Backbone — Working Skill

**Repo root for this skill:** `orchaestration/`  
**Branch to verify first:** `feature/syntra-orch-worker` at  
`C:\Users\SUNITHA\Downloads\Orchaestration-benchsales\orchaestration`  
(Do not trust prior chat reports — re-run `git branch --show-current` and `pwd`.)

This file is the durable operating manual for every future code change in this
orchestrator. Prefer updating **this file** when architecture decisions change,
rather than re-deriving rules from chat history.

**Companion docs:** `FRONT_DOOR.md`, `BRIDGE.md`, `../DESIGN_PLAN.md`

---

## 1. What this system is

A **plug-and-play orchestration backbone**, not a Syntra app.

| Layer | Lives in | Contains |
|-------|----------|----------|
| **Node registry** | Code (git) | Named node implementations |
| **Graph definition** | DB (`graph_definitions`) | Topology JSON only |
| **Graph compiler** | Code (`GraphCompiler`) | Validate + hydrate → LangGraph |
| **Ingress** | API + `accept-platform-event` | Zod → `event_outbox` (`published_at` NULL) |
| **Relay** | `outbox-relay.worker` | **Sole** pg-boss publisher |
| **Router / modules** | worker | Pin + run graphs |

Syntra is **one optional peer**: domain tables + HTTP via `nodes/syntra.ts`, and
(when configured) a **client** of `POST /v1/events`.

---

## 2. Mandatory pre-flight (every session)

```text
cd <orchaestration repo root>
git branch --show-current
pwd
```

Confirm `feature/syntra-orch-worker` and `...\orchaestration`. Mismatch → STOP.

---

## 3. Proven pipeline (do not bypass) — 2026-08-11

```text
Producer (smoke | Syntra ORCH_API_URL | curl)
  → POST /v1/events
  → event_outbox (published_at NULL)          # single DB ingress story
  → outbox-relay
       ├─ graph*  → orchestration.ingress → [Router] pin → module.*
       └─ other   → orchestration.dispatch (terminal / resume / fail)
  → WorkflowRunner → nodes (syntra.ts HTTP optional)
  → follow-on rows → event_outbox (NULL) → relay again
  → orch.runs / orch.steps (+ agent_runs when GRANTed)
```

**Retired:** API directly `boss.send(ingress)` after outbox insert.  
**Deprecated:** `ENABLE_SYNTRA_BRIDGE=1` (Syntra + orch share `jd.uploaded` queues).

### Bridge ON vs OFF

| | Bridge OFF (default) | Bridge ON (deprecated) |
|--|----------------------|-------------------------|
| Producer | `POST /v1/events` | Syntra `jd.uploaded` queues |
| Logs | `[Router]` / `[Module]` after relay | `[Bridge] Received…` |
| Pool | Safe | Dual consumers → timeouts |
| Design | Yes | Skips transactional outbox |

Details: `BRIDGE.md`.

### Syntra publish (preferred product path)

In Syntra-backend `node-api` `.env`:

```text
ORCH_API_URL=http://localhost:4100
ORCH_ORGANIZATION_ID=<tenant-uuid>
```

`orchPublisher.js` posts `syntra.jd.received` / `resume.received` / `match.requested`
from `job.service` / `resume.service` / `match.service` / `funnel.js`.  
If unset, Syntra keeps legacy local queues only.

---

## 4. Do NOT rebuild / do NOT touch (unless asked)

- `GraphCompiler`, `nodeRegistry`, `catalog.ts`, policy engine
- Ingress router / module workers / outbox-relay
- Do **not** enqueue pg-boss from `acceptPlatformEvent`
- Do **not** re-enable bridge as the default product path
- Do **not** put Syntra types into compiler/runner core — adapters only

---

## 5. Design invariants (Appendix A)

1. Behavior in git; wiring in DB.
2. Active definitions immutable → new version + promote.
3. **Outbox write is the ingress transaction; relay alone publishes to pg-boss.**
4. Job payload pins `(graph_key, graph_version)` at router/relay enqueue.
5. Writing nodes idempotent; worker DB under `SET LOCAL app.org_id`.
6. No test calls a real LLM.

### Error classes

| Class | Handling |
|-------|----------|
| `transient` | Throw → pg-boss retry |
| `permanent-input` | Soft / ack |
| `permanent-system` | Fail; `failed_workflows` |

---

## 6. Tables (what stores what)

| Table | Purpose |
|-------|---------|
| `syntra.jobs` / `resumes` | Upload domain (Syntra) |
| `event_outbox` | Platform event instances |
| `event_schemas` | Allowed types + payload schemas |
| `graph_definitions` | Recipes |
| `agent_definitions` | Autonomy / tools contracts |
| `orch.runs` / `orch.steps` | Execution audit (always) |
| `agent_runs` / `agent_steps` | Design audit (needs GRANT) |
| `pgboss.*` | Queue job tracking |
| LangGraph checkpoints | Resume / human.gate state |

`syntra.ts` = HTTP peer node, **not** ingress.

---

## 7. Permissions operator must apply

As **postgres** (Supabase SQL editor):

`packages/db/scripts/grant-orch-runtime.sql`

Grants migrator SELECT on `agent_definitions` / `event_schemas`, INSERT on
`event_schemas`, DML on `agent_runs` / `agent_steps`, and ensures
`syntra.match.requested` schema row exists.

Without this: `permission denied` / FK failures on match ingress; `agent_runs`
fail-open → use `orch.runs` only.

---

## 8. How to run / see logs

```powershell
# Kill stray node listeners on 4000/4100 first if needed

# orch worker + API (independent; stub Syntra HTTP if :4000 down)
$env:ORCH_STUB_SYNTRA="1"
npm start
npm run start -w @tekisho/api

# Prove orch with synthetic inputs (watch worker for Relay/Router/Module):
npm run demo:flow

# Syntra connected (UI uploads → orch):
# Syntra .env: ORCH_API_URL=http://localhost:4100
# Restart Syntra — it skips local jd/resume/match workers when ORCH_API_URL is set
```

Idle bootstrap logs only mean **no unpublished outbox rows / no producer**.

---

## 9. Checklist before finishing a change

- [ ] Branch/pwd verified
- [ ] Ingress still outbox-only (relay publishes)
- [ ] Topology = new version + promote
- [ ] Pins honored; RLS `app.org_id`
- [ ] Errors classified at wrapper
- [ ] Syntra remains behind nodes / ORCH_API_URL client
- [ ] Tests pass; update **this file** + `.cursor/skills/orchestration-backbone/SKILL.md`

---

## 10. Key file map (current)

| Concern | Path |
|---------|------|
| Accept ingress | `packages/orchestrator/src/ingress/accept-platform-event.ts` |
| Envelope Zod | `packages/orchestrator/src/ingress/envelope-schema.ts` |
| Routing plan | `packages/orchestrator/src/routing/table.ts` |
| Outbox relay | `apps/worker/src/workers/outbox-relay.worker.ts` |
| Router | `apps/worker/src/workers/ingress-router.worker.ts` |
| Module workers | `apps/worker/src/workers/module-execute.worker.ts` |
| Runner + audit | `packages/orchestrator/src/workflow/runner.ts`, `agent-runs.ts` |
| Syntra HTTP nodes | `packages/orchestrator/src/nodes/syntra.ts` |
| Grants script | `packages/db/scripts/grant-orch-runtime.sql` |
| Syntra publisher | `../syntra-backend/.../node-api/src/services/orchPublisher.js` |
| API | `apps/api/src/index.ts` |
| Domain events | `packages/domain/events/platform-event.ts` |
