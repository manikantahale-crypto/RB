# Orchestration Backbone — Working Skill

**Repo root for this skill:** `orchaestration/`  
**Branch to verify first:** `feature/syntra-orch-worker` at  
`C:\Users\SUNITHA\Downloads\Orchaestration-benchsales\orchaestration`  
(Do not trust prior chat reports — re-run `git branch --show-current` and `pwd`.)

This file is the durable operating manual for every future code change in this
orchestrator. Prefer updating **this file** when architecture decisions change,
rather than re-deriving rules from chat history.

**Companion docs:** `FRONT_DOOR.md`, `BRIDGE.md`, `apps/admin/BUILDER_GUIDE.md`,
`PHASE_1.md` / `PHASE_2.md` / `PHASE_3.md`, `../DESIGN_PLAN.md`

**Last updated:** 2026-08-15 (Admin Authoring Layer + DB routing bindings)

---

## 1. What this system is

A **plug-and-play orchestration backbone**, not a Syntra app — plus an **Admin
Authoring Layer** so non-engineers can write policy in natural language, generate
workflow graphs, and go live without editing JSON in the DB by hand.

| Layer | Lives in | Contains |
|-------|----------|----------|
| **Node registry** | Code (git) | Named node implementations (`syntra.*`, `human.gate`, …) |
| **Graph definition** | DB (`graph_definitions`) | Topology JSON only (nodes/edges/config) |
| **Graph compiler** | Code (`GraphCompiler`) | Validate + hydrate → LangGraph |
| **Event routing** | DB (`graph_event_bindings`) | `event_type` → `graph_key` + `module_queue` |
| **Agent policy (authoring)** | DB (`agent_policies`, `agent_versions`) | Prompt, tools, trigger, generation trace |
| **Ingress** | API + `accept-platform-event` | Zod → `event_outbox` (`published_at` NULL) |
| **Relay** | `outbox-relay.worker` | **Sole** pg-boss publisher |
| **Router / modules** | worker | Resolve binding → pin version → run graph |

**Admin does not call the worker.** Builder UI → `admin-api` writes authoring
tables; compile/publish/activate materializes `graph_definitions` and upserts
`graph_event_bindings`. The worker reads those tables when real events arrive.

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
**Deprecated / removed:** `ENABLE_SYNTRA_BRIDGE` — dual-queue bridge deleted; Syntra must use `ORCH_API_URL` → `/v1/events`.

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
| `graph_definitions` | Runtime recipes (compiled from authoring or seeds) |
| `graph_event_bindings` | **Ingress routing** — which graph runs for each `event_type` |
| `agent_definitions` | Agent catalog row (name, tools contract) |
| `agent_templates` | Product agent display names (SYNTRA, Copilot, Intake, ASTRA, …) |
| `agent_policies` | Authoring policy JSON + status (`draft`→`generated`→`compiled`→`active`) |
| `agent_versions` | Generated artifact + `meta` trace (LLM mode, thresholds, warnings) |
| `orch.runs` / `orch.steps` | Execution audit (always) |
| `agent_runs` / `agent_steps` | Design audit (needs GRANT) |
| `pgboss.*` | Queue job tracking |
| LangGraph checkpoints | Resume / human.gate state |

**Two spines (do not confuse):**

- **Authoring:** `agent_policies` / `agent_versions` — what admins edit in Builder.
- **Runtime:** `graph_definitions` + `graph_event_bindings` — what the router uses.

Make live = compile artifact → publish `graph_definitions` → activate binding for
trigger event. Hardcoded `EVENT_TO_GRAPH` in code is **deprecated** (empty); router
uses `resolveActiveEventBinding` only.

`syntra.ts` = HTTP peer node, **not** ingress. Node `config` (e.g. `matchThreshold`,
`rerank`) is passed from graph JSON to Syntra HTTP when present.

---

## 7. Permissions operator must apply

As **postgres** (Supabase SQL editor):

