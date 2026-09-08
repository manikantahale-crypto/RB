# Build the target schema on a clean database

**Status:** proposed
**Date:** 2026-09-07
**Depends on:** the target design — Part 2 of `Bench_Sales_System_Reference_NEW.docx`
**Supersedes:** the route in §2.12, not the design in §2.1–§2.11

---

## What this decides

Not the schema. Part 2 already settles that: four layers (`platform`, `core`,
`authoring` + `orch`, per-application), nine rules, and isolation from grants
rather than schemas. None of that is reopened here.

This decides **how we get there** — and it changes the answer because one of the
document's own premises turned out not to hold.

## The premise that changed

§2.12 migrates the existing database in place: add `org_id` nullable, backfill,
attribute the unowned rows, set `NOT NULL`, then move tables with `SET SCHEMA`
and compatibility views.

Step 3 is described as *"The real one. Needs the business decision above"*, and
§2.11 says it plainly:

> The expensive part is not the schema — it is the 775 requirements, 815 matches
> and 139 resumes with no owner recorded anywhere, not even a `created_by`.
> Deciding which organisation they belong to is a business question, and it
> should be answered before any of this starts.

§2.13 lists it as one of two blocking questions.

**It is all test data.** Confirmed with the lead, 2026-09-07. Nothing in this
database is production, and no customer is behind any of those rows.

You do not attribute test data to an organisation. You delete it.

## What that removes

| §2.12 step | Under a clean build |
|---|---|
| 2 · add `org_id` nullable and backfill | gone — columns are `NOT NULL` from the first migration |
| 3 · attribute unowned rows, then add constraints | **gone entirely** — the highest-risk step in the plan |
| 0 · baseline existing versions as applied | gone — an empty database replays V1 forward, which is the thing that cannot happen today |

It also removes the second blocking question in §2.13, and the first one gets
easier: with no schema to baseline, the runner choice stops being constrained by
28 legacy filenames. That is dealt with in `one-migration-runner.md`, which needs
rewriting if this is accepted.

## What actually carries over

Almost nothing, because the configuration is already in git:

| | Rows | Source |
|---|---|---|
| `event_schemas` | 45 | `R__seed_event_schemas.sql` |
| `graph_event_bindings` (active) | 20 | `R__seed_graph_event_bindings.sql` + V-migrations |
| `node_registry` | 22 | projected from git contracts by `materialize:nodes` |
| `organizations` | 4 | four `INSERT`s |

Of 543 `graph_definitions`, **511 are `admin-local`** — authored through the
admin app while developing, 388 of them already retired and 114 still drafts.
Nine are active. The remainder came from `catalog.ts`, `def.ts` and staging
scripts, all of which are in the repository.

So the carry-over is: run the migrations, run `materialize:nodes`, insert four
organisations, and re-author whatever few workflows are still wanted.

## Decision

**Create the target schema empty. Do not migrate the existing rows.**

**On a new Supabase project, not new schemas beside the old ones.** The
difference matters for a reason that has nothing to do with the schema: other
repositories currently connect to this database directly, and the lead's stated
intent is to stop that. A new project is the only moment where that is a
decision rather than a negotiation — credentials to a database that does not yet
exist are given deliberately, per role, per §2.3. Keeping the old schemas
alongside the new ones leaves every existing connection working, which is
exactly the thing being fixed.

## What this costs, honestly

**The incremental path is what we give up.** §2.11's best idea is moving a table
and leaving an updatable view behind, so 46 of 68 files keep working unchanged
and code follows at its own pace. That mechanism still works inside the new
database — `CREATE VIEW syntra.jobs AS SELECT * FROM core.requirements` is the
same trick — but the *cutover itself* is not incremental. Every application
repoints at once.

With test data and one afternoon, that is affordable. It would not be otherwise.

**The other repositories are the real cost.** They work today because they read
this database. Each has to move to the new one or move to an API, on their own
schedule and by their own team. That is the part to plan; the 20,000 rows are
not.

**The wide-table splits and the draft/version split are unchanged.** §2.11 counts
them accurately and a clean build does not make them smaller. It only means they
are written once, correctly, instead of migrated into.

## Sequence

1. Pick the runner — now a free choice. Rewrite `one-migration-runner.md`.
2. Write the migrations that build `platform`, `core`, `authoring`, `orch` and
   the application schemas per §2.4–§2.10.
3. Stand up the new project and run them against it, empty. Confirm V1 forward
   applies cleanly, because it now can.
4. `materialize:nodes`, seed four organisations, apply the §2.3 grants from the
   start — no application connects as `postgres`.
5. Repoint `apps/*` and `node-api`, then verify by booting each and running a
   workflow end to end.
6. Tell the other repositories, with a date and a role each.
7. Keep the old project read-only for a fortnight, then drop it.

## What still needs deciding

The design decisions in §2.13 stand and are unaffected: whether a user belongs to
more than one organisation, whether `org_id NULL` or an explicit platform
organisation marks a platform-provided workflow, whether `agent_*` folds into
`authoring.graphs` or retires, who owns a submission, whether placement belongs
in `core`, and whether consent is one entity or two.

The unknowns in §2.13 also stand — FLUX, TALYN versus SYNTRA, whether
`interview_agent` is TEMPO, and whether RELAY, INTERVIEW and PRISM will adopt
these rules. **That last one now has a deadline attached:** their data is in the
database being replaced, and their code is not in this repository.
