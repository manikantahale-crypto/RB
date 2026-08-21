# Demo guide — SYNTRA + ASTRA + Orchestration

Present a live demo at **http://localhost:3000** with orchestration logs in the worker terminal.

---

## 1. Start stack (4 terminals)

```powershell
cd orchaestration

# T1 — Orchestrator worker (KEEP RUNNING — all logs appear here)
npm run dev:worker

# T2 — Orch ingress API (trace + thread resume)
npm run dev:orch-api

# T3 — Syntra backend
npm run dev:syntra-api

# T4 — Syntra UI
npm run dev:syntra-ui
```

Optional Admin (agent go-live):

```powershell
npm run dev:admin-api
npm run dev:admin-ui   # http://localhost:5173
```

---

## 2. Fix `.env` before demo

Use **one value per variable** (your file currently duplicates keys — last line wins).

| Variable | Recommended |
|----------|-------------|
| `DATABASE_URL` | Single Supabase postgres URL |
| `ORCH_ORGANIZATION_ID` | One UUID that exists in `organizations` |
| `AI_PROVIDER` | `openrouter` |
| `AI_API_KEY` | Your OpenRouter key |
| `AUTH_JWT_SECRET` | One secret (login breaks if API restarts with different secret) |
| `PLATFORM_EVENTS_ENABLED` | `1` |
| `ORCH_DELEGATE_MATCH` | `1` |
| `ORCH_STUB_SYNTRA` | `0` |
| `PYTHON_SERVICE_URL` | **Unused** — no Python service required |

Verify:

```powershell
npm run demo:verify
```

---

## 3. How Admin changes the flow

```
Admin Builder → Compile → Go live
       ↓
graph_event_bindings (event_type → graph_key, agent_id)
       ↓
Worker [Router] picks binding on each platform event
       ↓
Graph tools call Syntra /internal/* HTTP
```

**Only one active agent per event type.** Go-live retires the previous binding.

| Event | Default seed graph | Agent |
|-------|---------------------|-------|
| `astra.requirement.received` | `astra.requirement.workflow` | 504 |
| `syntra.jd.parsed` | `syntra.continuous.match` | 501 |
| `syntra.match.requested` | `syntra.match.workflow` | 501 |
| `syntra.profile.prepared` | `syntra.duplicate.detect` | 502 |
| `syntra.jd.normalized` | `syntra.authored` | 501 |

Custom agent (e.g. Syntra4): set trigger `syntra.match.requested` → Go live → worker logs `agent=<your-uuid>`.

---

## 4. Demo script A — automated (no browser)

```powershell
npm run demo:syntra-astra
```

This mirrors UI actions:

1. Login / signup demo user  
2. Upload sample JD + resume (`scripts/fixtures/`)  
3. Poll until AI completes  
4. Bulk-save to library  
5. ASTRA email intake  
6. Print recent `event_outbox` + bindings  

Watch **T1 worker** while the script runs.

---

## 5. Demo script B — UI walkthrough (presenter)

| Step | UI | Backend / orch |
|------|-----|----------------|
| 1 | Login at `:3000` | `POST /auth/login` |
| 2 | **Upload & Analyze** → JD tab → Analyze | `POST /jobs` → `jd.uploaded` worker |
| 3 | Wait for green/processed | `[platformEvents] EMIT syntra.jd.parsed` |
| 4 | **Save to Library** | `[job.save] re-running funnel` |
| 5 | Resume tab → upload CV → Analyze | `syntra.profile.prepared` |
| 6 | **AI Workspace** → pick Active job | `GET /jobs/:id/matches` |
| 7 | (Optional) ORBIT Jobs → Poll emails | ASTRA `astra.requirement.received` |
| 8 | Bell icon if human review | `GET /recruiter/reviews/pending` |

---

## 6. Demo script C — orchestrator-only smoke

```powershell
npm run demo:flow
# includes astra.requirement.received + syntra jd/resume/match
```

---

## 7. Log cheat sheet (worker terminal)

```
[Relay] PUBLISH <event> → orchestration.ingress
[Router] INGRESS <event> producer=… correlation=…
[Router] ROUTE <event> → graph=<name>@<ver> agent=<uuid> binding=seed|authoring
[Module] START queue=module.… graph=…
[WorkflowRunner] invoke <graph> event=… corr=…
[WorkflowRunner] EMIT graph=… → outbox syntra.match.requested …
[Dispatcher] terminal syntra.match.completed …
```

**node-api terminal:**

```
→ POST /jobs …
[jd.uploaded] job … parsed and embedded
[platformEvents] EMIT syntra.jd.parsed …
[internal] continuous-match …
[recruiterReview] synced inbox …
```

---

## 8. Backfill older jobs

```powershell
npm run backfill:jd-parsed -- --dry-run
npm run backfill:jd-parsed -- --limit=10
```

---

## 9. Troubleshooting

| Symptom | Fix |
|---------|-----|
| No `[Relay]` logs | Start `dev:worker`; keep it running |
| No `[platformEvents] EMIT` | Restart `dev:syntra-api` |
| `[Router] no active DB binding` | Run worker once (seeds bindings) or go-live in Admin |
| Match Hub empty | Real resume (not JD on wrong tab), Save to Library |
| 401 on uploads | Re-login in UI (JWT secret changed) |
| ASTRA email no orch | Check `event_outbox` for `astra.requirement.received` |

---

## 10. Two parallel product flows

### SYNTRA-native (upload UI)

```
Upload → AI worker → syntra.jd.parsed
  → continuous.match (501) → funnel → syntra.match.requested
  → match.workflow (501 or your agent) → LLM score → Match Hub
```

### ASTRA-native (email / job boards)

```
Email intake / job board → astra.requirement.received
  → astra.requirement.workflow (504) → quality → branch → normalize
  → syntra.jd.normalized → syntra.authored (501) → matching
```

Both converge on **Syntra HTTP tools** and **`event_outbox` → worker router**.