| Script | When |
|--------|------|
| `packages/db/scripts/grant-orch-runtime.sql` | Worker + ingress API + **outbox relay** (needs UPDATE on `event_outbox`) |
| `packages/db/scripts/grant-admin-builder.sql` | Admin Builder (create agent, policies, go-live) |

`grant-orch-runtime.sql` grants migrator SELECT on `agent_definitions` /
`event_schemas`, INSERT on `event_schemas`, DML on `agent_runs` / `agent_steps`,
and ensures `syntra.match.requested` schema row exists.

Without orch grants: `permission denied`; **outbox relay DISABLED** → events
stuck in `event_outbox` even if Syntra POSTs 202; `agent_runs` fail-open → use
`orch.runs` only.

Without admin grants: Create Agent / go-live fails in `admin-api`.

---

## 8. How to run / see logs

```powershell
# Kill stray node listeners on 4000/4100/4200/5173 first if needed

# Admin Builder (UI + API in one terminal)
npm run dev:admin          # :4200 API, :5173 UI → /builder

# Orch worker + ingress API (stub Syntra HTTP if :4000 down)
$env:ORCH_STUB_SYNTRA="1"
npm start                  # worker — confirm OutboxRelay NOT DISABLED
npm run start -w @tekisho/api   # :4100 POST /v1/events

# Prove generate → DB (real Gemini when LLM_PROVIDER=gemini in .env):
npm run smoke:generate-threshold

# Prove orch spine with synthetic inputs (Relay/Router/Module):
npm run demo:flow

# Syntra connected (UI uploads → orch):
# Syntra .env: ORCH_API_URL=http://localhost:4100, ORCH_ORGANIZATION_ID=<uuid>
# Restart Syntra — local jd/resume/match workers skipped when ORCH_API_URL set
```

**Upload → live agent (example DB state — verify with `node scripts/check-admin-status.mjs`):**

| Syntra action | Event | Typical bound agent |
|---------------|-------|---------------------|
| JD upload | `syntra.jd.received` | SYNTRA (`syntra.authored`) |
| Resume upload | `syntra.resume.received` | Intake (`intake.authored`) |
| Match request | `syntra.match.requested` | Copilot (`copilot.authored`) |

Only agents with **active** `graph_event_bindings` run. Draft/mock agents (ASTRA,
ORBIT, HELIX, …) do nothing until go-live.

Worker logs to expect after upload: `[OutboxRelay] published` → `[Router] ingress …`
→ `[Router] … → module.*` → `[Module]`.

Idle bootstrap logs only mean **no unpublished outbox rows / no producer / relay disabled**.

---

## 9. Checklist before finishing a change

- [ ] Branch/pwd verified
- [ ] Ingress still outbox-only (relay publishes)
- [ ] Topology = new version + promote (never UPDATE active `graph_definitions`)
- [ ] Event routing = `graph_event_bindings` upsert on go-live (not code map)
- [ ] Generate preview does not write DB until Accept; go-live writes runtime tables
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
| Routing plan (terminal/resume/fail kinds) | `packages/orchestrator/src/routing/table.ts` |
| DB event bindings | `packages/authoring/src/event-bindings.ts` |
| Outbox relay | `apps/worker/src/workers/outbox-relay.worker.ts` |
| Router (bindings only) | `apps/worker/src/workers/ingress-router.worker.ts` |
| Module workers | `apps/worker/src/workers/module-execute.worker.ts` |
| Runner + audit | `packages/orchestrator/src/workflow/runner.ts`, `agent-runs.ts` |
| Syntra HTTP nodes + config | `packages/orchestrator/src/nodes/syntra.ts` |
| Policy engine (runtime gate) | `packages/orchestrator/src/policy/engine.ts` |
| Admin UI | `apps/admin/src/pages/PolicyEditor.tsx`, `PlatformOrchestrationPanel.tsx` |
| Admin API generate/go-live | `apps/admin-api/src/routes/agents.ts` |
| LLM graph generation | `packages/authoring/src/generate-graph-from-llm.ts`, `build-graph-prompt.ts` |
| Template graphs + mock agents | `packages/authoring/src/template-catalog.ts`, `product-agent-defaults.ts` |
| Go-live gate | `packages/authoring/src/go-live-gate.ts` |
| Generation audit meta | `packages/authoring/src/generation-meta.ts` |
| Duplicate-policy warning | `packages/authoring/src/request-scope.ts` |
| Grants | `packages/db/scripts/grant-orch-runtime.sql`, `grant-admin-builder.sql` |
| Smoke: threshold 94 | `scripts/smoke-generate-threshold.ts` |
| DB status snapshot | `scripts/check-admin-status.mjs` |
| Syntra publisher | `../syntra-backend/.../node-api/src/services/orchPublisher.js` |
| Ingress API | `apps/api/src/index.ts` |
| Domain events | `packages/domain/events/platform-event.ts` |

