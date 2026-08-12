# Compile Internals Design (Stage 2)

**Canonical source:** `STAGE_2.md` + `agent-authoring-admin-design-final.md`  
**Boundary:** Compile is a pure authoring gate. It **does not** call the runtime compiler/execute the graph; it only parses/validates and writes to the shared graph store.

---

## Lifecycle + status transition

`generated → compiled`

Compile:
- never activates (`active` is Stage 3)
- never publishes (`published` is Stage 3)
- records topology/materialisation into `graph_definitions`
- records history into `graph_versions`

---

## Endpoint contract

`POST /agents/:id/compile`

### Request

JSON body:
- `expectedVersion?: number`
  - when provided, Compile refuses to run if the latest `agent_versions.version` for this agent+scope doesn’t equal `expectedVersion`
  - error: `409 STALE_POLICY`

Auth / scope:
- admin-authenticated
- per-agent entitlement enforced in DB (`admin_agent_entitlements`)
- RLS is applied using `org_id` via `app.org_id` GUC (see “Security”)

### Response (200)

JSON:
- `status: "compiled"`
- `agentId: string`
- `agentKey: string` (template catalog key)
- `policyExt: string` (template policyExt schema key)
- `graphKey: string` (graph definition identity)
- `version: number` (the compiled graph version; sourced from `agent_versions.version`)
- `checksum: string` (the artifact checksum)

### Error shapes (non-exhaustive)

- `403 FORBIDDEN` (missing entitlement)
- `404 AGENT_NOT_FOUND`
- `404 NO_GENERATED` (no Stage 1 artifact exists)
- `409 STALE_POLICY` (version mismatch)
- `400 POLICY_INVALID` (policy revalidation failed; includes `fields`)
- `500 ARTIFACT_PARSE_FAILED` (graph JSON parse failed)
- `500 GRAPH_INVALID` (graph topology invalid)
- `400 GRAPH_DEPENDENCY_MISSING` (graph node `impl` unknown to tool registry)
- `409 CHECKSUM_MISMATCH` (recomputed checksum of `artifact_source` doesn’t match stored checksum)
- `409 POLICY_ARTIFACT_CHECKSUM_MISMATCH` (optional: when `agent_policies.checksum` exists and disagrees with artifact checksum)

---

## Compile pipeline (implementation truth)

Inputs:
- latest generated artifact (`agent_versions.artifact_source`, `agent_versions.checksum`, `agent_versions.version`)
- policy row that produced it (`agent_policies.policy`, `agent_policies.checksum` when present)
- active agent template (`agent_templates.template`, including `policyExt`)

Algorithm:

1. **Entitlement + RLS scoped transaction**
   - Use `withOrgScope(...)` to set `app.org_id` for the request.
   - Enforce `canEditAgent(...)`.

2. **Fetch latest generated artifact**
   - Find the latest `agent_versions` row for this agent+org scope where status is `generated`.

3. **Policy revalidation (shared Zod schema invariant A4)**
   - Validate the stored policy JSON using `validateAgentPolicy(policy, { policyExt })`.
   - Reject on failure with `400 POLICY_INVALID`.

4. **Parse + validate graph (GraphDefinitionSchema + topology)**
   - `GraphDefinitionSchema.parse(JSON.parse(artifact_source))`
   - `validateGraphTopology(parsedGraph)`
   - Reject with `500 ARTIFACT_PARSE_FAILED` or `500 GRAPH_INVALID`.

5. **Resolve deps (Stage 2 “compiler internals” beyond schema/topology)**
   - For each `parsedGraph.nodes[]`, ensure `node.impl` exists in the tool registry.
   - Reject with `400 GRAPH_DEPENDENCY_MISSING` if any impl is unknown.

6. **Checksum audits**
   - Recompute sha256 over `agent_versions.artifact_source` and compare to `agent_versions.checksum`.
   - If `agent_policies.checksum` is present, additionally ensure it matches the artifact checksum.

7. **Write into the graph store (shared runtime store)**
   - Upsert into `graph_definitions` with:
     - `status = 'draft'`
     - `activated_at = NULL`
   - Insert into `graph_versions` with:
     - `status = 'compiled'`
     - `compiled_by = adminId`
     - `compiled_at = now()`

8. **Update authoring statuses**
   - `agent_policies.status = 'compiled'`
   - `agent_versions.status = 'compiled'`

---

## Data model mapping (what gets written)

### `graph_definitions`

Write target:
- Upsert row keyed by a computed `id`.

Stored fields:
- `graph_key`, `version`, `definition` (jsonb), `checksum`
- `status = draft` (Compile does not activate/publish)

### `graph_versions`

Write target:
- Immutable-ish history row per compilation event.

Stored fields:
- `graph_key`, `version`, `definition`, `checksum`
- `compiled_by`, `compiled_at`

---

## Security

- Entitlement: `admin_agent_entitlements` via `canEditAgent`.
- Tenant isolation:
  - `withOrgScope` sets `app.org_id`
  - RLS policies restrict reads/writes on:
    - `agent_policies`
    - `agent_versions`
    - `admin_agent_entitlements`
    - `graph_definitions`
    - `graph_versions`

---

## Notes / intentional limits

- Compile is a store write gate only; it does not publish/activate or call runtime execution.
- “Deps resolution” is intentionally minimal at Stage 2: we validate node `impl` against the tool registry.
- Deeper resolution of node wiring semantics is deferred to later compiler/runtime components (Stage 3+ runtime built components), as the final design scoped this away from Stage 1/2 docs.

