# A new project, with only the new structure

`V1__baseline.sql` is the schema a fresh Supabase project starts from: 32
tables in six schemas, no legacy tables, no shims, no mirrors, no compatibility
views, and nothing belonging to another team.

Regenerate it with `./scripts/build-new-baseline.sh`. Do not edit it by hand.

**This removes nothing from your current database.** The script runs one
`pg_dump --schema-only` against production and writes a file. The old project
keeps all 120 tables, every mirror, every compatibility view and every row, and
RELAY, INTERVIEW and PRISM carry on against it exactly as they do now.

## What is in it

| Schema | Tables | What it holds |
|---|---|---|
| `platform` | 6 | organisations, users, org membership, applications, queues, features |
| `core` | 7 | the business: people, requirements, resumes, matches, embeddings, processing jobs, source files |
| `authoring` | 6 | workflows, their versions and drafts, the event catalogue, bindings, the node registry |
| `orch` | 5 | runs, steps, the outbox, run failures |
| `builder` | 5 | the admin app's agent-shaped authoring model |
| `syntra` | 3 | what is genuinely SYNTRA's: matching policies, scoring log, review queue |

Plus 78 row-level-security policies, 15 triggers, and empty `pgboss` and
`langgraph` schemas for the two libraries that own their own DDL and create it
at boot.

## What is deliberately absent

- **`public`.** Nothing at all. A table with no schema is a table whose owner
  nobody has decided, and that is how 100 of them accumulated.
- **The SYNTRA shims** — `candidates`, `jobs`, `resumes`, `matches`, `users`.
  The first four are `core` entities wearing their old names for applications
  that have not moved yet. Here there is nothing to be compatible with.
- **`app.legacy_*` and `app.mirror_*`.** Functions whose whole job was keeping
  two copies of something in step. There is one copy.
- **`relay` and `interview_agent`.** Another team's schema, in the old
  database, where their code still points.

## What it is for

A **reference environment**. The three teams point a dev or staging stack at
it, see the shape they are moving to, and adapt their code. The old project
stays live and remains the source of truth.

It is not a second production. The moment both exist they start to diverge — a
JD uploaded to one does not appear in the other — so real work belongs in one
place until there is a deliberate cutover.

## Before it can become production

RELAY, INTERVIEW and PRISM have 15 foreign keys into the legacy `syntra`
tables:

| Their table | Points at |
|---|---|
| `interview_agent.roster` (×3), `bank_questions` | `syntra.matches`, `candidates`, `jobs` |
| `relay.email_threads`, `email_classifications`, `followups` | `syntra.candidates` |
| `prism_submissions` (×4), `prism_rtr`, `prism_consents`, `prism_approvals`, `prism_audit` | `syntra.users`, `candidates`, `resumes`, `jobs` |

Those keys need repointing at `core` and `platform`, in their repositories.
Standing this environment up is what lets them do it.

## Verified, not assumed

Applied to an empty database, it produces 32 tables across the six schemas with
no errors. On that database:

- `core.people` and `core.requirements` derive `org_id` from `created_by`
  through `platform.org_members`, with no `org_id` supplied
- publishing an event that is not in the catalogue is **refused**
- a second live version of one workflow is **refused**
- a binding naming a queue nobody declared is **refused**

## Getting data into it

`V1__baseline.sql` is schema only. Copy whatever you want with `pg_dump
--data-only` per table, in dependency order: `platform` first, then `core`,
then `authoring`, then the rest. Or start empty — for a reference environment,
a handful of rows you understand beats a copy of production you do not.
