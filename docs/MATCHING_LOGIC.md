# SYNTRA Matching Logic

How job ↔ candidate matching works in this repo — from upload through scored results in the UI.

---

## Overview

Matching is a **3-tier funnel**:

| Tier | Name | Technology | Cost |
|------|------|------------|------|
| **Tier 1** | Vector shortlist | Postgres `pgvector` cosine distance | No LLM |
| **Tier 2** | Skill overlap rank + gate | In-memory skill set overlap | No LLM |
| **Tier 3** | Semantic score | LLM compares JD summary vs resume summary | LLM call |

Only pairs that survive Tier 1 and Tier 2 are sent to Tier 3.

---

## End-to-end flow

```text
Upload JD or Resume
       │
       ▼
AI parsing (jdParsing / resumeParsing)
       │
       ▼
Generate embedding (1536-dim vector, text-embedding-3-small)
       │
       ▼
Save to syntra.jobs / syntra.resumes (processed_at, embedding, skills, summaries)
       │
       ▼
Matching funnel (funnel.js)
   ├─ Tier 1: tier1Filter.js  → vector nearest neighbors
   ├─ Tier 2: tier2Rank.js    → skill overlap % + top-N gate
   └─ Insert syntra.matches row (status=requested) + enqueue scoring
       │
       ▼
Tier 3 scoring (matchRequested.worker OR orchestrator)
   └─ LLM batch: matchBatchSummariesToSummary()
       │
       ▼
Save score, tier, reasoning → syntra.matches (status=completed)
       │
       ▼
UI: AI Workspace / Job matches list
```

---

## When the funnel runs

| Trigger | File | Function |
|---------|------|----------|
| JD upload finishes (local path) | `workers/jdUploaded.worker.js` | `runForJob(jobId)` |
| Resume upload finishes | `workers/resumeUploaded.worker.js` | `runForResume(resumeId)` |
| Job saved to library (activated) | `services/job.service.js` | `runForJob(jobId)` |
| Resume saved to library | `services/resume.service.js` | `runForResume(resumeId)` |
| UI “Run match” on a job | `controllers/matches.controller.js` | `POST /jobs/:jobId/run-match` |
| UI “Run match” on a resume | `controllers/matches.controller.js` | `POST /resumes/:resumeId/run-match` |
| Orchestrator after JD parsed | `internal.routes.js` | `POST /internal/jobs/:id/continuous-match` |

**Note:** When `ORCH_DELEGATE_MATCH=1`, the JD worker **skips** local funnel after parse; orchestrator graph `syntra.continuous.match` calls `/internal/jobs/:id/continuous-match` instead.

---

## Tier 1 — Vector shortlist (no LLM)

**Files:** `matching/tier1Filter.js`, `repositories/match.repository.js`

### Job → candidates

1. Load job embedding from `syntra.jobs.embedding`.
2. Query top **50** resumes ordered by cosine distance:

```sql
ORDER BY r.embedding <=> job_embedding ASC
```

3. **Filters applied:**
   - Same recruiter: `c.created_by = j.created_by`
   - Resume is current and processed (`is_current`, `processed_at`, `embedding IS NOT NULL`)
   - Job is processed

### Resume → jobs

Mirror query: find top jobs by distance to resume embedding, same owner filter.

### Diagnostics

If pool is empty, logs include `resumes_ready`, `same_owner`, `job_owner` from `countMatchPoolDiagnostics()`.

---

## Tier 2 — Skill overlap rank (no LLM)

**File:** `matching/tier2Rank.js`

For each survivor from Tier 1:

1. Normalize required JD skills and candidate skills (lowercase, trim).
2. Compute **skill match score**:

```text
overlap_count / unique_required_skills × 100
```

3. Sort descending by score.
4. Apply **skill floor** — env `MATCH_SKILL_FLOOR` (default `0` = include all ranked).
5. Take top **N** — env `MATCH_TOP_N` (default `15`).

Output: **finalists** list with `{ jobId, candidateId, resumeId, skillMatchScore }`.

---

## Shortlist + enqueue

**File:** `matching/funnel.js`

For each finalist:

1. `INSERT INTO syntra.matches` with `match_status = 'requested'`, `skill_match_score`, `ON CONFLICT (job_id, resume_id) DO NOTHING`.
2. If new row inserted → `enqueueMatchRequest()` → `platformEvents.requestMatchScoring()`.

---

## Tier 3 — LLM semantic scoring

**Files:** `workers/matchRequested.worker.js`, `ai/matching.js`

### Internal worker path (`ORCH_DELEGATE_MATCH=0`)

pg-boss queue `match.requested` → worker batches up to **15** pairs per job.

### Orchestrator path (`ORCH_DELEGATE_MATCH=1`)

1. Funnel emits `syntra.match.requested` to `event_outbox`.
2. Worker routes to graph `syntra.match.workflow` → tool `syntra.match.process`.
3. Orchestrator calls `POST /internal/matches/process` on syntra-api (same handler as worker).

