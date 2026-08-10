# Front door (ingress + router) — simple guide

**Updated:** 2026-08-10

## What we built

```text
POST /v1/events  (API)
      │
      ▼
validate envelope (Zod)
      │
      ▼
write event_outbox  (company id set; marked published so relay won't double-send)
      │
      ▼
queue: orchestration.ingress
      │
      ▼
ROUTER  → pick workflow + version → module.syntra.*
      │
      ▼
MODULE WORKER → run graph (same as before)
```

## Syntra bridge (still works)

Syntra can still publish to `jd.uploaded` / `resume.uploaded` / `match.requested`.  
That path skips the front door and goes straight to the runner (`[Bridge]` logs).

New producers should use **`POST /v1/events`**.

## How to run

```powershell
# Terminal 1 — worker (router + modules + bridge + relay)
cd C:\Users\Digi\Documents\orchaestration\orchaestration
npm start

# Terminal 2 — ingress API
npm run start -w @tekisho/api
```

## Example request

```powershell
curl -X POST http://localhost:4100/v1/events -H "Content-Type: application/json" -d "{
  \"event_id\": \"11111111-1111-4111-8111-111111111111\",
  \"event_type\": \"syntra.jd.received\",
  \"schema_version\": \"1.0\",
  \"occurred_at\": \"2026-08-10T10:00:00.000Z\",
  \"correlation_id\": \"22222222-2222-4222-8222-222222222222\",
  \"causation_id\": null,
  \"organization_id\": \"2b8e12b3-1745-4ae9-902c-5a249c28ba94\",
  \"aggregate\": { \"type\": \"requirement\", \"id\": \"33333333-3333-4333-8333-333333333333\" },
  \"payload_ref\": { \"jobId\": \"YOUR-JOB-UUID\" },
  \"producer\": \"manual-test\"
}"
```

Expect `202` + worker logs: `[Router]` then `[Module]`.
