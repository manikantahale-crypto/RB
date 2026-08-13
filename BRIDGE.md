# Syntra → orchestrator ingress

**Updated:** 2026-08-13 — dual-queue bridge **removed**. Front door only.

## Path (only supported)

```text
Syntra UI upload
  → syntra.jobs / syntra.resumes (domain)
  → ORCH_API_URL set: POST http://localhost:4100/v1/events
       (syntra.jd.received | resume.received | match.requested)
  → event_outbox (published_at NULL)
  → outbox-relay (sole pg-boss publisher; job insert + published_at same TX)
       graph events  → orchestration.ingress → [Router] → module.*
       terminal/etc  → orchestration.dispatch
  → LangGraph nodes (syntra.ts may HTTP back to Syntra :4000)
```

**Processes:** orch worker + orch API + Syntra API.  
**No** `jd.uploaded` / `resume.uploaded` / `match.requested` consumers in orch.

Smoke/curl is only a stand-in producer when Syntra isn’t posting yet.

## Env cheatsheet

| Var | Where | Meaning |
|-----|--------|---------|
| `ORCH_API_URL=http://localhost:4100` | Syntra `.env` | **Required** — publish platform events to orch |
| `ORCH_ORGANIZATION_ID` | Syntra `.env` | Tenant uuid on envelopes |
| `ORCH_STUB_SYNTRA=1` | Orch worker | Fake Syntra HTTP inside `syntra.ts` |

`ENABLE_SYNTRA_BRIDGE` is **ignored** (removed). Setting it logs an error and does nothing.

## Permissions (as postgres)

```text
packages/db/scripts/grant-orch-runtime.sql
```

Also covered by Flyway `R__orch_runtime_grants.sql` + `R__seed_event_schemas.sql`
(includes `syntra.match.requested`).