---

## 11. Admin Authoring Layer (2026-08-11 → 08-15)

### Authoring flow (Builder UI)

```text
Policy textarea (+ tools, trigger event)
  → Generate (preview: true, mode llm|template)   # no DB until Accept
  → Accept & save → agent_policies + agent_versions (generated)
  → Compile → compiled
  → Make live → graph_definitions (new version) + graph_event_bindings (active)
```

- **Preview is not saved** — UI must show “not saved” until Accept.
- **Explainer values** come from graph JSON / generation meta, not keyword guesses
  from policy text.
- **Platform overview** (`PlatformOrchestrationPanel`) shows overall orchestration
  narrative for naive admins.

### Product agents (seeded)

SYNTRA, Intake, Copilot (functional templates) + mock peers ASTRA, ORBIT, HELIX,
TEMPO, PRISM, TAYLN (draft policies only until authored and go-live).

### Proven with real LLM

`npm run smoke:generate-threshold` — policy “threshold 94” → `matchThreshold: 94`
in generation trace, `agent_versions`, and `graph_definitions` after compile.

### Runtime policy engine

`PolicyEngine` loads `agent_definitions` for autonomy gates at node execution.
Full “autonomous execution purely from policy text” is **partial** — topology and
node config come from `graph_definitions`; policy drives authoring and gates, not
per-step LLM replanning at runtime.

---

## 12. Lead goals vs current coverage (honest)

| Lead / design ask | Status |
|-------------------|--------|
| Plug-and-play backbone (registry + DB graphs + compiler) | **Done** — proven Phase 1 |
| Transactional outbox + relay + ingress router + module workers | **Done** — relay needs DB grants |
| Syntra as peer (`ORCH_API_URL`, `syntra.ts`, no bridge) | **Done** |
| Version pin at enqueue, checkpoint resume | **Done** |
| Admin: NL policy → LLM → `graph.json` in DB, traceable | **Done** — preview/accept/go-live |
| Admin UI simplified for naive admins | **Done** — policy box, platform panel |
| DB-stored policies, versions, bindings | **Done** |
| Go-live binds event → authored graph | **Done** — multiple agents on different events |
| Demonstrate threshold 94 end-to-end in DB | **Done** — smoke test + trace |
| Mock product agents like SYNTRA family | **Done** — seeded draft |
| Syntra UI upload → correct live agent runs | **In progress** — needs relay grants + E2E upload test |
| Full design doc (share, interview, all §4 design nodes) | **Not done** — Phase 3 |
| Phase 2 hardening (failed_workflows ops, metrics, human gate resume) | **Partial** — `human.gate` in catalog; Phase 2 mostly open |
| Runtime fully autonomous from policy without compiled graph | **Not done** — by design (graph = wiring in DB) |
| Every agent_runs / trace polished in admin UI | **Partial** |

**Rough completion:** backbone ~**75%**, authoring layer ~**80%**, full hiring-assistant
design doc ~**45–50%** (Phases 2–3 + extra modules remain).
