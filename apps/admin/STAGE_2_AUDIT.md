# Stage 2 Audit — `generated → compiled`

## Goal of Stage 2
Stage 2 makes sure the “generated artifact” (from Stage 1) is safe and correct before it’s allowed into the shared graph store.

Stage 2 responsibility:
- `POST /agents/:id/compile`
- Parse + validate the artifact
- Check checksums (audit)
- Write:
  - `graph_definitions` (store the compiled topology as `draft`)
  - `graph_versions` (history row)
- Move statuses:
  - `agent_policies: generated → compiled`
  - `agent_versions: generated → compiled`

Stage 2 does NOT:
- publish
- activate
- run the runtime

---

## Files changed (Stage 2)
1. `apps/admin-api/src/routes/agents.ts`
   - Full implementation of `POST /agents/:id/compile`
   - Added: dependency check, checksum audit, `graph_definitions` upsert, `graph_versions` insert, status updates
2. `packages/authoring/src/ensure-schema.ts`
   - Best-effort creation of `graph_definitions` + `graph_versions` for local/dev
   - Best-effort grants + RLS wiring for graph store tables
3. `packages/db/migrations/V15__graph_versions_and_graph_store_rls.sql`
   - Creates/ensures `graph_versions`
   - Adds RLS policies + grants for:
     - `graph_definitions`
     - `graph_versions`
4. `apps/admin-api/src/agents.integration.test.ts`
   - Added a live-DB integration test that verifies compile writes to:
     - `graph_definitions`
     - `graph_versions`
5. `apps/admin/COMPILE_DESIGN.md`
   - Dedicated “Compile internals” doc (Stage 2 design)
6. `apps/admin/STAGE_2.md`
   - Marked Stage 2 checklist items as completed and linked to `COMPILE_DESIGN.md`

---

## Stage 2 start (prerequisites)
You must already have Stage 1 complete:
- `agent_policies.status = 'generated'`
- `agent_versions.status = 'generated'`
- there exists a latest generated artifact in `agent_versions.artifact_source`

Stage 2 reads the latest generated artifact row and compiles it into the shared graph store.

---

## Stage 2 flow (endpoint code)
File: `apps/admin-api/src/routes/agents.ts`

### 1) Entitlement + tenant scope (fail closed)
Before doing anything else:
- `withOrgScope(pool, orgId, ...)` sets `app.org_id` (used by RLS)
- `canEditAgent(client, { adminId, agentId, orgId })`
  - looks up `admin_agent_entitlements`
  - if there is no matching entitlement row, it returns 403 `FORBIDDEN`

### 2) Fetch latest generated artifact
The endpoint loads:
- the latest `agent_versions` row that matches the agent (and org scope)
- if there is no generated artifact yet, it returns `404 NO_GENERATED`

It also supports:
- `expectedVersion` (if provided)
- if it doesn’t match the latest generated artifact version:
  - `409 STALE_POLICY`

### 3) Re-validate policy at Compile (no drift)
The endpoint loads the policy row:
- `agent_policies.policy`
- then re-validates it using the *same* template schema:
  - `validateAgentPolicy(policyRow.policy, { policyExt: tmpl.template.policyExt })`

If validation fails:
- `400 POLICY_INVALID`

This is the “re-validate policy at compile” step.

### 4) Parse + validate the graph artifact
The endpoint parses the Stage 1 artifact JSON and checks topology:
- `GraphDefinitionSchema.parse(JSON.parse(latest.artifact_source))`
- `validateGraphTopology(parsedGraph)`

If parsing fails:
- `500 ARTIFACT_PARSE_FAILED`

If topology fails:
- `500 GRAPH_INVALID`

### 5) Resolve deps (Stage 2-level sanity check)
For each node in the parsed graph:
- check `node.impl` exists in the tool registry (`isRegisteredTool`)

If an impl key is unknown:
- `400 GRAPH_DEPENDENCY_MISSING`

