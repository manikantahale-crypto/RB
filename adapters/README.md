# Adapters — the orchestrator's view of a module

**These are adapters, not modules.** One HTTP call per file.

A node here is deliberately an empty shell: it builds a request, sends it, and
maps the response onto graph state. That is the whole job.

If you are writing an `if` about a candidate's skills, a score threshold, or a
document's contents, you are in the wrong directory — that logic belongs in
`modules/<module>/service/`, which lives in this repo but is owned by the
module team.

    orchestrator/adapters/syntra/     the orchestrator's shells for SYNTRA
    modules/syntra/service/           SYNTRA itself

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
  `shared/http-contracts`. Nothing else in this repo.
