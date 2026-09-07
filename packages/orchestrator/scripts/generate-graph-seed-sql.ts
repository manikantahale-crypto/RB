/**
 * Generate packages/db/migrations/R__seed_syntra_graphs.sql from `.def.ts` catalog.
 *
 * Usage: npm run generate:graph-seeds -w @tekisho/orchestrator
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphSeedCatalog } from '../src/graphs/catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(
  __dirname,
  '..',
  '..',
  'db',
  'migrations',
  'R__seed_syntra_graphs.sql',
);

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}




const valueBlocks = graphSeedCatalog.map((s) => {
  const defJson = JSON.stringify(s.definition, null, 2);
  return `(
  ${sqlString(s.id)},
  NULL,
  ${sqlString(s.definition.graphKey)},
  ${s.version},
  '${defJson.replace(/'/g, "''")}'::jsonb,
  ${sqlString(s.checksum)},
  ${sqlString(s.status)},
  'def.ts',
  ${s.status === 'active' ? 'now()' : 'NULL'}
)`;
});

const sql = `-- AUTO-GENERATED from packages/orchestrator/src/graphs/catalog.ts
-- Do not edit by hand. Regenerate with:
--   npm run generate:graph-seeds -w @tekisho/orchestrator
--
-- Repeatable Flyway seed: graph recipes (global scope).
--
-- CREATE IF ABSENT. NEVER OVERWRITE.
--
-- This used to DELETE every key it seeds and reinsert them, on every migration
-- run. That was defensible when git was the only author of a workflow. It is
-- not any more: the admin app has written hundreds of versions, and migrations
-- have advanced several workflows past what this file believes.
--
-- Against the live database that DELETE would have removed twelve rows, four
-- of which nothing here could put back — including the version of
-- duplicate.review that actually works, and two workflows a person authored
-- through the app.
--
-- So it seeds what is missing and leaves everything else alone. ON CONFLICT DO
-- NOTHING covers all three ways a row can already be there: the same id, the
-- same key and version, or another version of that key already active.

INSERT INTO graph_definitions (
  id, org_id, graph_key, version, definition, checksum, status, created_by, activated_at
) VALUES
${valueBlocks.join(',\n')}
ON CONFLICT DO NOTHING;
`;

writeFileSync(outPath, sql, 'utf8');
console.log(`Wrote ${outPath} (${graphSeedCatalog.length} recipe(s))`);