### 6) Verify checksum at Compile (audit)
The endpoint recomputes:
- `sha256(latest.artifact_source)`

and compares it to:
- `latest.checksum`

If mismatch:
- `409 CHECKSUM_MISMATCH`

Extra check (when available):
- if `agent_policies.checksum` is not null, it must also match the artifact checksum

If mismatch:
- `409 POLICY_ARTIFACT_CHECKSUM_MISMATCH`

### 7) Write to the graph store
This is the “store write” part.

#### `graph_definitions` (upsert)
- Upserts a row in `graph_definitions`
- sets:
  - `status = 'draft'`
  - `activated_at = NULL`

#### `graph_versions` (history insert)
- inserts a history row into `graph_versions`
- sets:
  - `status = 'compiled'`
  - `compiled_by = adminId`
  - `compiled_at = now()`

### 8) Update statuses (`generated → compiled`)
Finally:
- `agent_policies.status = 'compiled'`
- `agent_versions.status = 'compiled'`

The response returns:
- `status: "compiled"`
- `graphKey`, `version`, and `checksum`

---

## Stage 2 DB changes (tables + RLS)

### 1) `graph_versions` (new)
Migration: `packages/db/migrations/V15__graph_versions_and_graph_store_rls.sql`

What it does:
- creates `graph_versions` table (if missing)
- adds an index for lookups

Main columns:
- `graph_key`, `version`
- `definition` (jsonb)
- `checksum`
- `compiled_by`, `compiled_at`

### 2) RLS for graph store tables
This is important because Stage 2 is an admin API but must still be tenant-safe.

RLS is applied for:
- `graph_definitions`
- `graph_versions`

Policy rule (simple idea):
- rows with `org_id = NULL` are global
- rows with `org_id = current app.org_id` are visible to that org

The migration also adds grants for:
- `syntra_app`
- `syntra_relay`

### 3) Best-effort local/dev support
File: `packages/authoring/src/ensure-schema.ts`

Reason:
- local/dev may not have every Flyway migration applied yet

So `ensureAuthoringSchema` now:
- creates graph store tables best-effort (`graph_definitions`, `graph_versions`)
- applies RLS best-effort (`applyGraphStoreRls`)
- grants best-effort so the admin-api compile endpoint can write

---

## Why specific changes were made (short explanations)

1. **Added `graph_versions`**
   - Stage 2 design says it “mirrors” `agent_versions` on the graph side
   - it gives history/audit for compiled graph material

2. **Added RLS for `graph_definitions` + `graph_versions`**
   - entitlement checks alone are not enough if RLS is missing
   - RLS ensures tenant isolation even if queries change later

3. **Write `graph_definitions.status = 'draft'`**
   - Stage 3 (Publish/activate) is the step that makes a graph “live”
   - so Stage 2 only stores a draft compiled definition

4. **Removed the need for runtime DDL inside the request**
   - compile endpoint performs only “data writes”, not “create tables”
   - schema + RLS are handled by migration / ensure-schema best-effort

---

## Tests (what we ran and results)

### Integration tests: `@tekisho/admin-api`
Command run:
- `npm run test -w @tekisho/admin-api`

Result:
- Tests passed:
  - `Test Files 2 passed`
  - `Tests 10 passed`

Included compile assertion:
- after `POST /agents/:id/compile`, the test checks:
  - `graph_definitions.status` is `draft`
  - `graph_versions.status` is `compiled`
  - `graph_versions.compiled_by` equals the admin id

### Unit tests: `@tekisho/authoring`
Command run:
- `npm run test -w @tekisho/authoring`

Result:
- Tests passed:
  - `Test Files 4 passed`
  - `Tests 21 passed`

---

## Stage 2 completeness statement
All Stage 2 “generated → compiled” work is complete:
- Parse + validate artifact
- Re-validate policy at Compile
- Verify checksum at Compile
- Resolve deps sanity check
- Write `graph_definitions` and `graph_versions`
- Update statuses to `compiled`
- Entitlement + RLS enforced for the compile action

