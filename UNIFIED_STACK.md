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
ORCH_ORGANIZATION_ID=00000000-0000-0000-0000-000000000001

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

```cmd
node scripts/verify-workflow.mjs
node scripts/db-diagnose.mjs
```

1. Upload JD + **valid resume** in Syntra Front — Analyze succeeds, **Save to Library**.
2. **Restart** `npm run dev:syntra-api` after any code/env change (stale process = no outbox writes).
3. Worker log shows:

```text
[platformEvents] EMIT syntra.jd.parsed ...
[Relay] PUBLISH syntra.jd.parsed → orchestration.ingress
[Router] ROUTE syntra.jd.parsed → graph=syntra.continuous.match@1 ...
[Module] DONE ... emitted=[syntra.match.completed]
[platformEvents] EMIT syntra.match.requested ...
[Router] ROUTE syntra.match.requested → graph=syntra.match.workflow@1 ...
```

4. SQL:

```sql
SELECT event_type, producer, occurred_at, published_at IS NOT NULL AS published
FROM event_outbox ORDER BY occurred_at DESC LIMIT 10;
```

## Backfill JD parsed events (pre-platform-events jobs)

```cmd
node scripts/backfill-jd-parsed.mjs --dry-run
node scripts/backfill-jd-parsed.mjs --limit=20
```

## Recruiter human-review inbox (Syntra Front)

API (authenticated):
- `GET /recruiter/reviews/pending` — syncs from `event_outbox` + `orch.runs` (PARKED)
- `POST /recruiter/reviews/:id/decide` — `{ "approved": true|false, "note": "..." }`

UI: amber banner + bell dropdown when orchestration emits `syntra.approval.requested`, `syntra.duplicate.review_required`, or a run is PARKED.


| Cause | Fix |
|-------|-----|
| **node-api not restarted** after unified merge | Stop and `npm run dev:syntra-api`; confirm startup log shows `platformEvents: true` |
| **Worker not running** | `npm run dev:worker` — relay publishes outbox → ingress |
| **`[platformEvents] failed`** in node-api logs | Run with `PLATFORM_EVENTS_STRICT=1`; fix FK (wrong `ORCH_ORGANIZATION_ID`) |
| **JD never reaches worker** | Empty file, wrong doc type, or AI key missing |
| **`syntra.jd.received` disabled** | Normal — `ORCH_EMIT_JD_RECEIVED=0`; **parsed** comes from worker after AI, not upload |
| **Test script only event** | `scripts/emit-test-jd-parsed.mjs` wrote the 09:54 row; real uploads need restarted API |

## Correct workflow (ORCH_DELEGATE_MATCH=1)

```text
Upload JD → jd.uploaded worker → AI + embedding
  → EMIT syntra.jd.parsed (event_outbox)
  → [orch] syntra.continuous.match → POST /internal/jobs/:id/continuous-match
  → funnel tier1/2 → EMIT syntra.match.requested (per pair)
  → [orch] syntra.match.workflow (or your Syntra4 agent) → POST /internal/matches/process
  → LLM score saved → Match Hub shows candidates

Upload resume → resume.uploaded → AI + embedding
  → EMIT syntra.profile.prepared → duplicate.detect graph
  → local funnel runForResume (pairs resume ↔ jobs)
```

**Data requirements:** resumes must be real CVs (not JDs on wrong tab), `processed` with embedding, same recruiter `created_by` as job, job **Active** in library for Match Hub list.

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
