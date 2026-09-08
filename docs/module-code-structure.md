# Where module code goes

**Status:** proposal · needs the modules lead's agreement before any file moves
**Date:** 2026-09-07
**Follows:** Part 2 of the target database design (`Bench_Sales_System_Reference_NEW.docx`)

---

## Why this exists

`node-api` is organised **horizontally** — `routes/`, `controllers/`,
`services/`, `repositories/`, `workers/`. Each application is a diagonal cut
through five or six of them, so there is no answer to "where does my new file
go" beyond "wherever the last one went".

That is not hypothetical. ORBIT's controllers are called `lifecycle`,
`placement` and `activity` — no module marker anywhere in the name, even though
all three require `../services/orbit/orbitDelegate.service`. Somebody made that
choice and nothing stopped them, so a path rule cannot find ORBIT's code today
and a reviewer only catches it by knowing.

`adapters/` shows the other way round: one file per node, the filename derived
from the key, and a README saying what may not go in there. That directory has
not drifted.

## The layers, and why they are these layers

They are the same four the database design uses, for the same reasons. Code that
mirrors the schema is code where "which layer is this?" has one answer.

| Layer | Holds | Rule of thumb |
|---|---|---|
| `platform/` | Identity, tenancy, commerce | Who is asking, and what have they paid for |
| `core/` | The shared business entities — people, requirements, resumes, matches, activities | Several applications read it; at least one writes it |
| `modules/<app>/` | Only that application's own state and behaviour | Nothing another application reads |
| `shared/` | Database handle, middleware, config, utilities | No business meaning at all |

The important layer is the third, and the important thing about it is what it
does **not** contain. §2.8 of the design puts it exactly: SYNTRA has ten tables
and only three are SYNTRA's, *"because jobs, candidates, resumes and matches
were never SYNTRA's — they are the business."*

The same is true of the code. `job.repository.js` is not SYNTRA's data layer; it
is the requirement entity's data layer, which SYNTRA happens to be the only
current caller of. `matching/tier2Rank.js` **is** SYNTRA's, and stays SYNTRA's.

## The target tree

```
node-api/src/
  app.js  server.js     the composition root
  platform/             users, organisations, dashboard, stats
  core/                 people · requirements · resumes · matches
                        · activities · embeddings · processing · source_files
  modules/
    syntra/             matching behaviour, scoring, review queue
    astra/              intake — channels, mailbox, job boards
    orbit/              bench — lifecycle, placement, activity notes
  orchestration/        outbox, platform events, processed events, event names
  shared/               config, db, logger, middleware — no business meaning
```

Each module directory holds its own `routes/`, `controllers/`, `services/`,
`repositories/` and `workers/`. The horizontal folders survive **inside** a
module, where they are useful, and stop being the top level, where they are not.

**Fifteen top-level directories become six.** `ai/` splits across `core/` and
`modules/syntra/`; `coordinator/` (one file) folds into SYNTRA; `matching/` and
`consumers/` survive inside SYNTRA; and `config/`, `constants/`, `middleware/`,
`utils/` and `validation/` become `shared/` — minus the five files below that
turned out to have business meaning.

### The small folders were hiding module code

This is the real argument against the current layout, not tidiness:

```
utils/profitability.js  →  "Profitability Calculation for Placed Candidates in ORBIT"
```

ORBIT's business logic, in a folder called `utils`. Four more like it:

| File | What it actually is | Goes to |
|---|---|---|
| `utils/profitability.js` | ORBIT placement profit calculation | `modules/orbit/` |
| `utils/actionNeeded.js` | is a consultant record complete | `core/people/` |
| `validation/candidateValidation.js` | email/phone/URL rules for candidates | `core/people/` |
| `validation/duplicateValidation.js` | duplicate resume by `raw_text` | `modules/syntra/` |
| `constants/eventTypes`, `platformEvents`, `topics` | event names | `orchestration/` |

The folders group by **what a file is** — a util, a constant, a validator —
rather than **what it is for**. That is why ORBIT's code cannot be found by a
path, and why `shared/` must not simply inherit all five directories wholesale.

## Where today's files land

Grounded in what is in the tree now, not invented.

### `modules/astra/` — the cleanest case, because it is already named

