# Front door (ingress + router)

**Updated:** 2026-08-11

## Path (transactional outbox)

```text
POST /v1/events  (API :4100)  or  Syntra ORCH_API_URL publisher
      │
      ▼
event_outbox  (published_at NULL)     ← ingress write only
      │
      ▼
outbox-relay  (sole pg-boss publisher)
      ├─ graph events  → orchestration.ingress → [Router] → module.*
      └─ terminal/resume/fail → orchestration.dispatch
      │
      ▼
LangGraph + orch.runs/orch.steps (+ agent_runs when GRANTed)
GET /v1/trace/:eventId
```

See also [BRIDGE.md](./BRIDGE.md) for bridge ON/OFF.

## Run

```powershell
cd ...\orchaestration

# One-time as postgres (Supabase SQL): packages/db/scripts/grant-orch-runtime.sql

# Terminal 1 — worker
$env:ORCH_STUB_SYNTRA="1"   # optional without Syntra :4000
npm start

# Terminal 2 — API
npm run start -w @tekisho/api

# Terminal 3a — smoke (no Syntra)
npm run smoke:e2e -- --jd

# OR Terminal 3b — Syntra with orch publish
# In Syntra .env: ORCH_API_URL=http://localhost:4100
# Then Syntra UI upload → orch logs [Router]/[Module]
```

## Permissions

If you see `permission denied for table event_schemas|agent_definitions|agent_runs`, run as **postgres**:

`packages/db/scripts/grant-orch-runtime.sql`

Expect `202` + worker logs: `[Router]` then `[Module]`.

After admin **Make this live** for the Syntra agent, JD events route to
`syntra.authored` when that definition is active. If none is active, the router
falls back to seed `syntra.jd.workflow`.

## Verified live (2026-08-10)

- API returned **202** for `POST /v1/events`
- Worker: `[Router] ingress syntra.jd.received` → `[Router] → module.syntra.jd` → `[Module]`
- Job used: `b4cb2200-3aff-4f89-85a6-ec981f5b5ff7`
- Syntra process may still need OpenRouter for a full AI finish — front door itself is proven

## Soft leftovers (Phase 1)

_Resolved 2026-08-13:_

- Outbox relay uses pg-boss `{ db }` so job insert + `published_at` commit together on the shared migrator pool
- `syntra.match.requested` seeded in `R__seed_event_schemas` / `R__orch_runtime_grants`; bootstrap ensure is quiet when already present
- Syntra dual-queue bridge removed — front door (`ORCH_API_URL` → `/v1/events`) only

See [BRIDGE.md](./BRIDGE.md).