# JD Workflow Equivalence Audit

This document provides a safety and equivalence audit comparing `syntra.jd.workflow` and `syntra.continuous.match` on branch `dev/benchsales-platform-v2` at commit `4b2ae8a8abb0944c8097140b552ba21091c8204b`.

---

## 1. syntra.jd.workflow

### Database Inventory & History
- **Graph ID:** `bc531be2-4386-4819-88a1-9d745a4bb7bb`
- **Graph Status:** `retired` (retired on `2026-09-13T23:07:59.246Z`, originally created `2026-08-09T19:33:42.792Z`)
- **Versions in DB:** Exactly 1 version (Version 1).
- **Drafts in DB:** 0 drafts.

### Version 1 Specification
- **Version Number:** `1`
- **Status:** `retired`
- **Compiled At:** `2026-08-10T10:24:52.113Z` (India: `2026-08-10 15:54:52 GMT+0530`)
- **Compiled By:** `null`
- **Checksum:** `e29a8447a4a0705ad988be0fcfeeff9d0069f6552d8f8b7c8fa28078be3748e3`
- **Definition:**
  ```json
  {
    "agentName": "matching-agent",
    "graphKey": "syntra.jd.workflow",
    "nodes": [
      {
        "id": "process",
        "impl": "syntra.jd.process",
        "config": {
          "actionClass": "INTERNAL_WRITE"
        }
      }
    ],
    "edges": [
      ["__start__", "process"],
      ["process", "__end__"]
    ]
  }
  ```
- **Nodes:**
  - `id`: `"process"`
  - `impl`: `"syntra.jd.process"`
  - `config`: `{ "actionClass": "INTERNAL_WRITE" }`