| Today | Goes to |
|---|---|
| `routes/astra.routes.js`, `routes/internal.astra.routes.js` | `modules/astra/routes/` |
| `controllers/astra.controller.js` | `modules/astra/controllers/` |
| `services/astra/` (4 files) | `modules/astra/services/` |
| `repositories/astra.repository.js` | `modules/astra/repositories/` |
| `workers/astraEmailPoller.worker.js`, `workers/astraRequirementReceived.worker.js` | `modules/astra/workers/` |
| `routes/jobBoards.routes.js`, `controllers/jobBoards.controller.js` | `modules/astra/` — job boards are ASTRA channels (§2.9) |

### `modules/orbit/` — the case that proves the problem

| Today | Goes to |
|---|---|
| `routes/internal.orbit.routes.js` | `modules/orbit/routes/` |
| `controllers/lifecycle.controller.js`, `placement.controller.js`, `activity.controller.js` | `modules/orbit/controllers/` |
| `repositories/lifecycle.repository.js`, `placement.repository.js` | `modules/orbit/repositories/` |
| `services/orbit/` (3 files) | `modules/orbit/services/` |

None of those controller or repository names contain "orbit". After the move,
the path says what the name does not.

### `modules/syntra/` — behaviour, not entities

| Today | Goes to |
|---|---|
| `matching/` (funnel, tier1Filter, tier2Rank) | `modules/syntra/matching/` |
| `coordinator/matchCoordinator.js` | `modules/syntra/` |
| `services/match.service.js`, `services/matchEnqueue.js` | `modules/syntra/services/` |
| `services/recruiterReview.service.js` plus its route, controller and repository | `modules/syntra/` — becomes `syntra.review_queue` |
| `consumers/` (jdProcessed, matchCompleted, resumeProcessed) | `modules/syntra/consumers/` |
| `workers/jdUploaded`, `matchRequested`, `resumeUploaded` | `modules/syntra/workers/` |

### `core/` — the entities that were never SYNTRA's

| Today | Goes to |
|---|---|
| `repositories/candidate.repository.js` | `core/people/` |
| `repositories/job.repository.js` | `core/requirements/` |
| `repositories/resume.repository.js` | `core/resumes/` |
| `repositories/match.repository.js` | `core/matches/` |
| `repositories/activity.repository.js` | `core/activities/` |
| routes and controllers for candidate, job, match, matches, resume | alongside their entity |
| `services/job.service.js`, `services/resume.service.js` | alongside their entity |

### `platform/`, `orchestration/`, `shared/`

| Today | Goes to |
|---|---|
| `routes/auth`, `controllers/auth`, `services/auth`, `repositories/user` | `platform/` |
| `repositories/outbox`, `repositories/processedEvents`, `services/platformEvents` | `orchestration/` |
| `services/orchestrationActivity` plus its route and repository | `orchestration/` |
| `config/`, `constants/`, `middleware/`, `utils/`, `validation/`, `core/aiClient.js` | `shared/` |

## The twenty-one that needed a decision — settled 2026-09-07

Nineteen per cent of the tree could not be placed from its filename. All are
now decided, with the reasoning, so nobody has to guess later.

### The AI wrappers split three ways

All four are thin wrappers over the LLM client with no other dependency.

| File | Goes to | Why |
|---|---|---|
| `ai/embedding.js` | `core/embeddings/` | §2.5 gives `core.embeddings` a table keyed by model and version |
| `ai/jdParsing.js` | `core/requirements/` | parsing produces the entity, and ASTRA parses too |
| `ai/resumeParsing.js` | `core/resumes/` | same |
| `ai/matching.js` | `modules/syntra/` | §2.8 — matching behaviour is SYNTRA's |

### `ai.controller.js` is split, not moved

Three stateless endpoints, no database access, each a thin wrapper over one
function. `summarizeJdEndpoint` → `core/requirements/`, `summarizeResumeEndpoint`
→ `core/resumes/`, `scoreMatchEndpoint` → `modules/syntra/`. `ai.routes.js`
follows.

Kept whole it would import from `core/requirements`, `core/resumes` **and**
`modules/syntra` — a file that breaks the layering by construction and would
need a permanent exception. Split, it needs none, and each wrapper sits beside
the function it wraps. `scoreMatchEndpoint` in particular is a core-looking
controller exposing SYNTRA's scoring over HTTP, which is the coupling being
removed.

### One duplicate, and it is dead

`services/fileExtractor.js` and `services/extraction/fileExtractor.js` both
export `extractText` and are **not identical**. Only `extraction/` is imported —
by `job.service.js` and `resume.service.js`, the only two references anywhere in
`node-api`.

