# Moving a module into its own directory

**Who this is for:** whoever owns a module in `node-api` — SYNTRA, ASTRA, ORBIT,
and the applications after them.

**What it gets you:** your code in one place, with a path that says it is yours;
the ability to ship without coordinating with another team; and, later, the
ability to take your module out into its own service as a move rather than an
untangling.

**Read `docs/module-code-structure.md` first** for where things go. This is how
to get them there.

---

## Part 1 · The idea

### The problem

`node-api/src` is organised **horizontally**: `routes/`, `controllers/`,
`services/`, `repositories/`, `workers/`. Every application is a diagonal cut
through five or six of them.

Look at what one folder holds today:

```
services/astra/                    ASTRA
services/orbit/                    ORBIT
services/auth.service.js           platform
services/job.service.js            a shared business entity
services/platformEvents.service.js the orchestrator
```

Five owners, one folder. The folder name tells you **what kind of file** it is.
It tells you nothing about **whose it is**.

That is not an aesthetic complaint. It has consequences you can point at:

- ORBIT's controllers are called `lifecycle`, `placement` and `activity`. No
  module marker anywhere, even though all three import
  `services/orbit/orbitDelegate.service`. A path rule cannot find ORBIT's code.
- `utils/profitability.js` opens with *"Profitability Calculation for Placed
  Candidates in ORBIT"* — a module's business logic, in a folder called `utils`.
- Nobody can answer "where does my new file go?" with anything better than
  "wherever the last one went".

### The fix, in one sentence

**The horizontal names move down one level.**

```
BEFORE — folder names the file kind; the owner is invisible

  src/services/astra/…               who owns this? the path does not say
  src/services/match.service.js      SYNTRA's, but nothing says so
  src/services/job.service.js        shared, but nothing says so


AFTER — folder names the owner; the subfolder names the kind

  src/modules/astra/services/…       ASTRA's
  src/modules/syntra/services/…      SYNTRA's
  src/core/requirements/…            everyone's
```

`routes`, `controllers`, `services`, `repositories`, `workers` are good names.
They were just at the wrong level.

### So every layer looks the same inside — and that is the point

You will see `services/` in your module and `services/` in another. That is
deliberate: you always know where to look in any layer. **What differs is whose
code is in it.**

### The layers

| Layer | What it holds |
|---|---|
| `platform/` | identity, tenancy, who is asking and what they have paid for |
| `core/` | the shared business entities — people, requirements, resumes, matches |
| `modules/<you>/` | your own state and behaviour, that nobody else reads |
| `orchestration/` | outbox, platform events, event names |
| `shared/` | database handle, logger, middleware — nothing with business meaning |

### The distinction that decides everything

**Entities are core. Behaviour is yours.**

SYNTRA has ten database tables and only three are SYNTRA's, because `jobs`,
`candidates`, `resumes` and `matches` are the business, not the application.
ORBIT needs immigration status to place someone; TEMPO needs contact details to
schedule. Those attributes were never SYNTRA's just because SYNTRA is where they
happen to live.

The same is true of the code:

- `job.repository.js` is **not** SYNTRA's data layer. It is the requirement
  entity's data layer, which SYNTRA happens to be the only current caller of.
- `matching/tier2Rank.js` **is** SYNTRA's, and always will be.

When you inventory your module, expect to find that some of what you thought was
yours is actually the business's.

### Five rules

1. **Your module never imports another module.** Cross-application work goes
   through `core/`, through an event, or not at all.
2. **You never add to a `core/` entity for your own purposes.** You keep your own
   table and your own code.
3. **`core/` and `platform/` may be imported by anyone.**
4. **`shared/` holds nothing with business meaning.** If it knows what a
   candidate is, it does not belong there.
5. **`app.js` and `server.js` may import anything; nothing may import them.**
   They are the composition root — the one place allowed to know every layer.

Rule 1 is checked by CI. The rest are checked by review, for now.

---

## Part 2 · Doing it

### Step 0 · Find your files

They are scattered, and **not all of them have your name on them**. Three ways
to find them, and you need all three:

```
# by name
find node-api/src -iname "*<yourmodule>*"

# by what imports your services — this is how ORBIT's unnamed controllers
# are found
grep -rn "services/<yourmodule>" node-api/src

# by what your services import back
grep -rn "require(" node-api/src/services/<yourmodule>/
```

Write the list down before you move anything. Then check it against
`docs/module-code-structure.md`, which already maps every file in the tree.

