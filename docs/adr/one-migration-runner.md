# One migration runner

**Status:** proposed — needs the lead's decision before any new migration lands
**Date:** 2026-09-07

---

## The problem

Three different mechanisms change this database's schema. None of them is
authoritative, and none of them knows about the other two.

**1 · Flyway files that have never run.** `packages/db/flyway.conf` exists and
`packages/db/migrations/` holds 28 correctly named versioned migrations (V1–V27)
plus 13 repeatables. `flyway_schema_history` **does not exist in any schema**.
Flyway has never run against this database, not once.

It could not run today even if someone tried. Two files claim V11:

```
V11__graph_definitions.sql          id text     ← matches the live table
V11__graph_definitions_table.sql    id uuid     ← does not
```

Flyway refuses to start on a duplicate version. And these are not a cosmetic
duplicate — they define incompatible tables. The live `graph_definitions` has
`id text`, `org_id text`, so the first is right and the second has never
described reality.

Eight more files are named like `V10 — Row-Level Security policies.sql`, with
spaces and an em-dash instead of `V10__snake_case.sql`. Flyway does not
recognise those as migrations at all, so they are invisible clutter that reads
like history.

**2 · A second runner nobody here operates.** `syntra.schema_migrations` records
`V27__orbit_note_requested_binding.sql` and `V28__ml_scoring_log.sql`, both
applied 2026-08-23. V27 is in this repo. **V28's file exists in no branch** —
schema was applied to a shared database from a file nobody can now read. V1–V26
of that series were never recorded, so that runner was pointed at an
already-built database and only tracked what it applied from then on.

**3 · A script that reports success when it fails.**
`node-api/run-migrations.js` is a hardcoded list of `ALTER TABLE` statements
with no version tracking whatsoever. It catches errors, logs them, and then
`process.exit(0)` in a `finally` — so a migration that fails exits zero. Anything
calling it in a pipeline is told everything is fine.

**And the database is already full.** 59 tables in `public` plus `orch`,
`syntra` and `langgraph` schemas, with real data. Nobody can replay V1 forward
against this — it would fail on the first `CREATE TABLE`.

## Why this has to be decided before anything else

Fan-out needs a migration: routing-group columns on `graph_event_bindings` and a
swap of the one-active index. The DB clean-up needs migrations. Three module
teams registering events will each need migrations.

Every one of those is currently a hand-applied change to a shared database with
no reliable record of what has been applied. This decision gates all of it.

## "We are on Supabase, so surely Supabase tooling?"

Worth separating two things: Supabase is the **host**, and it is Postgres.
Flyway connects to it like any other Postgres. Being on Supabase does not
commit us to Supabase's migration CLI, and choosing Flyway does not move us off
Supabase.

What is actually on the machines, checked rather than assumed:

| | State |
|---|---|
| `supabase/` directory or `config.toml` | **absent** — the CLI migration workflow has never been set up here |
| `supabase` CLI on PATH | **not installed** |
| `java` | **not installed** |
| `docker` | **installed** (29.3.1) |

This cuts the main objection to Flyway. Its cost was a Java dependency, and the
official Flyway Docker image is the normal way to run it — so the dependency is
already satisfied.

It also removes the assumed advantage on the other side. The Supabase route is
not "carry on as we are": it is install the CLI, `supabase init`, link the
project, rename 28 migrations, and rework 13 seed files. That is a bigger
change than adopting the runner the repository is already written for.

## The options

**Flyway.** The repo is already shaped for it: 28 correctly named files and, more
importantly, **13 repeatable `R__` migrations** carrying the seed data — event
schemas, bindings, graph definitions, grants. Repeatables re-run when their
checksum changes, which is exactly what a seed file wants.

**Supabase CLI.** Migrations are `<timestamp>_name.sql`, so all 28 files get
renamed. There is no repeatable-migration concept, so all 13 seed files must be
rewritten as idempotent versioned migrations — and those seeds are the files
that already nearly deleted twelve live rows. Rewriting them is the highest-risk
work in the repository.

**Stay as we are.** Named only to reject it. It is what produced two numbering
series, a migration with no file, and a runner that exits zero on failure.

## Decision

**Flyway**, because the cost is asymmetric. Its price is a Java or Docker
dependency on dev machines. Supabase's price is renaming every migration and
rewriting all 13 seed files, which is both more work and far more dangerous.

Nothing about Flyway is deeply loved here; it wins because the repository is
already written in it.

## What has to happen, in order

1. **Delete `V11__graph_definitions_table.sql`.** It describes a table that has
   never existed. The live schema settles it.
2. **Delete the 8 em-dash files.** Their properly named twins already carry the
   same versions.
3. **Baseline at V27 against the live database.** Never replay V1. The baseline
   marks everything up to V27 as already applied; V28 onward must be genuinely
   new.
4. **Get V28 into the repo, or write down that SYNTRA owns its own schema.**
   Either is defensible. Neither knowing nor deciding is not.
5. **Retire `node-api/run-migrations.js`.** Until it goes, fix the `exit(0)` so
   a failure is a failure.
6. **CI runs `flyway validate`** on every PR touching `packages/db/`, so the
   next duplicate version is caught by a machine rather than by a person
   noticing.

## What this does not decide

Whether SYNTRA keeps a separate schema series, the RLS gap (35 tables with
policies on 6), and the wider database restructure. Those are their own
decisions; this one only settles who is allowed to change schema and how it is
recorded.
