# Adapters — the orchestrator's view of a module

**These are adapters, not modules.** One HTTP call per file.

A node here is deliberately an empty shell: it builds a request, sends it, and
maps the response onto graph state. That is the whole job.

If you are writing an `if` about a candidate's skills, a score threshold, or a
document's contents, you are in the wrong directory — that logic belongs in
`node-api/src/modules/<module>/`, which lives in this repo but is owned by the
module team.

    adapters/syntra/nodes/            the orchestrator's shells for SYNTRA
    node-api/src/modules/syntra/      SYNTRA itself — services/, routes/,
                                      workers/, repositories/, matching/

Those are the real paths. This file used to say `orchestrator/adapters/` and
`modules/<module>/service/` — the three-zone layout from a repository
restructure that was deferred on purpose (Orchestrator_Decisions.md §4) and
never done. Neither directory exists, and the wording sent at least one
onboarding to look for a folder that is not there. Plural `services/`, inside
`node-api/src/modules/`, is what SYNTRA actually uses and what a new module
mirrors.

## Layout

    <module>/nodes/<key>.node.ts       one node contract per file
    <module>/routing/<event>.routing.yaml
    <module>/fixtures/                 golden I/O, read by CI

Filenames derive from the key mechanically, so `registry:check` can verify a
file sits where its key says: `syntra.duplicate.detect` →
`nodes/duplicate-detect.node.ts`.

## Rules

- No business logic in a node. Ever.
- A writing node declares an idempotency strategy — the node boundary is the
  retry boundary.
- External or financial nodes carry a written justification and are never
  added by generation.
- May import `@tekisho/node-contract`, `@tekisho/domain`, and
  `shared/http-contracts`. Nothing else in this repo — except that a
  `platform/` node may also import `@tekisho/graph-contract`: the shape of a
  branch is the platform's business, and the editor reads the same package,
  so a routing rule means one thing on both sides.
