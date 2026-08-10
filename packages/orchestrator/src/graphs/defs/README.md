# Graph recipes (`.def.ts`)

These files are the **source of truth** for workflow wiring (nodes + edges).

1. Edit or add a `*.def.ts` file using `defineGraph(...)`.
2. Register it in `catalog.ts`.
3. Run `npm run generate:graph-seeds -w @tekisho/orchestrator` to refresh
   `packages/db/migrations/R__seed_syntra_graphs.sql`.
4. Worker boot also seeds from this catalog (`GraphCompiler.ensureSchemaAndSeed`).

Runtime still **reads recipes from the DB** — these files are for authoring + seeding.