- **Edges:** `[["__start__", "process"], ["process", "__end__"]]`
- **Conditional Edges:** None (`[]` / undefined)
- **Input Map:** None (`{}` / undefined)
- **Node Implementation:**
  - Contract: [`adapters/syntra/nodes/jd-process.node.ts`](file:///c:/Users/SUNITHA/Downloads/benchsales-suhas-code/Bench-Sales/adapters/syntra/nodes/jd-process.node.ts)
  - Endpoint called: `POST /internal/jobs/:id/process` on `node-api` (:4000)
  - Runtime handler: `node-api/src/modules/syntra/routes/internal.syntra.routes.js` lines 21–34, which invokes `handleJdUploaded({ data: { jobId } }, { maxAttempts: req.body?.maxAttempts })`.
- **Node Configuration:**
  - `maxAttempts`: integer, min 1, max 5, default 3 (admin exposed).
- **Emitted Events:**
  - `syntra.jd.parsed` with payload `{ jobId, requirement_id, status, syntra, parser_version }`.

---

## 2. syntra.continuous.match

### Database Inventory & History
- **Graph ID:** `a25c2b4c-635d-41cf-b265-d676362a8305`
- **Graph Status:** `active` (created `2026-08-18T11:36:11.916Z`, updated `2026-09-10T10:35:08.115Z`)
- **Versions in DB:** Exactly 1 version (Version 1).
- **Drafts in DB:** 0 drafts.

### Version 1 Specification
- **Version Number:** `1`
- **Status:** `live`
- **Compiled At:** `2026-08-18T11:36:15.704Z` (India: `2026-08-18 17:06:15 GMT+0530`)
- **Compiled By:** `catalog.ts`
- **Checksum:** `8524ee7ad67a17e3fbde0871e09067d8237285689bb49be7232c7e57fa800086`
- **Definition:**
  ```json
  {
    "agentName": "matching-agent",
    "graphKey": "syntra.continuous.match",
    "nodes": [
      {
        "id": "continuous",
        "impl": "syntra.continuous.match",
        "config": {
          "actionClass": "INTERNAL_WRITE"
        }
      }
    ],
    "edges": [
      ["__start__", "continuous"],
      ["continuous", "__end__"]
    ]
  }
  ```
- **Nodes:**
  - `id`: `"continuous"`
  - `impl`: `"syntra.continuous.match"`
  - `config`: `{ "actionClass": "INTERNAL_WRITE" }`
- **Edges:** `[["__start__", "continuous"], ["continuous", "__end__"]]`
- **Conditional Edges:** None (`[]` / undefined)
- **Input Map:** None (`{}` / undefined)
- **Node Implementation:**
  - Contract: [`adapters/syntra/nodes/continuous-match.node.ts`](file:///c:/Users/SUNITHA/Downloads/benchsales-suhas-code/Bench-Sales/adapters/syntra/nodes/continuous-match.node.ts)
  - Endpoint called: `POST /internal/jobs/:id/continuous-match` on `node-api` (:4000)
  - Runtime handler: `node-api/src/modules/syntra/routes/internal.syntra.routes.js` lines 37–69, which calls `runForJob(jobId, { matchThreshold, topN })`.
- **Node Configuration:**
  - `matchThreshold`: number, min 0, max 100, default 0 (admin exposed).
  - `topN`: integer, min 1, max 500, default 15 (admin exposed).
- **Emitted Events:**
  - `syntra.match.completed` with payload `{ jobId, requirement_id, match_job_id, result_count, top_score, status, syntra }`.

---

## 3. Current JD Upload Flow

The end-to-end flow in the current codebase operates as follows:

```mermaid
sequenceDiagram
    autonumber
    actor Recruiter as Recruiter / UI
    participant JobAPI as node-api (:4000)<br/>job.service.js
    participant Queue as pg-boss ("jd.uploaded")
    participant Worker as node-api worker<br/>jdUploaded.worker.js
    participant LLM as OpenAI LLM & Embeddings
    participant Outbox as orch.event_outbox
    participant Relay as outbox-relay.worker
    participant Router as ingress-router.worker
    participant ModuleWorker as module-execute.worker<br/>(:module.syntra.match)
    participant Funnel as node-api (:4000)<br/>matching/funnel.js
    participant Shortlist as syntra.shortlist.workflow

    Recruiter->>JobAPI: POST /api/jobs (File upload)
    Note over JobAPI: extractText() extracts raw text from PDF/DOCX
    JobAPI->>JobAPI: jobRepo.insertJob() -> core.jobs (status=queued)
    JobAPI->>Queue: getBoss().send("jd.uploaded", { jobId })
    Note over JobAPI: ORCH_EMIT_JD_RECEIVED=0<br/>publishJdReceived() returns null (suppressed)
    
    Queue->>Worker: Worker picks up "jd.uploaded" job
    Worker->>Worker: validateJdDocument() (guard against resume upload)
    Worker->>LLM: parseJD() -> structured roles & skills
    Worker->>LLM: generateEmbedding() -> 1536-dim vector
    Worker->>Worker: jobRepo.saveAiResultAndEmbedding() -> core.jobs (status=processed)
    Worker->>Outbox: platformEvents.publishJdParsed() -> INSERT syntra.jd.parsed
    Note over Worker: ORCH_DELEGATE_MATCH=1<br/>Funnel deferred to orchestrator; worker returns
    
    Outbox->>Relay: Relay picks up syntra.jd.parsed
    Relay->>Router: Enqueue to orchestration.ingress
    Router->>Router: Resolve active binding:<br/>syntra.jd.parsed -> syntra.continuous.match
    Router->>ModuleWorker: Enqueue to module.syntra.match (graph=syntra.continuous.match@1)
    ModuleWorker->>Funnel: POST /internal/jobs/:id/continuous-match
    Funnel->>Funnel: runForJob() searches bench, scores tier-1/tier-2, writes core.matches
    Funnel-->>ModuleWorker: 200 OK { result_count, match_job_id, top_score, finalists }
    ModuleWorker->>Outbox: Emits syntra.match.completed
    Outbox->>Shortlist: Triggers syntra.shortlist.workflow (creates recruiter alerts)
```

### Key Source Code Trace
1. **Intake Entry Point:** [`node-api/src/services/job.service.js#L12-L35`](file:///c:/Users/SUNITHA/Downloads/benchsales-suhas-code/Bench-Sales/node-api/src/services/job.service.js#L12-L35)
   - `createJob()` parses file text, inserts `core.jobs`, and calls `getBoss().send("jd.uploaded", { jobId: job.id })`.
   - `platformEvents.publishJdReceived()` is called, but inside [`node-api/src/services/platformEvents.service.js#L49`](file:///c:/Users/SUNITHA/Downloads/benchsales-suhas-code/Bench-Sales/node-api/src/services/platformEvents.service.js#L49):
     ```javascript
     if (!env.ORCH_EMIT_JD_RECEIVED) return null;
     ```
     Because `ORCH_EMIT_JD_RECEIVED=0` in `.env`, no `syntra.jd.received` event is emitted.
2. **Ingestion Worker:** [`node-api/src/modules/syntra/workers/jdUploaded.worker.js#L61-L154`](file:///c:/Users/SUNITHA/Downloads/benchsales-suhas-code/Bench-Sales/node-api/src/modules/syntra/workers/jdUploaded.worker.js#L61-L154)
   - `handleJdUploaded()` runs `parseJD()`, `generateEmbedding()`, and updates `core.jobs`.
   - Publishes `syntra.jd.parsed` via `platformEvents.publishJdParsed({ jobId })`.
   - Checks `env.ORCH_DELEGATE_MATCH && env.PLATFORM_EVENTS_ENABLED` (both `1`), logging:
     `[jd.uploaded] ORCH_DELEGATE_MATCH=1 — funnel deferred to orchestrator (syntra.jd.parsed → continuous-match)`.
3. **Orchestrator Routing:**
   - Active binding `cc9d512a-1577-4df1-8dc7-c67766ffcc87` routes `syntra.jd.parsed` to `syntra.continuous.match`.
4. **Matching & Scoring:** [`adapters/syntra/nodes/continuous-match.node.ts#L191-L225`](file:///c:/Users/SUNITHA/Downloads/benchsales-suhas-code/Bench-Sales/adapters/syntra/nodes/continuous-match.node.ts#L191-L225)
   - Invokes `/internal/jobs/:id/continuous-match`, which triggers `runForJob(jobId)`.
   - Emits `syntra.match.completed`, handed over to `syntra.shortlist.workflow`.

---

## 4. Binding Analysis

### Active and Historical Bindings

| Binding ID | Event Type | Target Graph | Target Graph Status | Binding Status | Created At | Updated At | Notes |
|---|---|---|---|---|---|---|---|
| `cc9d512a-1577-4df1-8dc7-c67766ffcc87` | `syntra.jd.parsed` | `syntra.continuous.match` | **active** | **active** | 2026-09-02 | 2026-09-10 | Primary live JD matching binding |
| `7721a6bc-cf70-445a-8ce3-af67bd58ec4a` | `syntra.jd.parsed` | `syntra.continuous.match` | **active** | `retired` | 2026-08-18 | 2026-09-02 | Prior version of continuous match binding |
| `8b586e36-add5-45dd-ba02-12be1ee87cd2` | `syntra.jd.received` | `syntra.jd.workflow` | **retired** | **active** | 2026-09-19 | 2026-09-19 | **Dangling row** (target has 0 live versions) |
| `fed8fd09-c81d-42f4-8512-a6790beaea42` | `syntra.jd.received` | `syntra.jd.workflow` | **retired** | `retired` | 2026-09-14 | 2026-09-14 | Retired in previous cleanup |
| `58b5033c-1660-48c0-8753-2d9f836f28ba` | `syntra.jd.received` | `syntra.jd.workflow` | **retired** | `retired` | 2026-09-14 | 2026-09-14 | Retired in previous cleanup |
| `c159d1eb-0f59-4670-9f53-9f434e3aed12` | `syntra.jd.received` | `syntra.jd.workflow` | **retired** | `retired` | 2026-09-14 | 2026-09-14 | Retired in previous cleanup |
| `d01946ff-e388-4a1c-a1a2-e9e156ec6f80` | `syntra.jd.received` | `syntra.jd.workflow` | **retired** | `retired` | 2026-08-14 | 2026-08-14 | Retired in previous cleanup |

### Why Row `8b586e36-add5-45dd-ba02-12be1ee87cd2` Exists
Migration [`packages/db/migrations/V20260909.58__a_seed_that_outlived_its_workflow.sql`](file:///c:/Users/SUNITHA/Downloads/benchsales-suhas-code/Bench-Sales/packages/db/migrations/V20260909.58__a_seed_that_outlived_its_workflow.sql) retired this exact binding on 2026-09-14. However, on 2026-09-19 at 15:15:19 UTC, an automated seed or script execution re-inserted the row with `source = 'seed'`. Because `syntra.jd.workflow` has no live version, the binding violates the fundamental invariant:
> *"Every active binding must name a workflow with at least one live version."*

---

## 5. Graph Comparison

| Property | `syntra.jd.workflow` (v1, retired) | `syntra.continuous.match` (v1, live) | Functional Equivalence Assessment |
|---|---|---|---|
| **Graph Purpose** | Parse raw JD text and emit `syntra.jd.parsed` | Match parsed JD against candidate bench and emit `syntra.match.completed` | Different stages of pipeline: `jd.workflow` did parsing; `continuous.match` does matching. |
| **Node Executed** | `syntra.jd.process` | `syntra.continuous.match` | Distinct nodes. |
| **Triggering Event** | `syntra.jd.received` (from raw file upload) | `syntra.jd.parsed` (from structured JD persistence) | Sequential stages: parsing preceded matching. |
| **Underlying API** | `POST /internal/jobs/:id/process` | `POST /internal/jobs/:id/continuous-match` | Distinct endpoints. |
| **Underlying Business Logic** | Calls `handleJdUploaded()` | Calls `runForJob()` | In the current DEV stack, `handleJdUploaded()` is already run directly by `jdUploaded.worker.js`. |
| **Config Options** | `maxAttempts` (parsing retries) | `matchThreshold`, `topN` (shortlist size & score cutoff) | Matching knobs are present on `continuous.match`; parsing knobs are handled in `jdUploaded.worker.js`. |
| **Idempotency Key** | `jobId` / `requirement_id` | `jobId` / `requirement_id` | Both use natural key on requirement ID. |
| **Emitted Event** | `syntra.jd.parsed` | `syntra.match.completed` | `syntra.jd.parsed` is now emitted directly by `node-api`. |

---

## 6. Missing / Unique Behavior

### Is there ANY behavior in `syntra.jd.workflow` missing from the current flow?
**NO.**

1. **Document Validation:** Performed by `validateJdDocument(text, filename)` in `jdUploaded.worker.js`.
2. **LLM Extraction:** Performed by `parseJD({ jdText: text })` in `jdUploaded.worker.js`.
3. **Embeddings:** Generated by `generateEmbedding()` in `jdUploaded.worker.js`.
4. **Database Persistence:** Performed by `jobRepo.saveAiResultAndEmbedding()` in `jdUploaded.worker.js`.
5. **Event Emission:** `syntra.jd.parsed` is published by `platformEvents.publishJdParsed({ jobId })` in `jdUploaded.worker.js`.
6. **Matching & Scoring:** Delegated via `syntra.jd.parsed` to `syntra.continuous.match`, which calls `runForJob()`.

### Hazard of Reviving `syntra.jd.workflow`
If `syntra.jd.workflow` were revived and bound to `syntra.jd.received`:
- When a user uploads a JD, `job.service.js` enqueues `jd.uploaded` to pg-boss.
- `jdUploaded.worker.js` parses the file with the LLM, saves embeddings, and publishes `syntra.jd.parsed`.
- Simultaneously, `syntra.jd.workflow` would run `syntra.jd.process`, calling `POST /internal/jobs/:id/process`.
- `POST /internal/jobs/:id/process` would call `handleJdUploaded()` a **second time** on the same job, executing duplicate LLM calls, overwriting embedding vectors, and publishing a **second** `syntra.jd.parsed` event.
- This duplicate event would cause `syntra.continuous.match` to run **twice**, doubling OpenAI API costs and risking race conditions in candidate shortlist creation.

---

## 7. Dependency References

A repository-wide audit reveals the following references:

1. **Source Code & Workers:**
   - [`node-api/src/modules/syntra/workers/jdUploaded.worker.js#L150`](file:///c:/Users/SUNITHA/Downloads/benchsales-suhas-code/Bench-Sales/node-api/src/modules/syntra/workers/jdUploaded.worker.js#L150): Directly documents:
     `funnel deferred to orchestrator (syntra.jd.parsed → continuous-match)`.
   - [`adapters/syntra/nodes/jd-process.node.ts#L104`](file:///c:/Users/SUNITHA/Downloads/benchsales-suhas-code/Bench-Sales/adapters/syntra/nodes/jd-process.node.ts#L104): Confirms:
     `matching belongs to syntra.continuous.match, reached by the syntra.jd.parsed this node publishes.`
2. **Authoring & Catalog:**
   - [`packages/orchestrator/src/graphs/catalog.ts`](file:///c:/Users/SUNITHA/Downloads/benchsales-suhas-code/Bench-Sales/packages/orchestrator/src/graphs/catalog.ts): Compiles `syntra.continuous.match` as the canonical live graph.
   - [`packages/authoring/src/trigger-events.ts#L102`](file:///c:/Users/SUNITHA/Downloads/benchsales-suhas-code/Bench-Sales/packages/authoring/src/trigger-events.ts#L102): Sets `defaultGraphKey: "syntra.continuous.match"` for event `syntra.jd.parsed`.
3. **Migrations:**
   - [`packages/db/migrations/V20260909.58__a_seed_that_outlived_its_workflow.sql`](file:///c:/Users/SUNITHA/Downloads/benchsales-suhas-code/Bench-Sales/packages/db/migrations/V20260909.58__a_seed_that_outlived_its_workflow.sql):
     Explicitly states: *"The chain moved on. `syntra.jd.workflow` is one step, `syntra.jd.process`, which emits `syntra.jd.parsed`. SYNTRA's own API now publishes `syntra.jd.parsed` directly... and `syntra.jd.parsed → syntra.continuous.match` is live and working. The workflow's job is being done upstream."*
4. **Tests:**
   - [`packages/routing-contract/src/resolve-routes.test.ts`](file:///c:/Users/SUNITHA/Downloads/benchsales-suhas-code/Bench-Sales/packages/routing-contract/src/resolve-routes.test.ts) and [`apps/worker/src/version-pin.test.ts`](file:///c:/Users/SUNITHA/Downloads/benchsales-suhas-code/Bench-Sales/apps/worker/src/version-pin.test.ts) use `"syntra.jd.workflow"` purely as a dummy test fixture name for unit tests testing router mechanics. No tests require it to be a live database workflow.

---

## 8. Retirement Risk Assessment

| Potential Risk Area | Risk Level | Evidence / Analysis |
|---|---|---|
| **JD Parsing** | **NO RISK (0%)** | Parsing is performed by `jdUploaded.worker.js` via pg-boss `jd.uploaded`. It does not rely on `syntra.jd.workflow`. |
| **Matching & Scoring** | **NO RISK (0%)** | Matching is performed by `syntra.continuous.match`, which is triggered by `syntra.jd.parsed`. |
| **Candidate Discovery** | **NO RISK (0%)** | Candidates on the bench are discovered by `runForJob()` within `syntra.continuous.match`. |
| **Event Publication** | **NO RISK (0%)** | `syntra.jd.parsed` is published by `node-api`; `syntra.match.completed` is published by `syntra.continuous.match`. |
| **Admin Authoring** | **NO RISK (0%)** | In the Admin UI, `syntra.jd.workflow` is already displayed as `retired`. Retiring the dangling binding resolves the platform check failure `live_means_reachable`. |
| **Downstream Workflows** | **NO RISK (0%)** | Downstream flows (shortlist notify, review) listen for `syntra.match.completed`. They never listened for anything emitted directly by `syntra.jd.workflow`. |

---

## 9. Recommendation

### Classification
`syntra.jd.workflow` is **A. FULLY REPLACED**.

### Conclusion
1. In early architecture revisions, JD intake was intended to pass raw files to the orchestrator via `syntra.jd.received`, which would invoke `syntra.jd.workflow` (`syntra.jd.process`) to call the parsing endpoint and emit `syntra.jd.parsed`.
2. The platform architecture evolved to perform document extraction, validation, LLM parsing, and vector embeddings directly inside the `node-api` intake pipeline (`jdUploaded.worker.js`), which publishes `syntra.jd.parsed` once parsing succeeds.
3. The orchestrator's live entry point for the JD pipeline is `syntra.continuous.match`, which consumes `syntra.jd.parsed` and orchestrates bench matching and scoring.
4. `syntra.jd.workflow` was deliberately retired on 2026-08-10 / 2026-09-13.
5. The active binding `8b586e36-add5-45dd-ba02-12be1ee87cd2` (`syntra.jd.received → syntra.jd.workflow`) is a dangling seed row pointing to a workflow with 0 live versions.
6. **Action:** Retiring the dangling binding row `8b586e36-add5-45dd-ba02-12be1ee87cd2` is 100% safe, architectural best practice, and required to fix the platform check failure `live_means_reachable`. Under no circumstances should `syntra.jd.workflow` be resurrected.
