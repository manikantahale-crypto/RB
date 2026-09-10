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
  NULL::uuid,
  ${sqlString(s.definition.graphKey)},
  ${s.version},
  '${defJson.replace(/'/g, "''")}'::jsonb,
  ${sqlString(s.checksum)},
  ${sqlString(s.status)},
  'def.ts',
  ${s.status === 'active' ? 'now()' : 'NULL::timestamptz'}
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

-- The recipe is two rows now, because a workflow's identity and its versions
-- are two tables. The seed values are staged once and used for both.
WITH seed (id, org_id, graph_key, version, definition, checksum, status, created_by, activated_at) AS (
  VALUES
${valueBlocks.join(',\n')}
), graph AS (
  INSERT INTO authoring.graphs
    (org_id, graph_key, application, title, status, created_by_label)
  SELECT s.org_id::uuid, s.graph_key,
         (SELECT a.key FROM platform.applications a
           WHERE a.key = split_part(s.graph_key, '.', 1)),
         s.graph_key,
         CASE WHEN s.status = 'active' THEN 'active' ELSE 'draft' END,
         s.created_by
    FROM seed s
  -- The index is on an expression, because a global workflow's org is NULL
  -- and NULL is not equal to itself.
  ON CONFLICT (coalesce(org_id::text, '~global~'), graph_key)
    DO UPDATE SET updated_at = now()
  RETURNING id, graph_key
)
INSERT INTO authoring.graph_versions
  (graph_id, org_id, version, definition, checksum, status,
   compiled_by_label, compiled_at)
SELECT g.id, s.org_id::uuid, s.version, s.definition, s.checksum,
       CASE WHEN s.status = 'active' THEN 'live' ELSE 'compiled' END,
       s.created_by, coalesce(s.activated_at, now())
  FROM seed s
  JOIN graph g ON g.graph_key = s.graph_key
-- No conflict target, deliberately: this must do nothing whether the clash is
-- the same (graph_id, version) or the partial index that allows one live
-- version per workflow. Either way something is already there and this file
-- does not get to overwrite it.
ON CONFLICT DO NOTHING;
`;

writeFileSync(outPath, sql, 'utf8');
console.log(`Wrote ${outPath} (${graphSeedCatalog.length} recipe(s))`);
