# Legacy migrations — kept as a record, never run

These 36 files were `packages/db/migrations/` until 2026-09-09. They are here
because they are the only written record of what the schema was *meant* to be,
and nowhere else.

**They have never run as a set, and they cannot.** Flyway would refuse the
folder before touching the database:

- `V11__graph_definitions.sql` and `V11__graph_definitions_table.sql` both claim
  version 11 and both create `graph_definitions` — one with a `text` primary
  key, one with `uuid`. Production has `text`.
- V3 through V10 each exist twice, once as `V3__Agentic_spine.sql` and once as
  `V3 — Agentic spine.sql` with an em-dash and spaces. The pairs are
  byte-identical; the duplication alone is what breaks the run.

The database was built by hand and by the application at boot instead. There is
no `flyway_schema_history` in any schema; `syntra.schema_migrations` has two
rows, written by hand; and `V28__ml_scoring_log.sql` is recorded as applied
while existing in no branch.

## What replaced them

`packages/db/migrations/V20260909.01__baseline_from_production.sql` — a dump of
the live schema, which is what production actually is rather than what these
files hoped. Everything from that point forward is a normal versioned migration.

## Should you ever read these?

Only to answer "what was this table originally for". They are the intent behind
several tables whose purpose is otherwise unrecorded — the domain spines in
V4–V8, the RLS helpers in V1, the ASTRA and ORBIT wiring in V22–V27.

Do not copy SQL out of them without checking it against the live schema first.
Several describe a schema that never existed.