### Step 1 · Pure moves only

Move the files. Rewrite the paths. **Change nothing else.**

- No logic changes.
- **No SQL and no table names.** Your repository still says `syntra.jobs` after
  the move. Table names change when the schema changes, which is a separate
  piece of work with separate risks.
- No renaming beyond what the structure doc specifies.

**Script the import rewrite.** Do not do it by hand. Both directions change:

- the moved file's **own** requires, because its depth changed
- every requires **pointing at** the moved file, from files that stayed

Ask for the mover script rather than writing your own — it resolves each
require the way Node does (exact, then `.js`, then `/index.js`), maps old path
to new, and recomputes the relative path from the new location. It also does a
dry run first, which you should read.

### Step 2 · Fix what is left

After the move, run:

```
grep -rn "modules/<yourmodule>" node-api/src --include=*.js | grep -v "^node-api/src/modules/"
```

Every line is something outside your module reaching into it. Two kinds:

**Legitimate** — `app.js` and `server.js` mounting your routes and registering
your workers. That is rule 5 working. Leave them.

**Everything else** is a boundary violation, and there are exactly three fixes.

#### Pattern A · Split — the file was doing two jobs

The most common one. A controller holds read endpoints for a core entity *and*
write endpoints that run your behaviour.

> `matches.controller.js` had eight endpoints reading matches and three running
> SYNTRA's funnel. Kept whole, it had to import `modules/syntra` from a core
> file — so every application that ever reads a match would inherit a dependency
> on SYNTRA.

Cut at the function boundary. The core half stays; your half moves to
`modules/<you>/controllers/`. Split the route file the same way and mount both
in `app.js` — the URLs do not change.

**Use this when** one file serves two owners.

#### Pattern B · Reclassify — it was never yours

Sometimes the import is only a violation because the file is in the wrong place.

> `duplicateValidation.js` checks whether a resume with the same `raw_text`
> already exists. That is resume-entity integrity — "do not store the same
> document twice" — not matching behaviour. It went to core, and the violation
> disappeared without anything being split.

**Use this when** the file is about an *entity*, not about your behaviour. Ask:
if my module were deleted tomorrow, would this still need to exist? If yes, it
is not yours.

#### Pattern C · Invert — something outside genuinely needs to trigger you

The real ones. Code elsewhere finishes some work and then calls into your module
to react.

> `bulkSaveJobs` activated jobs and then called SYNTRA's funnel directly:
> `runForJob(jobId).catch(err => log.error(...))` — fire-and-forget, so a failed
> run vanished into a log line nobody reads.

Publish a fact; answer it in a worker:

```js
// in the entity service — announce what happened
await getBoss().send("job.activated", { jobId });

// in modules/<you>/workers/ — decide what to do about it
boss.work("job.activated", { teamSize: 1, batchSize: 5 }, handleJobActivated);
```

**A queue name is a message, not a dependency.** Nothing is imported, so the
boundary holds — and the work becomes retryable and visible in `pgboss.job`
instead of being a swallowed promise.

Declare the queue in `config/queue.js` and register the worker in `server.js`.
**No migration is needed** — pg-boss manages its own tables.

**Name the event as a fact, not a command.** `job.activated`, not
`run_the_funnel`. The entity service says what happened; what you do about it is
your business, and another application can answer the same fact later without
either of you changing.

**Use this when** the caller does not use a return value. If it needs an answer
synchronously, Pattern C will not work — reach for A or B.

#### Choosing between them

| The file… | Fix |
|---|---|
| does two unrelated jobs | **A** — split |
| is about an entity, not your behaviour | **B** — reclassify |
| is called after something happens, and no answer is used | **C** — invert |
| is called and its return value is used immediately | **A** or **B**, never C |

One test that saves an argument: a caller that only *enqueues* on a queue your
module consumes is **not** a violation. It imports nothing of yours.

---

## Part 3 · Proving it worked

Three checks, in order of speed.

### 1 · The wiring test

```
npx vitest run node-api/structure.test.js
```

Four checks, **no database needed**: every file resolves, every relative require
resolves, no module imports another, nothing imports the composition root.

A stale require fails at **load** time in CommonJS, so this catches essentially
every mechanical mistake a move can make, and names the missing module. It runs
in CI as `node-api — module boundaries`.

### 2 · Boot it

```
npm run dev:syntra-api
```

