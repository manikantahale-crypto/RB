# TEKISHO BenchSales Revenue Suite — Complete Codebase Guide
### Written for a smart 15-year-old learning development

---

## RESUME POINT
> **Status:** COMPLETE. All 7 steps done.

---

## PROGRESS CHECKLIST
- [x] Step 1 — Skeleton created
- [x] Step 2 — Full repo tree map
- [x] Step 3a — node-api module
- [x] Step 3b — Front module
- [x] Step 3c — apps module
- [x] Step 3d — packages module
- [x] Step 3e — adapters module
- [x] Step 3f — scripts module
- [x] Step 4 — Orchestration + DB + Auth + AI
- [x] Step 5 — Glossary
- [x] Step 6 — Bloat table
- [x] Step 7 — Final summary

---

## 1. WHAT THIS PROJECT IS

TEKISHO BenchSales Revenue Suite is a platform for IT staffing companies. When a client needs a developer, this platform receives the job description, finds matching candidates using AI, scores them, and manages all email conversations and submissions to close the deal.

Who uses it: Bench Sales recruiters — people who find IT consulting jobs for workers who are available.

---

## 2. BIG PICTURE

### System Diagram

```
RECRUITER BROWSER  (Front app, React SPA, port 3000)
  Upload JDs/resumes, review AI matches, manage submissions
          |
          | HTTP/REST
          v
node-api  (Express.js, port 4000)
  Main backend: auth, jobs, resumes, candidates, 5 sub-modules
          |
          +-- SQL --> Supabase Postgres (cloud)
          |           schemas: platform, core, syntra, authoring,
          |                    orch, orbit, prism, relay, pgboss, langgraph
          |
          +-- pg-boss --> Background Workers (inside node-api process)
                           jd.uploaded     -> LLM parse JD -> embed -> match
                           resume.uploaded -> LLM parse resume -> embed -> match
                           astra.email.poll-> fetch IMAP emails -> create jobs
          |
          | writes to orch.event_outbox table
          v
apps/worker  (Orchestration Worker, port 4100)
  Polls event_outbox every 1 second
  Pushes events to pg-boss atomically (transactional outbox pattern)
  Routes events to LangGraph workflow graphs
  Executes graph nodes step by step with checkpoint state

apps/relay  (Smart Email Inbox, port 3005)
  Connects to Gmail or IMAP mailbox
  Classifies emails (rules or LLM)
  Drafts AI replies, sends via SMTP or SendGrid

apps/admin + apps/admin-api  (Admin Dashboard, port 4200)
  Visual workflow builder, orchestration logs, approval screens
```

### One Full Journey: JD Email -> Candidate Matched

1. Email with a job description arrives in the company inbox.
2. ASTRA email poller (pg-boss cron, every 2 min) reads it via IMAP.
3. Job record created in core.requirements. jd.uploaded pushed to pg-boss.
4. Background worker picks it up. Calls LLM with 60-line prompt.
5. LLM returns JSON: title, skills, location, visa, confidence_score.
6. Vector embedding generated (1536 numbers representing meaning).
7. Both saved to DB. Event syntra.jd.parsed written to orch.event_outbox.
8. Outbox relay worker pushes it to pg-boss atomically (enqueue + mark = one transaction).
9. Ingress router looks up which LangGraph workflow handles syntra.jd.parsed.
10. Workflow runs the matching funnel node.
11. Tier 1: SQL filter — find candidates with same primary_role.
12. Tier 2: skill overlap score = matched_skills / total_skills * 100. Keep top 15.
13. Match rows inserted. Each queued for LLM scoring.
14. LLM scores the match 0-100 with a reason paragraph.
15. Recruiter sees ranked matches in Front app.
16. Recruiter clicks Submit -> PRISM creates submission, sends consent email via RELAY.
17. Candidate accepts -> ORBIT records placement.

---

## 3. FOLDER AND FILE MAP

