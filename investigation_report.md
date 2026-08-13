# Orchestration Flow Investigation Report

## 1. Source for Picture C (jd.uploaded, etc.)
**Zero call sites found.** 
I searched the entire monorepo for `jd.uploaded`, `resume.uploaded`, `match.requested`, `runForJob`, `runForResume`, `topics.js`, and `eventTypes.js`. 
- There are no `boss.send()` or `boss.work()` calls for those queues.
- `apps/api/src/index.ts` is an empty stub (`// TODO: Add the Fastify API entry point.`). There are no `POST /jobs` or `POST /resumes` route handlers.
- **Conclusion**: Picture C physically does not exist in this monorepo. It describes a completely different or legacy codebase.

## 2. event_outbox Writers
**Zero call sites found.**
I grepped the entire monorepo for `INSERT INTO event_outbox`. 
- The table is created in migrations (`packages/db/migrations/V3 — Agentic spine.sql`).
- It is selected/updated by the relay (`packages/orchestrator/src/relay/relay.ts`).
- There is absolutely no application code writing to this table in the live flow today.

## 3. orchestration.dispatch Consumer
**A consumer exists.**
`apps/worker/src/bootstrap-pgboss.ts` consumes this queue.
```typescript
// apps/worker/src/bootstrap-pgboss.ts:13-17
await boss.work('orchestration.dispatch', {
  teamSize: 5, // Concurrency support
  teamConcurrency: 5,
  newJobCheckInterval: 500
}, async (job) => {
```

## 4. packages/orchestrator Imports
**It is imported by the worker.**
Outside of tests, it is imported by `apps/worker/src/bootstrap-pgboss.ts`:
```typescript
// apps/worker/src/bootstrap-pgboss.ts:3-4
import type { PolicyEngine } from '@tekisho/orchestrator/src/policy/engine';
import { runWorkflow } from '@tekisho/orchestrator/src/workflow/runner';
```
*(Note: These imports use deep paths into `/src/` instead of the package root exports, but they are physically there).*

## 5. Are these pictures connected?
**Picture A and Picture B are wired together in a vacuum, but are 100% DISCONNECTED from Picture C.**
Picture C does not exist here. Picture A (the orchestrator) and Picture B (the outbox and worker) are connected to each other: the relay reads from `event_outbox` -> pushes to pg-boss `orchestration.dispatch` -> the worker consumes it -> calls the orchestrator `runWorkflow`. However, because **nothing** writes to `event_outbox`, this entire engine is currently an idling, isolated island of code with zero live traffic.

---

### Diagram: What ACTUALLY happens today when a JD or resume is uploaded
```
[JD / Resume Upload]
       |
       v
  (Nothing happens. The API routes do not exist in this repo.)
```

### If I publish an event shaped like 'requirement.created' or 'syntra.jd.received' right now, does anything react to it?
**No.** 
If you simply publish it as an in-memory event, nothing reacts. However, if you manually insert a row into the `event_outbox` database table (and the corresponding `events` table), the `OutboxRelay` *would* pick it up, send it to pg-boss, and the worker *would* pass it to the `PolicyEngine`.

### Shortest path to participate in a real JD upload today
Because the "real" JD upload API routes (Picture C) do not exist in this monorepo, the shortest path requires two things:
1. **Rebuild the missing API**: You must write the `POST /jobs` and `POST /resumes` route handlers in `apps/api`.
2. **Write to the outbox**: Those route handlers must perform a transactional `INSERT INTO events` and `INSERT INTO event_outbox`. Once they do that, the existing relay, worker, and orchestrator (Pictures A & B) will automatically wake up and process the events.