### Scoring steps

1. Load `jd_summary` and `resume_summary` for each pair.
2. If summaries missing → save failure record (`MISSING_SUMMARY`, retryable).
3. Call **`matchBatchSummariesToSummary(candidates, jdSummary)`** — one LLM call per job batch.
4. Parse JSON: `match_score`, `match_status`, `consultant_response`, `strengths`, `gaps`, `green_flags`, `red_flags`, `breakdown`.
5. Normalize tier: `Strong Match` → `strong`, `Potential Match` → `moderate`, else `weak`.
6. `saveScoreResult()` → updates `syntra.matches`: `score`, `tier`, `reasoning`, `match_status = completed`.

### Tier labels (UI)

| LLM label | DB tier | Typical score |
|-----------|---------|---------------|
| Strong Match | `strong` | 80–100 |
| Potential Match | `moderate` | 50–79 |
| Low Match | `weak` | 0–49 |

---

## Embeddings (prerequisite for Tier 1)

**File:** `ai/embedding.js`

- Model: `AI_EMBEDDING_MODEL` or default `text-embedding-3-small`
- Dimension: **1536**
- Stored on `syntra.jobs.embedding` and `syntra.resumes.embedding` after parse
- Without embeddings, Tier 1 pool is **empty** — no matches until parse+embed completes

---

## Data model

**Table:** `syntra.matches`

| Column | Purpose |
|--------|---------|
| `job_id`, `candidate_id`, `resume_id` | Pair identity (unique on job+resume) |
| `skill_match_score` | Tier 2 overlap % |
| `score` | Tier 3 LLM semantic score (0–100) |
| `tier` | `strong` / `moderate` / `weak` |
| `match_status` | `requested` → `processing` → `completed` / `failed` |
| `reasoning` | LLM “Why Matched” bullets |
| `strengths`, `gaps`, `green_flags`, `red_flags` | Structured LLM output |
| `breakdown` | JSON sub-scores (skills, experience, location, …) |

---

## Environment variables

| Variable | Default | Effect |
|----------|---------|--------|
| `MATCH_SKILL_FLOOR` | `0` | Min skill overlap % to reach Tier 3 |
| `MATCH_TOP_N` | `15` | Max finalists per funnel run |
| `ORCH_DELEGATE_MATCH` | `0` | `1` = scoring via orchestrator + outbox; `0` = internal pg-boss worker |
| `AI_PROVIDER` / `AI_MODEL` | — | LLM for Tier 3 |
| `AI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embeddings for Tier 1 |

---

## API surfaces

| Endpoint | Purpose |
|----------|---------|
| `GET /jobs/:jobId/matches` | List scored matches for a job |
| `GET /candidates/:candidateId/matches` | List matches for a candidate |
| `POST /jobs/:jobId/run-match` | Manually run funnel for one job |
| `POST /matches/:matchId/retry` | Retry failed Tier 3 scoring |
| `POST /internal/jobs/:id/continuous-match` | Orchestrator funnel trigger |
| `POST /internal/matches/process` | Orchestrator Tier 3 scoring |

---

## Orchestration graphs (when delegated)

| Event | Graph | Tool |
|-------|-------|------|
| `syntra.jd.parsed` | `syntra.continuous.match` | `syntra.continuous.match` → funnel |
| `syntra.match.requested` | `syntra.match.workflow` | `syntra.match.process` → LLM score |

Worker logs: `[Orch] RELAY → ROUTE → RUN → TOOL → NODE → DONE`

---

## Key source files

```text
node-api/src/
├── matching/
│   ├── funnel.js          # Orchestrates tier 1→2→enqueue
│   ├── tier1Filter.js     # Vector pool
│   └── tier2Rank.js       # Skill overlap rank
├── ai/
│   ├── matching.js        # LLM prompts + batch scoring
│   └── embedding.js       # Vector generation
├── workers/
│   └── matchRequested.worker.js  # Tier 3 worker
├── services/
│   ├── matchEnqueue.js
│   └── platformEvents.service.js
├── repositories/
│   └── match.repository.js
└── routes/
    ├── matches.routes.js
    └── internal.routes.js

packages/orchestrator/src/nodes/
├── syntra.ts              # syntra.match.process
└── syntra-followups.ts    # syntra.continuous.match
```

---

## Common “no matches” causes

1. **Job or resume still processing** — wait for `processed_at` and embedding.
2. **Different recruiter** — candidates must have same `created_by` as job.
3. **Resume not current** — only `is_current = true` resumes participate.
4. **No embedding** — parse/embedding step failed; check API logs.
5. **ORCH_DELEGATE_MATCH=1 but worker down** — funnel runs via orchestrator; worker must be up.
6. **Tier 3 LLM failure** — match row stays `requested`/`failed`; use retry endpoint.