**Delete `services/fileExtractor.js`.** Keep `extraction/fileExtractor.js` →
`core/source_files/`. The live one is also the better one: it checks
`fs.access` and reports "File not found" before parsing.

### The rest

| File | Goes to | Why |
|---|---|---|
| `repositories/ai.repository.js` | `core/processing/` | `markJobProcessing`, `saveJobSummary`, `markJobFailed` across jobs, resumes and matches — this is §2.5's `core.processing_jobs`, already written |
| `repositories/skill.repository.js` | `core/requirements/` | queries `syntra.jobs` for skills; a query over requirements, not a taxonomy |
| `controllers/jobBoards.controller.js`, `routes/jobBoards.routes.js` | `modules/astra/` | requires `services/astra/adapters/jobBoard.adapter` |
| `routes/internal.routes.js` | `modules/syntra/routes/internal.syntra.routes.js` | SYNTRA's internal surface — the endpoints adapters call. `internal.astra.routes.js` and `internal.orbit.routes.js` already exist; this is the one never split out |
| `routes/index.js` | **delete** | zero lines |
| `app.js`, `server.js` | stay at `src/` | the composition root |

### Dashboard and stats go to `platform/`

A dashboard belongs to the platform, not to any one application.

Two consequences worth writing down:

**`middleware/auth.js` goes to `shared/`, not `platform/`.** Otherwise there is
a cycle: `dashboard.controller` imports ORBIT's `lifecycle.repository`, while
ASTRA's `jobBoards.routes` imports `middleware/auth` — so `platform → module →
platform`. Auth reads a Bearer token, verifies a JWT and sets `req.user`. That
is plumbing; `platform/` holds users, organisations and entitlements.

**Dashboard's one module import is a time-limited exception.** It reads ORBIT's
`lifecycle.repository`, and §2.5 already names `core.placements` as a future
core entity. The dependency disappears with the schema move, so it is recorded
as temporary rather than as a standing rule.

### A name collision to fix on the way past

`src/core/aiClient.js` already uses the name `core` — for an LLM client. The
new `core/` means shared business entities. `aiClient.js` moves to `shared/`
regardless, and it must, or the first thing a new developer learns is that
`core` means two unrelated things.

## The rules

1. **A module never imports another module.** Cross-application work goes
   through `core/`, through an event, or not at all. Mirrors design rule 5.
2. **A module never adds to a `core/` entity for its own purposes.** It keeps
   its own table and its own code. Mirrors design rule 4.
3. **`core/` and `platform/` may be imported by anyone.**
4. **`shared/` holds nothing with business meaning.** If it knows what a
   candidate is, it does not belong there.
5. **A file's path names its owner.** If it lives under `modules/orbit/`, ORBIT
   owns it — which is what makes CODEOWNERS work at all.
6. **The composition root may import anything; nothing may import it.**
   `app.js` mounts every route and `server.js` boots the workers and the queue.
   That is the same job `apps/worker` does for the node registry, and it is the
   only place allowed to know about every layer at once.

## Enforcement, because a convention nobody checks is not a rule

This repository has the receipts. `adapters/README.md` promises that
`registry:check` *"can verify a file sits where its key says"*, and **there is no
such script** — CI only typechecks. CODEOWNERS is written and switched off.
ORBIT's controllers drifted while `services/orbit/` already existed.

So this lands with a check or it does not land:

- `npm run check:structure` — fails when a file under `modules/<a>/` imports
  from `modules/<b>/`, and when anything under `shared/` imports a module or
  `core/`.
- Added to CI beside `typecheck` and `tests`.
- CODEOWNERS turned on in the same change, so the paths mean something to
  GitHub too.

## Order

**SYNTRA first, as the worked example.** §2.8 calls it *"the clearest
illustration of the whole model"*, and its split is the most instructive one:
its entities go to `core/` and only its behaviour stays. A team that reads that
one pull request understands the model.

**ASTRA second, guided.** §2.9 calls ASTRA *"the test of whether the model
works"* — it has no tables of its own today and reaches directly into SYNTRA's.
Its team does the move, with SYNTRA's pull request as the reference and this
document as the rule.

**ORBIT third, by its own team**, and by then nobody should need to ask.

Each is its own pull request against `node-api`, independently revertible.

**No table moves in any of them.** The SQL inside a repository still says
`syntra.jobs` until the database migration happens. That is deliberate: it keeps
this change reviewable on its own, and it means the later schema move edits
`core/` instead of grepping 342 files for a table name.
