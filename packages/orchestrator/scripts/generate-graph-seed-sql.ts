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

const keys = graphSeedCatalog.map((s) => s.definition.graphKey);
const keysSql = keys.map(sqlString).join(', ');

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

DELETE FROM graph_definitions
WHERE org_id IS NULL
  AND graph_key IN (${keysSql});

INSERT INTO graph_definitions (
  id, org_id, graph_key, version, definition, checksum, status, created_by, activated_at
) VALUES
${valueBlocks.join(',\n')};
`;

writeFileSync(outPath, sql, 'utf8');
console.log(`Wrote ${outPath} (${graphSeedCatalog.length} recipe(s))`);