Wait for `HTTP server listening on http://localhost:4000`. This exercises
`server.js`, which the wiring test deliberately does not run — it registers
workers and starts the queue.

### 3 · Probe your moved endpoints — without writing anything

Mint a token; no login, no signup row:

```
cd node-api && node -e "const j=require('jsonwebtoken');const e=require('./src/config/env');console.log(j.sign({userId:'00000000-0000-4000-8000-000000000001',email:'probe@local',role:'admin'},e.AUTH_JWT_SECRET,{expiresIn:'1h'}))"
```

Then call each moved endpoint **with an id that does not exist**:

```
curl -i -X POST "http://localhost:4000/<your-route>/00000000-0000-4000-8000-000000000000/..." \
  -H "Authorization: Bearer $TOKEN"
```

**A JSON 404 is success.** It proves the route registered, your controller
loaded, and its imports resolved — because the handler looked the record up and
threw before doing any real work.

**An HTML "Cannot POST" page is the failure to look for.** That is Express
saying no route matched.

> Do not verify a moved write endpoint by actually running it. Many of them
> write rows and queue AI work. A 404 probe proves the same wiring and writes
> nothing.

---

## Part 4 · Traps

Every one of these was hit for real while moving SYNTRA.

**A moved file's own requires change too.** Easy to remember the files pointing
*at* what you moved, easy to forget that the moved file's `../config/db` is now
`../../../config/db`. The wiring test catches it immediately.

**Do not edit a string at an index you computed before editing it.** Deleting a
line shifts every offset after it. Compute, then cut — or cut, then compute.
This truncated a controller mid-statement.

**A read endpoint and a write endpoint in one controller are two files.** If you
find yourself about to write "this file is allowed to import a module because…",
you have found a Pattern A split.

**Fire-and-forget across a boundary was already broken.** When you replace
`doThing().catch(log)` with a queue message, you are not risking a regression —
you are fixing an error that used to disappear. Say so in the commit message,
because a reviewer will read "direct call became async" as a risk.

**Do not touch the database.** No table renames, no SQL edits, no migrations.
A move that changes only paths is reviewable in an afternoon. One that also
changes schema is not reviewable at all.

**Half-migrated is fine.** While your module is out and others are not, the tree
has both `src/services/` and `src/modules/<you>/services/`. It looks like
duplication. It is not — the top-level folders are a remainder that empties as
each module leaves. The application runs correctly throughout.

---

## Part 5 · Your first one — ASTRA

ASTRA is the easiest module to move, and it is worth understanding why: **its
files already carry its name.** `astra.routes.js`, `astra.controller.js`,
`astra.repository.js`, `services/astra/`. Somebody followed a convention, and
the reward is that a path rule can find every one of them.

Compare ORBIT, where the same code is called `lifecycle`, `placement` and
`activity`, and can only be found by reading imports.

### What moves — 19 files

| From | To |
|---|---|
| `routes/astra.routes.js`, `routes/internal.astra.routes.js` | `modules/astra/routes/` |
| `controllers/astra.controller.js` | `modules/astra/controllers/` |
| `services/astra/**` | `modules/astra/services/` |
| `repositories/astra.repository.js` | `modules/astra/repositories/` |
| `workers/astraEmailPoller.worker.js`, `workers/astraRequirementReceived.worker.js` | `modules/astra/workers/` |
| `routes/jobBoards.routes.js`, `controllers/jobBoards.controller.js` | `modules/astra/` — job boards are ASTRA channels |

### What it costs

**28 require-lines change**, and **only `app.js` and `server.js` need editing
outside the module** — both the composition root, both legitimate under rule 5.

**ASTRA has no boundary violations at all.** Nothing outside it reaches in
except to mount its routes and register its workers. So there is **no Part 2
work**: it is Step 1 and Step 3, and nothing else.

That is unusual and it is why ASTRA goes first. ORBIT, by contrast, has five
files reaching into it — `candidate.controller`, `dashboard.controller`,
`candidate.routes`, `placement.routes` and `app.js` — and will need Patterns A
and B before it is clean.

### The order

1. Inventory, and check it against the structure doc.
2. Dry-run the mover script. Read the output.
3. Apply. Run the wiring test.
4. Boot, and probe two or three moved endpoints for a JSON 404.
5. Commit — paths only, and say so in the message.

If step 3 fails, the error names the missing module. That is almost always a
require the script could not resolve, and the fix is one line.