```
/ (repo root)
|
|-- Front/                     React SPA (recruiter web UI, port 3000)
|   `-- src/
|       |-- App.tsx            Root; routes between 8 screens (354 lines)
|       |-- components/
|       |   |-- AIWorkspace.tsx        Match review (76KB)
|       |   |-- UploadAnalyze.tsx      Upload + parse status (84KB)
|       |   |-- CandidateWorkflow.tsx  Candidate profiles (56KB)
|       |   |-- Dashboard.tsx          Stats (31KB)
|       |   |-- Header.tsx             Top nav (15KB)
|       |   |-- Auth/AuthScreen        Login/signup form
|       |   |-- relay/                 Smart inbox UI
|       |   |-- orbit/                 Placement tracking UI
|       |   |-- prism/                 Submission/RTR UI
|       |   `-- vendor/                Vendor management UI
|       |-- services/
|       |   |-- api.ts         apiFetchWithRetry() with JWT auth header
|       |   `-- auth.ts        JWT storage in localStorage
|       |-- types.ts           All TypeScript types (8.7KB)
|       `-- context/AuthContext.tsx    React auth state
|
|-- node-api/                  Express.js backend (port 4000)
|   `-- src/
|       |-- server.js          Entry: DB check, HTTP, pg-boss workers (148 lines)
|       |-- app.js             All Express routes (92 lines)
|       |-- config/
|       |   |-- db.js          Postgres pool (max 2), withTransaction() (45 lines)
|       |   |-- queue.js       pg-boss: 9 queues (69 lines)
|       |   |-- env.js         Reads all env vars (55 lines)
|       |   |-- aiConfig.js    AI provider config: openai/gemini/groq/openrouter (86 lines)
|       |   `-- ssl.js         SSL for Supabase
|       |-- core/aiClient.js   complete() - calls any LLM (58 lines)
|       |-- ai/
|       |   |-- resumeParsing.js  LLM prompt + retry to parse resumes (161 lines)
|       |   |-- jdParsing.js      LLM prompt + retry to parse JDs (143 lines)
|       |   `-- embedding.js      OpenAI embeddings, 1536-dim vector (50 lines)
|       |-- middleware/
|       |   |-- auth.js        requireAuth: verify JWT (50 lines)
|       |   `-- errorHandler.js  Global error catch
|       |-- controllers/       Thin HTTP handlers (9 files)
|       |-- routes/            Express route files (12 files)
|       |-- repositories/      Direct SQL queries (13 files)
|       |   |-- match.repository.js      All match SQL (746 lines - LARGE)
|       |   |-- candidate.repository.js  Candidate CRUD (12KB)
|       |   |-- job.repository.js        Job CRUD (12.5KB)
|       |   `-- outbox.repository.js     insertEvent() into event_outbox
|       |-- services/
|       |   |-- auth.service.js          signup, login, JWT (140 lines)
|       |   |-- platformEvents.service.js Named publish functions (232 lines)
|       |   `-- relay.adapter.js         Forwards email calls to relay (15.9KB)
|       |-- modules/
|       |   |-- syntra/        Core ATS: upload, parse, embed, match, score
|       |   |   |-- workers/jdUploaded.worker.js     JD pipeline (180 lines)
|       |   |   |-- workers/resumeUploaded.worker.js Resume pipeline (176 lines)
|       |   |   |-- workers/matchRequested.worker.js LLM scoring (4.4KB)
|       |   |   |-- workers/activation.worker.js     Bulk re-match (3.3KB)
|       |   |   `-- matching/funnel.js               Tier1+Tier2 funnel (169 lines)
|       |   |
|       |   |-- astra/         Job intake: emails + job boards
|       |   |   |-- services/astra.service.js          Normalization (453 lines)
|       |   |   |-- services/emailPoller.service.js    IMAP polling (8KB)
|       |   |   `-- workers/astraEmailPoller.worker.js Cron poll worker
|       |   |
|       |   |-- orbit/         Placement tracking (lifecycle, revenue, notes)
|       |   |-- prism/         Vendor/submission management
|       |   |   `-- services/prism.workflow.service.js HUGE 74KB
|       |   `-- relay/         Proxy routes to relay process
|       |
|       |-- constants/         Status enums, event type name constants
|       |-- utils/             logger.js, pgRetry.js, actionNeeded.js
|       `-- validation/        Zod schemas for AI output
|
|-- apps/
|   |-- relay/                 Smart Email Inbox (Fastify, port 3005)
|   |   `-- src/
|   |       |-- buildRelayApp.ts  589 lines: all relay routes + mailbox sync
|   |       |-- connectors/       IMAP, Gmail OAuth, SMTP adapters
|   |       |-- classification/   Rule-based email classifier
|   |       |-- drafting/         LLM reply drafter
|   |       |-- agent/            inboxAgent.ts - main email processor
|   |       |-- followups/        SLA sweeper, consent timeout, reminder
|   |       `-- db/               Drizzle ORM schema for relay tables
|   |
|   |-- worker/                Orchestration Worker (port 4100)
|   |   `-- src/
|   |       |-- bootstrap-pgboss.ts  Startup: pg-boss + LangGraph (301 lines)
|   |       `-- workers/
|   |           |-- outbox-relay.worker.ts   Poll event_outbox -> pg-boss (425 lines)
|   |           |-- ingress-router.worker.ts Route events to graph workflows
|   |           |-- module-execute.worker.ts Execute graph nodes
|   |           `-- resume-thread.worker.ts  Resume paused workflows
|   |
|   |-- api/                   Orchestration HTTP API
|   |   `-- src/index.ts       Fastify: auth, event-fire, run history
|   |
|   |-- admin/                 Admin React UI (workflow builder, graph viewer)
|   |-- admin-api/             Admin backend (graph/version CRUD)
|   `-- web/                   Candidate-facing app (minimal skeleton)
|
|-- packages/
|   |-- orchestrator/          Core LangGraph engine
|   |   `-- src/
|   |       |-- graphs/        compiler.ts (21KB), catalog, recipe, state
|   |       |-- nodes/         registry, implementations, context
|   |       |-- routing/       event routing table, routing decisions
|   |       |-- policy/        approval gate engine
|   |       `-- workflow/      WorkflowRunner, failed-workflows store
|   |
|   |-- db/                    Database migrations
|   |   `-- migrations/        85 SQL files (Flyway V + R conventions)
|   |
|   |-- agents/syntra/         Agent definitions
|   |-- authoring/             Event binding helpers, RLS, SSL helpers
|   |-- domain/                Shared types: EventEnvelope, EventType
|   |-- graph-contract/        Graph definition contracts
|   `-- node-contract/         Workflow node contracts
|
|-- adapters/                  External system adapters (syntra, astra, platform)
|-- scripts/                   35 dev utility scripts (not production code)
|-- docs/adr/                  Architecture Decision Records
|-- package.json               Monorepo root; 20+ npm scripts
|-- tsconfig.base.json         Shared TypeScript config
`-- .env.example               All 90 env variable names (values blank)
```

---

## 4. MODULE-BY-MODULE BREAKDOWN

### 4a. node-api

What it does: Receives all HTTP from the Front app. Auth, file uploads, candidate/job CRUD, AI pipeline trigger, event publishing.

Boot sequence (server.js, 148 lines):
1. Check Postgres is alive
2. Verify event types are in the authoring catalogue
3. Start HTTP on port 4000
4. Start pg-boss workers in background (non-blocking)

Route map (app.js, 92 lines):
- /health -> no auth required
- /auth -> signup, login, /me
- /jobs, /resumes, /candidates, /placements -> requireAuth
- /vendors, /submissions -> prism (requireAuth)
- /api/astra, /astra, /api/job-boards -> astra intake (no auth)
- /orchestration -> activity feed (requireAuth)
- Internal module routes from syntra, orbit, astra, prism

Key files:

node-api/src/config/db.js (45 lines)
- Pool: max 2 connections (Supabase pooler limit is ~15 total across all processes)
- withTransaction(fn): BEGIN -> fn(client) -> COMMIT, or ROLLBACK on error
- Verdict: NEEDED

node-api/src/core/aiClient.js (58 lines)
- getOpenAIClient(): creates OpenAI client pointing at configured provider
- complete(prompt, { system, modelKey, temperature, maxTokens }):
  - modelKey "reason" = smart model, "fast" = cheap model
  - Logs every call with latency and token count
  - Returns response text
- Verdict: NEEDED

node-api/src/ai/resumeParsing.js (161 lines)
- RESUME_PARSING_PROMPT: 60-line system prompt asking for 40+ fields
- parseResume(text, maxAttempts=3):
  - Up to 3 attempts with backoff (1.2s, 2.4s)
  - Auth/credit errors abort immediately
  - validateResumeSchema() checks output has name or title and skills[]
  - Returns validated JSON or throws
- Verdict: NEEDED

node-api/src/ai/jdParsing.js (143 lines)
- JD_PARSING_PROMPT: references spaCy NLP placeholder variables (always empty arrays in practice)
- parseJD({ jdText, spacyOrgs, spacyGpes, regexVisas, regexExperience }):
  - Same 3-attempt retry pattern
  - validateJdSchema() checks title is present
- Note: spaCy is not implemented in this codebase
- Verdict: BLOATED (90% duplicate of resumeParsing.js)

node-api/src/ai/embedding.js (50 lines)
- generateEmbedding(text):
  - Calls OpenAI embeddings.create({ model: "text-embedding-3-small", input: text })
  - Validates response is exactly 1536 dimensions
  - Returns { embedding: float[], model, version }
- Verdict: NEEDED

SYNTRA sub-module - JD pipeline (jdUploaded.worker.js, 180 lines):

What goes in: jobId from pg-boss queue message
Steps:
1. Load raw_text from core.requirements
2. Score file with 30+ regexes to confirm it is a JD (not a resume)
3. Call parseJD() -> JSON with title, skills, location, visa, rate
4. Compute SHA-256 hash of summary
5. If hash unchanged AND embedding exists -> reuse old embedding
6. Else call generateEmbedding() -> 1536-dim float array
7. Save parsed fields + embedding atomically to DB
8. Publish syntra.jd.parsed event to orch.event_outbox
9. If ORCH_DELEGATE_MATCH=true -> stop (orchestrator handles matching)
10. Else call runForJob() directly
What comes out: job marked processed, match funnel runs

SYNTRA sub-module - Resume pipeline (resumeUploaded.worker.js, 176 lines):
Same as JD pipeline but:
- Validates file is a resume (not a JD) - same 30+ regexes with inverted logic
- Calls parseResume() -> 40+ field JSON
- Also updates core.people with name, email, phone, immigration_status, linkedin
- Always runs the funnel (does not check ORCH_DELEGATE_MATCH)
- The document-type validation function is a copy-paste of the one in jdUploaded.worker.js

SYNTRA sub-module - Matching funnel (funnel.js, 169 lines):

Tier 1 filter (tier1Filter.js, 1.7KB):
- SQL: find all candidates with same primary_role as this job
- Pure DB filter, no AI

Tier 2 rank (tier2Rank.js, 2.7KB):
- For each Tier 1 survivor: score = |resume_skills intersect job_skills| / |job_skills| * 100
- Sort by score descending
- Apply MATCH_SKILL_FLOOR gate (default 0 = include all ranked)
- Return top MATCH_TOP_N (default 15)

Output: finalist pairs -> inserted as core.matches rows, each enqueued for LLM scoring

ASTRA sub-module:

emailPoller.service.js (8KB):
- Connects to IMAP using env credentials
- Fetches emails from last N days
- Extracts text, checks if it looks like a job requirement
- Creates core.requirements row, pushes jd.uploaded to queue

astra.service.js (453 lines):
- normalizeText(): lowercase, collapse whitespace
- normalizeSkills(): sort, deduplicate, comma-join
- normalizeEmail(): strips display names like "John Doe <john@vendor.com>"
- normalizeVisaRequirement(): standardize H1B/GC/USC/OPT/CPT codes
- Deduplicates by email Message-ID header

Job board adapters in services/adapters/:
- Jooble, Adzuna, JobPipe via REST APIs
- Indeed + Monster via Apify web scraper

ORBIT sub-module:
Tables: orbit.placements, orbit.lifecycle_events, orbit.activity_notes, orbit.revenue_records
Lifecycle: shortlisted -> submitted -> interview_scheduled -> offer_received -> placed
Routes: /placements CRUD
Orchestrator can drive transitions via orbit.lifecycle.transition_requested events

PRISM sub-module:
RTR flow: Submit candidate -> send consent email -> candidate replies yes/no -> track submission
prism.workflow.service.js (74KB, ~1900 lines): The largest and most complex file. 
Orchestrates multi-step submission lifecycle with inline email templates and state machines.
consentAutoResend.worker.js: Re-sends unanswered consent emails (pg-boss job).

### 4b. Front (React SPA)

8 screens (App.tsx, 354 lines):
- dashboard: Stats overview
- upload (UploadAnalyze.tsx, 84KB): Upload JD or resume, watch parse status
- matching (AIWorkspace.tsx, 76KB): Match scores, candidate review
- inbox (RelayWorkspace): Smart email inbox
- resumes (CandidateWorkflow.tsx, 56KB): Candidate profiles
- vendors (VendorWorkspace): Vendor management
- prism (SubmissionRTR): Submission workflow
- settings (SettingsWorkspace): Settings

Auth flow:
1. AuthContext.tsx checks localStorage for JWT on load
2. If found: set user state, show main app
3. If not found: show AuthScreen (login/signup)
4. Login: POST /auth/login -> store token -> update user state

services/api.ts (2.5KB):
- apiFetchWithRetry(): wraps fetch() with retry and Authorization: Bearer header
- All backend calls go through this

### 4c. apps/relay

What it does: AI email assistant. Reads emails, classifies them, drafts replies, optionally sends them.

buildRelayApp.ts (589 lines): Fastify routes:
- GET /inbox/threads: list threads
- GET /inbox/threads/:id: thread detail
- POST /inbox/sync: pull new emails now
- POST /inbox/reply: draft or send reply
- POST /inbox/send: send outbound email

pullMailbox(): connects via IMAP or Gmail OAuth, fetches messages, deduplicates, stores in relay schema tables.

Follow-up sweepers (setInterval timers):
- slaSweeper: checks response deadlines
- consentTimeoutSweeper: marks timed-out consent requests
- consentReminderSweeper: sends reminder emails

Drizzle ORM tables: email_threads, email_messages, followups
Email connectors: IMAP (imapflow library) or Gmail OAuth (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN)

### 4d. apps/worker (Orchestration Worker)

What it does: Reads events from the database, runs LangGraph workflows step by step, checkpoints state after each step.

bootstrap-pgboss.ts (301 lines) startup:
1. Connect to Postgres via DATABASE_MIGRATOR_URL
2. Start pg-boss
3. Create PostgresSaver (saves LangGraph state to langgraph schema)
4. Build GraphCompiler with all nodes registered
5. Seed built-in graphs into DB if they don't exist
6. Load event-handling config from authoring.event_catalog
7. Load event->workflow bindings into memory
8. Refresh both every 5 minutes (setInterval)
9. Start 4 workers: outbox-relay, ingress-router, module-execute, resume-thread

outbox-relay.worker.ts (425 lines):
- Polls orch.event_outbox WHERE published_at IS NULL every 1 second
- Batch: up to 100 rows per poll
- For each row: open DB transaction
  -> adapt pg connection as pg-boss IDatabase (pgClientAsBossDb adapter)
  -> pg-boss inserts its job record using this connection
  -> UPDATE event_outbox SET published_at = now() WHERE id = row.id
  -> COMMIT (both operations atomic)
- On 5th failure: move to orchestration.dispatch.dlq

ingress-router.worker.ts:
- Listens on orchestration.ingress pg-boss queue
- Resolves event_type -> graph_key from authoring.graph_event_bindings
- Calls WorkflowRunner.run() to start or resume workflow

module-execute.worker.ts:
- Listens on per-module queues (e.g., syntra.continuous.match)
- Executes individual graph nodes
- PostgresSaver checkpoints state after each node

resume-thread.worker.ts:
- Resumes paused workflows after human approval in admin UI

### 4e. packages/orchestrator

graphs/compiler.ts (21KB): GraphCompiler class
- ensureSchemaAndSeed(): seeds built-in graph definitions if not in DB
- compile(graphKey, version): reads graph from DB, resolves node names to implementations, wires into LangGraph CompiledStateGraph
- Handles conditional edges (node returns "approved" -> go to nodeX, "rejected" -> go to nodeY)

nodes/registry.ts: Map of node_key -> NodeImplementation
routing/table.ts: INGRESS_QUEUE, DISPATCH_QUEUE, planForEvent()
policy/engine.ts: PolicyEngine - can block steps until human approval or time condition
workflow/runner.ts: WorkflowRunner - loads checkpoint, invokes graph, saves state

### 4f. packages/db

85 SQL migration files using Flyway naming:
- V20260909.NN__description.sql: versioned, applied once in order
- R__description.sql: repeatable, re-run when content changes

Key migrations:
- V...01: 195KB baseline schema dump from production
- V...03: platform schema (organizations, users)
- V...05: core schema (requirements, people, resumes, matches, embeddings)
- V...10: authoring schema (graphs, event_catalog)
- V...38: orch schema (event_outbox)
- V...45: RLS enabled everywhere
- V...64: prism schema (submissions, consent)
- V...67: orbit schema (placements, lifecycle)

Key repeatable migrations:
- R__seed_event_schemas.sql (34KB): seeds all event types into authoring.event_catalog
- R__seed_syntra_graphs.sql (8.8KB): seeds built-in workflow graphs
- R__runtime_table_policies.sql (5.5KB): RLS policies
- R__rls_assert.sql (5KB): asserts RLS is on every table that should have it

---

## 5. ORCHESTRATION

### The Transactional Outbox Pattern

node-api writes an event row to orch.event_outbox in the SAME database transaction as the business data change. A separate process (outbox-relay.worker) picks it up and delivers it.

Key: when outbox-relay picks up row #42, it:
1. Opens a DB transaction
2. Uses that same connection to tell pg-boss to insert the job
3. Updates event_outbox.published_at = now()
4. COMMITs both

If anything crashes between write and commit: transaction rolls back, row stays unpublished, next poll retries. Events cannot be silently lost.

### Event Routing

authoring.graph_event_bindings maps:
- syntra.jd.parsed -> graph: syntra.continuous.match
- syntra.match.requested -> graph: syntra.score.match
- astra.requirement.received -> graph: astra.normalize.requirement
- orbit.lifecycle.transition_requested -> graph: orbit.lifecycle.graph

Bindings refreshed from DB every 5 minutes (no restart needed to activate new workflows).

### Background Jobs

| Queue | Triggered by | Does |
|-------|-------------|------|
| jd.uploaded | Upload API | LLM parse JD, embed, optional match |
| resume.uploaded | Upload API | LLM parse resume, embed, match |
| match.requested | Funnel | LLM score a match pair 0-100 |
| astra.email.poll | pg-boss cron | Fetch IMAP emails, create jobs |
| job.activated | Recruiter action | Re-run funnel for all active resumes |
| candidate.activated | Recruiter action | Re-run funnel for all active jobs |
| prism.consent.autoresend | pg-boss schedule | Re-send unanswered consent emails |
| orchestration.ingress | Outbox relay | Route event to workflow graph |

---

## 6. DATABASE

### Schemas

| Schema | Owns |
|--------|------|
| platform | organizations (tenants), users, plans |
| core | requirements (jobs), people (candidates), resumes, matches, embeddings, processing_jobs |
| syntra | Legacy mirror views + triggers that write to core |
| authoring | graph_definitions, graph_versions, event_catalog, graph_event_bindings |
| orch | event_outbox |
| orbit | placements, lifecycle_events, activity_notes, revenue_records |
| prism | vendors, submissions, consent_records |
| relay | email_threads, email_messages, followups |
| pgboss | pg-boss internal tables |
| langgraph | LangGraph checkpoint state |

### Key Tables

core.requirements (one row per job description):
  id, org_id, title, primary_role, required_skills[], summary, status

core.people (one row per candidate):
  id, org_id, full_name, email, phone, immigration_status, primary_role, skills[]

core.resumes (one row per uploaded resume file):
  id, person_id (FK->people), summary, skills[], primary_role, processing_state

core.embeddings (vector embeddings, versioned by model):
  subject_type, subject_id, model, version, embedding vector(1536)

core.matches (one row per job+candidate pair that passed the funnel):
  id, requirement_id, person_id, resume_id, skill_match_score (0-100), llm_score (0-100), score_reason, status

orch.event_outbox (the event bus):
  event_id, event_type, organization_id, aggregate_type, aggregate_id,
  correlation_id, causation_id, payload_ref JSONB, published_at (null = not yet delivered)

authoring.event_catalog (known event types):
  event_type, payload_schema JSONB, idempotency_key_path, trigger_rank

authoring.graph_event_bindings (what workflow handles what event):
  event_type, graph_key, version, org_id, status

### Row Level Security (RLS)

Postgres feature: the database itself refuses to return rows from the wrong tenant.
Requires: current_setting('app.org_id') to be set on the connection.

Status:
- RLS policies defined in R__runtime_table_policies.sql. Enabled in V...45.
- R__rls_assert.sql checks they exist.
- node-api does NOT set app.org_id on its pool -> RLS not enforced on node-api queries.
- Data isolation relies on application-level WHERE org_id = ? in repository SQL.
- apps/worker does set org context correctly via runWorkflowWithOrgContext().

---

## 7. AUTHENTICATION AND PERMISSIONS

How login works:
1. POST /auth/login with email + password
2. Zod validates: email format, password non-empty
3. Normalize email to lowercase
4. Query platform.users by email
5. bcrypt.compare(password, stored_hash)
6. On match: jwt.sign({ userId, email, role, orgId }, AUTH_JWT_SECRET, { expiresIn: "7d" })
7. Returns { user, token }
8. Browser stores in localStorage
9. Every request: Authorization: Bearer <token> header
10. middleware/auth.js: jwt.verify() -> sets req.user

Signup:
- Validates: fullName required, email format, password >= 6 chars
- bcrypt.hash(password, 10) - 10 rounds (~100ms intentionally)
- Creates user with role "Recruiter" (hardcoded)
- Returns token immediately (no email verification)

Security concern:
- If AUTH_JWT_SECRET not set and NODE_ENV != "production":
  falls back to "dev-local-jwt-secret-change-in-production"
- An attacker who knows this string can forge valid tokens on a misconfigured production server

Role-based access:
- role field exists in JWT
- No route-level role checks found -> all logged-in users have the same access
- UNCLEAR whether admin-level operations are restricted

---

## 8. AI PARTS

### AI Call 1: Resume Parsing
File: node-api/src/ai/resumeParsing.js (161 lines)
Triggered by: resume.uploaded worker
Input: 60-line system prompt + resume raw text
Output: JSON with 40+ fields (name, skills[], visa_status, education[], summary, embedding_text)
Retries: 3 attempts, backoff 1.2s and 2.4s. Auth errors abort immediately.
Failure: resume marked failed in DB
Model: config.model (the smart/slow model)

### AI Call 2: JD Parsing
File: node-api/src/ai/jdParsing.js (143 lines)
Triggered by: jd.uploaded worker
Input: 40-line system prompt with spaCy placeholders (always empty []) + JD text
Output: JSON with title, required_skills[], visa_preferences[], rate, confidence_score
Retries: same 3-attempt pattern
Note: spaCy NLP referenced in prompt but NOT implemented in this codebase

### AI Call 3: Vector Embeddings
File: node-api/src/ai/embedding.js (50 lines)
Triggered by: both JD and resume workers after parsing
Input: concatenated "title + skills + summary" text
Output: 1536-dim float array from OpenAI text-embedding-3-small
Cost optimization: reuse if summary_hash unchanged

### AI Call 4: LLM Match Scoring
File: node-api/src/modules/syntra/workers/matchRequested.worker.js
Triggered by: match.requested queue
Input: full JD text + full resume text
Output: { score: 0-100, reason: "2-sentence explanation" }
Saved to: core.matches.llm_score and core.matches.score_reason

### AI Call 5: Email Classification (Relay)
File: apps/relay/src/classification/ruleClassifier.ts
Method: rule-based by default, optionally LLM when RELAY_LLM_CLASSIFY=true
Output: category (job_requirement, candidate_reply, consent_response, spam, other)

### AI Call 6: Email Reply Drafting (Relay)
File: apps/relay/src/drafting/replyDrafter.ts
Input: email thread context + template type
Output: drafted reply text
If RELAY_AUTO_REPLY=true: sends automatically. Otherwise saves as draft.

### AI Call 7: Orchestrator LLM Nodes
File: packages/orchestrator/src/llm/
Triggered by: workflow graph nodes
Model: LLM_PROVIDER + LLM_API_KEY (separate from node-api AI config)

### Token / Cost Awareness
- No token counting code
- max_tokens defaults to 1500 (from AI_MAX_TOKENS env var)
- No prompt caching
- No budget alerts
- Embedding reuse on unchanged hash is the only cost optimization

---

## 9. EXTERNAL SERVICES AND ENVIRONMENT VARIABLES

Database:
- DATABASE_URL: node-api main Postgres connection (Supabase, port 5432)
- DATABASE_MIGRATOR_URL: apps/worker direct connection
- DATABASE_RELAY_URL: relay Postgres connection

AI:
- AI_PROVIDER: openai / gemini / groq / openrouter (default: openrouter)
- AI_API_KEY: generic key; provider-specific keys override
- AI_MODEL: smart model name
- AI_MODEL_FAST: fast/cheap model name
- AI_EMBEDDING_MODEL: default text-embedding-3-small
- LLM_PROVIDER / LLM_API_KEY: separate for orchestrator nodes

Email Intake (ASTRA):
- IMAP_HOST/PORT/USERNAME/PASSWORD: intake mailbox connection
- IMAP_POLL_ENABLED / IMAP_POLL_INTERVAL_SECONDS: cron control
- JOOBLE_API_KEY, ADZUNA_APP_ID/KEY, APIFY_API_TOKEN: job board APIs
- JOBPIPE_API_KEY/BASE_URL: JobPipe job board

Smart Email Inbox (RELAY):
- EMAIL_PROVIDER: imap or gmail
- GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN/REDIRECT_URI/SENDER_EMAIL: Gmail OAuth
- SMTP_HOST/PORT/USERNAME/PASSWORD: SMTP sending
- RELAY_LLM_CLASSIFY: use LLM for classification
- RELAY_LLM_MODEL: model for relay AI calls
- RELAY_AUTO_REPLY / RELAY_AUTO_CHASE / RELAY_CONSENT_REMIND: automation switches
- RELAY_OUTBOUND_SEND: false = draft only, true = actually send

Orchestration switches:
- PLATFORM_EVENTS_ENABLED (default true): if false, no events to outbox
- ORCH_DELEGATE_MATCH (default true): route matching through orchestrator vs inline
- ORCH_EMIT_JD_RECEIVED (default false): fire event before parsing
- ORCH_ORGANIZATION_ID: fallback org when org can't be determined
- PLATFORM_EVENTS_STRICT (default false): throw vs log on event publish failure

Auth:
- AUTH_JWT_SECRET: signs JWT tokens. Required in production. Falls back to hardcoded dev string.
- PORT: node-api port (default 4000)

---

## 10. GLOSSARY

API (Application Programming Interface)
Like a restaurant menu. Defined list of requests and responses.
In this codebase: node-api/src/app.js defines ~30 routes. USED.

REST
Style of APIs using HTTP verbs: GET=read, POST=create, PATCH=update, DELETE=remove.
USED.

JWT (JSON Web Token)
Signed string proving identity. Like a concert wristband.
In this codebase: 7-day expiry, payload: { userId, email, role, orgId }. USED.

Middleware
Code that runs on every request before the handler. Like a security checkpoint.
In this codebase: auth.js, errorHandler.js, upload.js. USED.

Zod / Validation
Library that checks if data has the right shape. Like checking ID format at a bar.
In this codebase: auth signup/login, AI output validation. USED.

ORM (Object Relational Mapper)
Write DB queries in your language instead of SQL.
In this codebase: relay uses Drizzle ORM. node-api uses raw SQL. PARTIALLY USED.

pg-boss
Job queue stored in Postgres. Like a take-a-number system.
In this codebase: 9 queues, central to the whole system. USED.

Queue / Background Job
Task that runs separately from the web request.
In this codebase: File uploads queue AI parsing for background processing. USED.

Cron / Scheduler
Code that runs automatically on a timer.
In this codebase: astra.email.poll scheduled via pg-boss.schedule(). USED.

Transaction
DB operations that all succeed or all fail together.
In this codebase: withTransaction() in db.js, outbox-relay atomic enqueue. USED.

Transactional Outbox
Write event to your own DB; separate process delivers it. Prevents event loss.
In this codebase: orch.event_outbox + outbox-relay.worker.ts. USED.

LLM (Large Language Model)
AI model that understands and generates text.
In this codebase: resume parsing, JD parsing, match scoring, email drafting, orch nodes. USED.

Prompt
Instructions sent to an LLM.
In this codebase: RESUME_PARSING_PROMPT (60 lines), JD_PARSING_PROMPT (40 lines). USED.

Vector Embedding
Text converted to 1536 numbers representing meaning.
In this codebase: embedding.js, stored in core.embeddings, used for matching. USED.

pgvector
Postgres extension for vector columns and nearest-neighbor search.
In this codebase: core.embeddings uses vector(1536). USED.

RAG (Retrieval Augmented Generation)
Find relevant docs with vector search, then give to LLM.
In this codebase: matching funnel uses vector similarity. Partial RAG. PARTIALLY USED.

Multi-tenant / org_id
One system, multiple companies, isolated by org_id.
In this codebase: org_id on every major table. USED.

RLS (Row Level Security)
Postgres refuses to return wrong-tenant rows at the DB level.
In this codebase: Enabled in migrations. NOT activated at runtime by node-api. PARTIALLY USED.

Migration
Versioned SQL file changing the schema.
In this codebase: 85 files in packages/db/migrations/. USED.

LangGraph
Framework for multi-step AI workflows as directed graphs.
In this codebase: apps/worker compiles and runs workflow graphs. State checkpointed. USED.

MCP (Model Context Protocol)
Standard for LLMs to call external tools.
In this codebase: Mentioned in comments. No implementation. MENTIONED BUT NOT IMPLEMENTED.

Idempotency
Running twice gives the same result as running once.
In this codebase: Match inserts use ON CONFLICT DO NOTHING. Event dedup by event_id. USED.

Retry / Backoff
Try again after failure, waiting longer each time.
In this codebase: pgRetry.js, AI parsing 3-attempt with 1.2s/2.4s delays. USED.

Dead-Letter Queue (DLQ)
Where failed jobs go after all retries.
In this codebase: DISPATCH_DLQ defined in outbox-relay.worker.ts. Whether used in practice: UNCLEAR.

Drizzle ORM
TypeScript-first ORM generating SQL from schema definitions.
In this codebase: apps/relay/src/db/ for email tables. USED.

Fastify
Fast Node.js HTTP framework.
In this codebase: relay, apps/api, apps/admin-api. USED.

SSR (Server Side Rendering)
HTML generated on server, not browser.
In this codebase: NOT USED. Front and admin are SPAs.

Rate Limiting
Prevent too many requests from one user too fast.
In this codebase: NOT FOUND. MISSING.

spaCy
Python NLP library for named entity recognition.
In this codebase: Referenced in JD parsing prompt. No code found. MENTIONED BUT NOT IMPLEMENTED.

Flyway
DB migration tool. V{version}__{description}.sql naming.
In this codebase: 85 files follow Flyway conventions. USED.

Supabase
Hosted Postgres. This project uses only the database.
In this codebase: All DB URLs point to Supabase. USED.

---

## 11. BLOAT AND WASTE REPORT

| File | Lines | Verdict | Reason | Action |
|------|-------|---------|--------|--------|
| node-api/.../match.repository.js | 746 | BLOATED | All match SQL in one file; complex lateral join views; split into reads + writes | Split into matchReads.js + matchWrites.js |
| prism/services/prism.workflow.service.js | ~1900 | BLOATED | 74KB, inline email templates, multi-step state machines, impossible to test | Extract templates + step handlers |
| apps/relay/src/buildRelayApp.ts | 589 | BLOATED | Routes + mailbox sync + reply logic + send all in one file | Split into routes, sync, reply workflow |
| syntra/workers/resumeUploaded.worker.js | 176 | BLOATED | validateResumeDocument() is copy-paste of validateJdDocument() with one condition flipped | Extract shared validateDocumentType() |
| node-api/src/ai/jdParsing.js | 143 | BLOATED | 90% identical to resumeParsing.js | Extract shared aiParse() base function |
| apps/worker/src/workers/outbox-relay.worker.ts | 425 | BLOATED | Polling + batching + transaction + routing + DLQ all in one file | Split: polling vs delivery logic |
| packages/orchestrator/src/graphs/compiler.ts | ~600 | BLOATED | Compile + resolve + policy + LangGraph wiring in one class | Extract compilation steps |
| node-api/src/controllers/match.controller.js | 0 | DEAD | Empty (0 bytes). Not imported. | Delete |
| node-api/src/routes/match.routes.js | 0 | DEAD | Empty (0 bytes). Not imported. | Delete |
| node-api/src/routes/index.js | 0 | DEAD | Empty (0 bytes). Not imported. | Delete |
| node-api/src/repositories/processedEvents.repository.js | 0 | DEAD | Empty (0 bytes). Not imported. | Delete |
| node-api/src/modules/syntra/matchCoordinator.js | 0 | DEAD | Empty (0 bytes). Not imported. | Delete |
| node-api/src/_extract_api.py | ~80 | DEAD | Python dev script at source root. Not imported. | Delete |
| node-api/src/_extract_api2.py | ~40 | DEAD | Second Python script. Not imported. | Delete |
| node-api/src/dump-tier.js | ~30 | DEAD | Dev utility at source root. Not imported. | Delete |
| node-api/src/test-*.js (4 files) | ~310 | DEAD | Manual test scripts at source root, not in tests/ folder | Delete or move to tests/ |
| scripts/copy-delta.mjs | 37KB | POINTLESS | One-off 37KB data migration script for copying between DB projects | Remove from repo |
| scripts/ (other 34 files) | varies | BLOATED | Mix of demos, one-off scripts; not production code | Move to /devtools; delete one-offs |

---

## 12. FINAL SUMMARY

### What Is Well Built

1. pg-boss queue: correctly set up, workers clean, graceful shutdown works.
2. Transactional outbox: enqueue + mark-published in one atomic transaction prevents event loss.
3. AI parsing with retry: 3 attempts, backoff, auth errors abort fast, output validated before save.
4. Two-tier matching funnel: simple, correct, easy to follow.
5. Event catalogue check at boot: if an event type is unknown to the DB, it logs loudly at startup.
6. 85 well-named database migrations that tell the full schema history.
7. Multi-tenant isolation (org_id) consistently applied.
8. Embedding reuse when summary_hash unchanged (saves API cost).

### What Is Over-engineered or Wasted

1. Two separate AI configs (node-api vs orchestrator). One unified config would be cleaner.
2. syntra->core mirror via DB triggers adds complexity. Should be removed when core is confirmed as source of truth.
3. 35 dev scripts in /scripts including a 37KB one-off.
4. 5 empty files.
5. Copy-paste document-type detection function in two workers.
6. jdParsing.js and resumeParsing.js are 90% identical code.

### What Is Risky or Fragile

1. NO RATE LIMITING on LLM-triggering upload endpoints. Unlimited AI cost exposure. PRIORITY: HIGH.
2. JWT secret falls back to a hardcoded dev string if NODE_ENV != "production". Forged tokens possible on misconfigured server.
3. RLS defined in DB but node-api does not activate it. Tenant isolation relies only on application WHERE clauses.
4. Supabase pooler cap (~15 total connections). Exceeding it breaks silently.
5. Silent event publish failures by default (PLATFORM_EVENTS_STRICT=false). Matches created but scoring events lost.
6. No automated tests for the matching funnel. The core business logic is untested.
7. RELAY auto-send (RELAY_AUTO_REPLY=true) can email wrong people if misconfigured.
8. prism.workflow.service.js at 74KB is untestable and fragile to change.

### Parts Planned But Not Really Built

1. spaCy NLP - referenced in prompt, no code exists
2. MCP (Model Context Protocol) - mentioned, not implemented
3. packages/db/repositories/ - empty directory
4. apps/web - minimal skeleton only
5. Rate limiting - not found anywhere
6. Full RLS enforcement in node-api
7. Cost/token tracking
8. Prompt caching
9. Full role-based access control

### Top 10 Things to Fix (Priority Order)

1. Add rate limiting to all LLM-triggering upload endpoints (express-rate-limit).
2. Make AUTH_JWT_SECRET required in all environments. Remove hardcoded fallback.
3. Delete the 5 empty files. Takes 5 minutes.
4. Deduplicate the document-type detection function in both workers.
5. Deduplicate AI parse retry logic from resumeParsing.js and jdParsing.js.
6. Add unit tests for tier2Rank.js (skill scoring) and funnel.js (filtering).
7. Move dev/test scripts out of source tree to /devtools.
8. Activate RLS in node-api by setting app.org_id at auth middleware time.
9. Remove syntra->core mirror triggers when core is confirmed as source of truth.
10. Split prism.workflow.service.js (74KB) into focused files.

### What a Beginner Should Learn First, In Order

1. JavaScript basics: variables, functions, async/await
2. Node.js and Express: web servers, routes, middleware
3. Postgres SQL: SELECT, INSERT, JOIN, transactions, indexes
4. REST APIs: HTTP verbs, status codes, JSON
5. React basics: components, useState, useEffect, SPAs
6. JWT authentication: token signing, verification, expiry
7. pg-boss / job queues: background work, reliability
8. LLM prompting: system prompts, structured JSON output, retry patterns
9. Vector embeddings: what 1536 numbers mean, cosine similarity
10. Event-driven architecture: outbox pattern, LangGraph graphs, checkpoint state
