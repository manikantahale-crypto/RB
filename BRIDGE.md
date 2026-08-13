# Syntra bridge ON vs OFF

**Updated:** 2026-08-11 — bridge is **retired by default**. Prefer Syntra → `ORCH_API_URL` → `POST /v1/events`.

## Bridge OFF (default — correct design)

```text
Syntra UI upload
  → syntra.jobs / syntra.resumes (domain)
  → if ORCH_API_URL set: POST http://localhost:4100/v1/events
       (syntra.jd.received | resume.received | match.requested)
  → event_outbox (published_at NULL)     ← single DB write story
  → outbox-relay (only pg-boss publisher)
       graph events  → orchestration.ingress → [Router] → module.*
       terminal/etc  → orchestration.dispatch
  → LangGraph nodes (syntra.ts may HTTP back to Syntra :4000)
```

**Processes:** orch worker + orch API + Syntra API.  
**No shared queue consumers.** No `[Bridge]` logs.  
Smoke/curl is only a stand-in producer when Syntra isn’t posting yet.

## Bridge ON (`ENABLE_SYNTRA_BRIDGE=1` — deprecated)

```text
Syntra UI upload
  → getBoss().send("jd.uploaded" | "resume.uploaded" | "match.requested")
  → BOTH Syntra workers AND orch Bridge consume the SAME queues
  → orch skips ingress; runs graph from Bridge handler
```

**Why it felt “alive”:** UI click → immediate `[Bridge] Received…` in one worker terminal.  
**Why it was retired:** dual consumers exhaust Supabase session pool; skips transactional outbox; duplicate processing risk.

Use **only** for emergency debugging with exactly one Syntra + one orch worker.

## Env cheatsheet

| Var | Where | Meaning |
|-----|--------|---------|
| `ORCH_API_URL=http://localhost:4100` | Syntra `.env` | Publish platform events to orch |
| `ORCH_ORGANIZATION_ID` | Syntra `.env` | Tenant uuid on envelopes |
| `ENABLE_SYNTRA_BRIDGE=1` | Orch worker | Deprecated dual-queue bridge |
| `ORCH_STUB_SYNTRA=1` | Orch worker | Fake Syntra HTTP inside `syntra.ts` |

## Permissions you must run (as postgres)

```text
packages/db/scripts/grant-orch-runtime.sql
```

Grants `syntra_migrator` SELECT on `agent_definitions` / `event_schemas`, INSERT on `event_schemas`, and DML on `agent_runs` / `agent_steps`. Also seeds `syntra.match.requested` into `event_schemas`.
