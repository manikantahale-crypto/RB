# Unified stack — SYNTRA (SAO) + Orchestrator + Admin

Branch: **`feature/unified-sao-orch`**

This branch merges:

- **Orchestrator + Admin** (`apps/*`, `packages/*`) from `orchaestration-admin-llm-UI`
- **Syntra backend + Front** (`node-api/`, `Front/`) from `feature/SAO`
- **Platform event wiring** — `node-api` writes to shared `event_outbox`; orch worker relay routes to admin live graphs

## Architecture

```text
Syntra Front (:3000)
    → node-api (:4000)
        → internal AI workers (jd.uploaded / resume.uploaded)
        → event_outbox (platform events)  ← NEW
            → outbox-relay (orch worker)
            → orchestration.ingress → graph_event_bindings → LangGraph
                → syntra.* nodes HTTP back to node-api /internal/*
Admin UI (:5173) → admin-api (:4200) → compile / go-live → graph_event_bindings
```

## One `.env` at repo root

All services read `orchaestration/.env` (node-api loads `../../../.env`).

Required:

```env
DATABASE_MIGRATOR_URL=postgresql://postgres.../postgres
DATABASE_URL=postgresql://postgres.../postgres
DATABASE_RELAY_URL=postgresql://postgres.../postgres

AUTH_JWT_SECRET=change-me-long-random-string
GEMINI_API_KEY=your-gemini-key
PYTHON_SERVICE_URL=http://localhost:8000

SYNTRA_API_URL=http://localhost:4000
ORCH_API_URL=http://localhost:4100
ORCH_ORGANIZATION_ID=00000000-0000-0000-0000-000000000000

# Platform events (unified defaults)
PLATFORM_EVENTS_ENABLED=1
ORCH_DELEGATE_MATCH=1
ORCH_EMIT_JD_RECEIVED=0

ORCH_STUB_SYNTRA=0
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash
LLM_API_KEY=...
```

| Variable | Meaning |
|----------|---------|
| `PLATFORM_EVENTS_ENABLED=1` | node-api writes `syntra.*` events to `event_outbox` |
| `ORCH_DELEGATE_MATCH=1` | Match scoring runs via orchestrator graph (not internal `match.requested` queue) |
| `ORCH_EMIT_JD_RECEIVED=0` | Skip `syntra.jd.received` on upload (avoids parallel ASTRA + internal JD). Set `1` to trigger ASTRA on upload. |
| `ORCH_STUB_SYNTRA=0` | Orchestrator calls real Syntra HTTP at `SYNTRA_API_URL` |

## Platform events emitted

| When | Event |
|------|-------|
| JD uploaded (optional) | `syntra.jd.received` if `ORCH_EMIT_JD_RECEIVED=1` |
| JD AI complete | `syntra.jd.parsed` |
| Resume uploaded | `syntra.resume.received` |
| Resume AI complete | `syntra.profile.prepared` |
| Funnel shortlists pair | `syntra.match.requested` |

## Run locally (5 terminals)

```cmd
cd orchaestration

REM 1 — Orchestrator worker (required)
npm run dev:worker

REM 2 — Ingress API (smoke / curl / optional HTTP front door)
npm run dev:orch-api

REM 3 — Admin
npm run dev:admin-api
npm run dev:admin-ui

REM 4 — Syntra API
npm run dev:syntra-api

REM 5 — Syntra Front
npm run dev:syntra-ui
```

## Wire your admin agent (Syntra4 example)

1. In Admin, set trigger **`syntra.match.requested`** for match+shortlist workflows.
2. Retire conflicting binding in SQL if go-live returns `EVENT_ALREADY_BOUND`:

```sql
UPDATE graph_event_bindings
SET status = 'retired', updated_at = now()
WHERE event_type = 'syntra.match.requested' AND status = 'active'
  AND agent_id != 'YOUR-SYNTRA4-AGENT-UUID';
```

3. Go live again — confirm:

```sql
SELECT event_type, graph_key, agent_id::text, status
FROM graph_event_bindings
WHERE status = 'active' AND event_type = 'syntra.match.requested';
```

## Verify end-to-end

1. Upload JD + resume in Syntra Front — Analyze succeeds.
2. Worker log shows:

```text
[platformEvents] syntra.match.requested ...
[Router] syntra.match.requested → module.syntra.match your-agent.authored@1
```

3. SQL:

```sql
SELECT event_type, producer, occurred_at FROM event_outbox ORDER BY occurred_at DESC LIMIT 5;
SELECT graph_key, status FROM orch.runs ORDER BY created_at DESC LIMIT 5;
```

## Smoke test (without Syntra UI)

```cmd
npm run dev:worker
npm run dev:orch-api
npm run smoke:e2e -- --match
```

## Git

Branch created locally — **not pushed**. When ready:

```cmd
git push -u origin feature/unified-sao-orch
```
