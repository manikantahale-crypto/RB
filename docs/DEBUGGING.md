# Developer Debugging & Tracing Guide

This guide explains how to enable diagnostic tracing, correlate end-to-end requests across the stack, and use the VS Code debugger in the TEKISHO BenchSales platform.

---

## 1. Enabling & Disabling DEBUG_MODE

Debugging in this repository is strictly **opt-in**. In production, all debug logs remain suppressed to ensure low noise and maximum throughput.

### Enable DEBUG_MODE in PowerShell:
```powershell
$env:DEBUG_MODE="true"
npm run dev:all
```

Or for individual services:
```powershell
# Node API / Syntra with In-Process Relay
$env:DEBUG_MODE="true"
npm run dev:syntra

# API Gateway
$env:DEBUG_MODE="true"
node gateway.js

# Unified Worker
$env:DEBUG_MODE="true"
npm run start -w @tekisho/worker
```

### Enable Client-Side API Debugging:
In the browser DevTools console (on http://localhost:3000):
```javascript
// Toggle client-side request logging in local storage
localStorage.setItem('DEBUG_MODE', 'true');
// Or disable:
localStorage.removeItem('DEBUG_MODE');
```

### Disable DEBUG_MODE:
```powershell
$env:DEBUG_MODE="false"
# or clear the environment variable:
Remove-Item Env:\DEBUG_MODE
```

---

## 2. Request Correlation with `X-Request-Id`

Every request entering the platform receives or preserves a unique correlation ID:
- Header: `X-Request-Id` (or `X-Correlation-Id`)
- Response Header: `X-Request-Id` is exposed via CORS (`Access-Control-Expose-Headers: X-Request-Id`)
- In log output: Tagged as `[request=<id>]`

### Example Request Trace Across Services:

1. **Client (Browser):**
   ```text
   [API DEBUG] POST /submissions/sub-123/consent status=200 duration=412ms requestId=cl-m5a1b2-c3d4e
   ```
2. **Gateway (:8080):**
   ```text
   [GW DEBUG] [request=cl-m5a1b2-c3d4e] POST /submissions/sub-123/consent
   [GW DEBUG] [request=cl-m5a1b2-c3d4e] POST /submissions/sub-123/consent → http://127.0.0.1:4000/submissions/sub-123/consent
   [GW DEBUG] [request=cl-m5a1b2-c3d4e] POST /submissions/sub-123/consent ← 200 duration=408ms
   ```
3. **Node API (:4000):**
   ```text
   [request=cl-m5a1b2-c3d4e] → POST /submissions/sub-123/consent
   [request=cl-m5a1b2-c3d4e] [prism.consent] Controller received request submissionId=sub-123
   [request=cl-m5a1b2-c3d4e] [prism.workflow.consent] Phase 1 DB committed status=DRAFT -> PENDING_CONSENT
   [request=cl-m5a1b2-c3d4e] [relay.adapter.consent] POST http://127.0.0.1:4000/internal/consent/send
   [request=cl-m5a1b2-c3d4e] [relay.consent.send] EmailSenderFactory dispatching candidateId=cand-456
   [request=cl-m5a1b2-c3d4e] [relay.consent.send] Thread and message saved to relay.email_threads
   [request=cl-m5a1b2-c3d4e] [prism.consent] Controller succeeded status=200 duration=395ms
   [request=cl-m5a1b2-c3d4e] ← POST /submissions/sub-123/consent status=200 ms=398
   ```

---

## 3. Tracing the Consent Flow

When debugging candidate consent (`POST /submissions/:id/consent`):
1. **Frontend Request:** Filter browser console for `[API DEBUG] /submissions` to view the initial submission ID and client request ID.
2. **Phase 1 (Database Transaction):** Look for `[prism.workflow.consent] Phase 1 DB committed`.
   - Confirms state transition from `DRAFT` $\to$ `PENDING_CONSENT`.
   - Verifies the candidate has a valid email address and the recruiter owns the candidate record.
3. **Phase 2 (In-Process Relay Dispatch):** Look for `[relay.adapter.consent]` and `[relay.consent.send]`.
   - Confirms HTTP call to `/internal/consent/send` with secret headers.
   - Logs whether Gmail/SMTP sender returned `ok=true`.
   - Confirms thread persistence in `relay.email_threads`.

---

## 4. Tracing Candidate Matching & 404 Troubleshooting

When debugging candidate match queries (`GET /candidates/:id/matches?status=completed`):
1. **Tenant Isolation:** The backend queries `candidateRepo.getCandidateWithCurrentResume(candidateId, req.userId)`.
   - If the candidate record does not exist in `core.people`, or was created by a different recruiter account, `matches.controller.js` outputs:
     ```text
     [request=...] [matches.candidate] 404 Candidate not found in core.people or not owned by user candidateId=... userId=...
     ```
2. **Filter Inspection:** `[matches.candidate] Querying matches filters={...}` displays the parsed threshold and status filters.

---

## 5. Tracing Orchestration & Events

When platform events enter via the Gateway:
1. **Event Ingress:**
   ```text
   [GW DEBUG] POST /v1/events → http://127.0.0.1:4100/v1/events
   ```
2. **Outbox Ingestion:**
   ```text
   [ORCH DEBUG] Ingress accepted platform event into outbox event_id=... queue=orchestration.ingress
   ```
3. **Worker Story:**
   The unified worker logs lifecycle milestones using the `[Orch]` prefix:
   ```text
   [Orch] ── INGRESS syntra.match.requested id=... org=...
   [Orch] ── ROUTE   syntra.match.requested -> module.syntra.match
   [Orch] ── RUN     node=syntra.match.process
   [Orch] ── DONE    id=...
   ```

---

## 6. Using the VS Code Debugger

Pre-configured launch targets are available in `.vscode/launch.json`:

1. Open the **Run and Debug** view in VS Code (`Ctrl+Shift+D`).
2. Select one of the targets:
   - **`Debug: Node API / Syntra (:4000)`** — Sets breakpoints in `node-api/src/server.js`, `relay.adapter.js`, `prism.workflow.service.js`, `matches.controller.js`.
   - **`Debug: Gateway (:8080)`** — Sets breakpoints in `gateway.js`.
   - **`Debug: Unified Worker (PgBoss)`** — Sets breakpoints in `apps/worker/src/bootstrap-pgboss.ts` and module workers.
   - **`Debug: Full Backend Stack`** — Starts Gateway, Node-API, Worker, Orchestration API, and Admin API simultaneously under debugging.
3. Hit **F5** to start debugging.
4. Place breakpoints in:
   - `node-api/src/services/relay.adapter.js` at `sendCandidateConsentEmail`
   - `node-api/src/modules/prism/services/prism.workflow.service.js` at `requestCandidateConsent`
   - `node-api/src/controllers/matches.controller.js` at `listCandidateMatches`

---

## 7. Security: Prohibited Logging Rules

To protect customer privacy and credentials, **NEVER** log:
- Passwords or credentials
- OAuth refresh tokens or bearer tokens
- API keys (OpenAI, Gemini, OpenRouter)
- Raw email message bodies containing candidate PII
- Unmasked resume text or candidate SSN/tax information
- Database connection strings containing passwords
