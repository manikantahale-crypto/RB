import type { Pool, PoolClient, QueryResultRow } from "pg";
import { createHash } from "node:crypto";
import {
  baseFieldsFor,
  extFieldsFor,
  generateGraphFromTemplate,
  GraphDefinitionSchema,
  isRegisteredTool,
  validateGraphTopology,
  listActiveTemplates,
  templateForAgentId,
  validateAgentPolicy,
  type GraphDefinition,
  type AgentPolicy,
} from "@tekisho/authoring";
import { canEditAgent, editableAgentIds } from "../entitlement.js";
import { withOrgScope, type DbQueryable } from "../with-org-scope.js";

type FastifyLike = {
  get: (path: string, handler: any) => void;
  put: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
};

type PolicyRow = {
  id: string;
  version: number;
  status: string;
  policy: unknown;
  checksum: string | null;
  updated_at: Date;
  created_by: string;
};

type AgentDefRow = {
  id: string;
  name: string;
  purpose: string;
  is_active: boolean;
};

type GeneratedArtifactRow = {
  id: string;
  version: number;
  artifact_source: string;
  checksum: string;
  policy_id: string;
};

function readOrgId(headers: Record<string, unknown>): string | null {
  const raw = headers["x-org-id"];
  if (raw === undefined || raw === null || raw === "" || raw === "~global~") {
    return null;
  }
  return String(raw);
}

function readAdminId(headers: Record<string, unknown>): string {
  const raw = headers["x-admin-id"];
  return raw ? String(raw) : "admin-local";
}

async function latestPolicy(
  client: DbQueryable,
  agentId: string,
  orgId: string | null,
): Promise<PolicyRow | null> {
  const { rows } =
    orgId === null
      ? await client.query<PolicyRow & QueryResultRow>(
          `SELECT id, version, status, policy, checksum, updated_at, created_by
             FROM agent_policies
            WHERE agent_id = $1 AND org_id IS NULL
            ORDER BY version DESC
            LIMIT 1`,
          [agentId],
        )
      : await client.query<PolicyRow & QueryResultRow>(
          `SELECT id, version, status, policy, checksum, updated_at, created_by
             FROM agent_policies
            WHERE agent_id = $1 AND (org_id = $2 OR org_id IS NULL)
            ORDER BY (org_id IS NOT NULL) DESC, version DESC
            LIMIT 1`,
          [agentId, orgId],
        );
  return rows[0] ?? null;
}

async function agentExists(
  client: DbQueryable,
  agentId: string,
): Promise<AgentDefRow | null> {
  const { rows } = await client.query<AgentDefRow & QueryResultRow>(
    `SELECT id, name, purpose, is_active FROM agent_definitions WHERE id = $1`,
    [agentId],
  );
  return rows[0] ?? null;
}

async function latestGeneratedArtifact(
  client: DbQueryable,
  agentId: string,
  orgId: string | null,
): Promise<GeneratedArtifactRow | null> {
  const { rows } =
    orgId === null
      ? await client.query<GeneratedArtifactRow & QueryResultRow>(
          `SELECT id, version, artifact_source, checksum, policy_id
             FROM agent_versions
            WHERE agent_id = $1
              AND org_id IS NULL
              AND status = 'generated'
            ORDER BY version DESC
            LIMIT 1`,
          [agentId],
        )
      : await client.query<GeneratedArtifactRow & QueryResultRow>(
          `SELECT id, version, artifact_source, checksum, policy_id
             FROM agent_versions
            WHERE agent_id = $1
              AND (org_id = $2 OR org_id IS NULL)
              AND status = 'generated'
            ORDER BY (org_id IS NOT NULL) DESC, version DESC
            LIMIT 1`,
          [agentId, orgId],
        );
  return rows[0] ?? null;
}

async function latestCompiledArtifact(
  client: DbQueryable,
  agentId: string,
  orgId: string | null,
): Promise<GeneratedArtifactRow | null> {
  const { rows } =
    orgId === null
      ? await client.query<GeneratedArtifactRow & QueryResultRow>(
          `SELECT id, version, artifact_source, checksum, policy_id
             FROM agent_versions
            WHERE agent_id = $1
              AND org_id IS NULL
              AND status = 'compiled'
            ORDER BY version DESC
            LIMIT 1`,
          [agentId],
        )
      : await client.query<GeneratedArtifactRow & QueryResultRow>(
          `SELECT id, version, artifact_source, checksum, policy_id
             FROM agent_versions
            WHERE agent_id = $1
              AND (org_id = $2 OR org_id IS NULL)
              AND status = 'compiled'
            ORDER BY (org_id IS NOT NULL) DESC, version DESC
            LIMIT 1`,
          [agentId, orgId],
        );
  return rows[0] ?? null;
}

async function latestPublishedArtifact(
  client: DbQueryable,
  agentId: string,
  orgId: string | null,
): Promise<GeneratedArtifactRow | null> {
  const { rows } =
    orgId === null
      ? await client.query<GeneratedArtifactRow & QueryResultRow>(
          `SELECT id, version, artifact_source, checksum, policy_id
             FROM agent_versions
            WHERE agent_id = $1
              AND org_id IS NULL
              AND status = 'published'
            ORDER BY version DESC
            LIMIT 1`,
          [agentId],
        )
      : await client.query<GeneratedArtifactRow & QueryResultRow>(
          `SELECT id, version, artifact_source, checksum, policy_id
             FROM agent_versions
            WHERE agent_id = $1
              AND (org_id = $2 OR org_id IS NULL)
              AND status = 'published'
            ORDER BY (org_id IS NOT NULL) DESC, version DESC
            LIMIT 1`,
          [agentId, orgId],
        );
  return rows[0] ?? null;
}

/** Authored keys only — never activate/retire runtime *.workflow keys. */
function assertAuthoredGraphKey(graphKey: string, agentKey: string): void {
  const expected = `${agentKey}.authored`;
  if (graphKey !== expected) {
    throw Object.assign(
      new Error(
        `Activate refused: graph_key "${graphKey}" is not authored key "${expected}"`,
      ),
      { code: "NOT_AUTHORED_KEY" },
    );
  }
  if (graphKey.includes(".workflow")) {
    throw Object.assign(
      new Error(`Activate refused: runtime workflow key "${graphKey}"`),
      { code: "RUNTIME_KEY_FORBIDDEN" },
    );
  }
}

async function validatePolicyForAgent(
  client: DbQueryable,
  agentId: string,
  rawPolicy: unknown,
): Promise<
  | { ok: true; policy: AgentPolicy; policyExt: string; agentKey: string }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const tmpl = await templateForAgentId(client as PoolClient, agentId);
  if (!tmpl) {
    return {
      ok: false,
      status: 404,
      body: {
        error: "TEMPLATE_NOT_FOUND",
        message: "No active agent_templates row for this agent",
      },
    };
  }

  const withIds =
    typeof rawPolicy === "object" && rawPolicy !== null
      ? {
          ...(rawPolicy as object),
          agentId,
          agentKey: tmpl.agentKey,
        }
      : { agentId, agentKey: tmpl.agentKey };

  const validated = validateAgentPolicy(withIds, {
    policyExt: tmpl.template.policyExt,
  });
  if (!validated.ok) {
    return {
      ok: false,
      status: 400,
      body: { error: "POLICY_INVALID", fields: validated.fields },
    };
  }

  return {
    ok: true,
    policy: validated.policy,
    policyExt: tmpl.template.policyExt,
    agentKey: tmpl.agentKey,
  };
}

export function registerAgentRoutes(app: FastifyLike, pool: Pool): void {
  app.get("/templates", async (req: any, reply: any) => {
    const orgId = readOrgId(req.headers);
    return withOrgScope(pool, orgId, async (client) => {
      const templates = await listActiveTemplates(client);
      return reply.send({
        templates: templates.map((t) => ({
          id: t.id,
          agentKey: t.agentKey,
          agentId: t.agentId,
          displayName: t.displayName,
          version: t.version,
          policyExt: t.template.policyExt,
          baseFields: baseFieldsFor(),
          policyExtFields: extFieldsFor(t.template.policyExt),
          template: t.template,
        })),
      });
    });
  });

  app.get("/agents", async (req: any, reply: any) => {
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);

    return withOrgScope(pool, orgId, async (client) => {
      const scopePred =
        orgId === null ? "org_id IS NULL" : "(org_id = $1 OR org_id IS NULL)";
      const scopeOrder =
        orgId === null
          ? "version DESC"
          : "(org_id IS NOT NULL) DESC, version DESC";
      const params = orgId === null ? [] : [orgId];

      const { rows } = await client.query(
        `
        SELECT
          d.id,
          d.name,
          d.purpose,
          d.is_active,
          p.status AS policy_status,
          p.version AS policy_version,
          p.updated_at AS policy_updated_at,
          p.created_by AS policy_author,
          p.checksum,
          a.version AS active_version,
          a.updated_at AS active_updated_at,
          g.version AS last_generated_version,
          g.generated_at AS last_generated_at,
          g.generated_by AS last_generated_by,
          g.status AS last_generated_status
        FROM agent_definitions d
        LEFT JOIN LATERAL (
          SELECT status, version, updated_at, created_by, checksum
            FROM agent_policies
           WHERE agent_id = d.id
             AND (${scopePred})
           ORDER BY ${scopeOrder}
           LIMIT 1
        ) p ON true
        LEFT JOIN LATERAL (
          SELECT version, updated_at
            FROM agent_policies
           WHERE agent_id = d.id
             AND status = 'active'
             AND (${scopePred})
           ORDER BY ${scopeOrder}
           LIMIT 1
        ) a ON true
        LEFT JOIN LATERAL (
          SELECT version, generated_at, generated_by, status
            FROM agent_versions
           WHERE agent_id = d.id
             AND (${scopePred})
           ORDER BY generated_at DESC, version DESC
           LIMIT 1
        ) g ON true
        WHERE d.is_active = true
        ORDER BY d.name
        `,
        params,
      );

      const editable = await editableAgentIds(
        client,
        adminId,
        orgId,
        rows.map((r: { id: string }) => r.id),
      );

      return reply.send({
        orgId,
        agents: rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          purpose: r.purpose,
          canEdit: editable.has(r.id),
          policy: r.policy_status
            ? {
                status: r.policy_status,
                version: r.policy_version,
                updatedAt: r.policy_updated_at,
                author: r.policy_author,
                checksum: r.checksum,
              }
            : null,
          // §8.1 — current active version (authoring one-active), read-only.
          activeVersion: r.active_version ?? null,
          activeUpdatedAt: r.active_updated_at ?? null,
          // §8.1 — last-generated metadata.
          lastGenerated: r.last_generated_version
            ? {
                version: r.last_generated_version,
                generatedAt: r.last_generated_at,
                generatedBy: r.last_generated_by,
                status: r.last_generated_status,
              }
            : null,
        })),
      });
    });
  });

  app.get("/agents/:id", async (req: any, reply: any) => {
    const agentId = String(req.params.id);
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);

    return withOrgScope(pool, orgId, async (client) => {
      const def = await agentExists(client, agentId);
      if (!def) {
        return reply.code(404).send({ error: "AGENT_NOT_FOUND" });
      }

      const latest = await latestPolicy(client, agentId, orgId);
      const tmpl = await templateForAgentId(client, agentId);
      const canEdit = await canEditAgent(client, { adminId, agentId, orgId });

      return reply.send({
        id: def.id,
        name: def.name,
        purpose: def.purpose,
        orgId,
        canEdit,
        template: tmpl
          ? {
              id: tmpl.id,
              agentKey: tmpl.agentKey,
              displayName: tmpl.displayName,
              version: tmpl.version,
              policyExt: tmpl.template.policyExt,
              baseFields: baseFieldsFor(),
              policyExtFields: extFieldsFor(tmpl.template.policyExt),
              template: tmpl.template,
            }
          : null,
        policy: latest
          ? {
              id: latest.id,
              version: latest.version,
              status: latest.status,
              policy: latest.policy,
              checksum: latest.checksum,
              updatedAt: latest.updated_at,
              createdBy: latest.created_by,
            }
          : null,
      });
    });
  });

  app.put("/agents/:id/policy", async (req: any, reply: any) => {
    const agentId = String(req.params.id);
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);
    const body = (req.body ?? {}) as {
      policy?: unknown;
      expectedVersion?: number;
    };

    return withOrgScope(pool, orgId, async (client) => {
      if (!(await canEditAgent(client, { adminId, agentId, orgId }))) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      const def = await agentExists(client, agentId);
      if (!def) {
        return reply.code(404).send({ error: "AGENT_NOT_FOUND" });
      }

      const validated = await validatePolicyForAgent(
        client,
        agentId,
        body.policy,
      );
      if (!validated.ok) {
        return reply.code(validated.status).send(validated.body);
      }

      const exact = await client.query(
        orgId === null
          ? `SELECT id, version, status, policy, checksum, updated_at, created_by
               FROM agent_policies
              WHERE agent_id = $1 AND org_id IS NULL
              ORDER BY version DESC LIMIT 1`
          : `SELECT id, version, status, policy, checksum, updated_at, created_by
               FROM agent_policies
              WHERE agent_id = $1 AND org_id = $2
              ORDER BY version DESC LIMIT 1`,
        orgId === null ? [agentId] : [agentId, orgId],
      );
      const scopeLatest = exact.rows[0] ?? null;

      if (
        body.expectedVersion !== undefined &&
        scopeLatest &&
        scopeLatest.version !== body.expectedVersion
      ) {
        return reply.code(409).send({
          error: "STALE_POLICY",
          currentVersion: scopeLatest.version,
        });
      }

      let row: { id: string; version: number; status: string; updated_at: Date };

      if (!scopeLatest) {
        const { rows } = await client.query(
          `INSERT INTO agent_policies
             (org_id, agent_id, policy, status, version, created_by)
           VALUES ($1, $2, $3::jsonb, 'draft', 1, $4)
           RETURNING id, version, status, updated_at`,
          [orgId, agentId, JSON.stringify(validated.policy), adminId],
        );
        row = rows[0];
      } else if (scopeLatest.status === "draft") {
        const { rows } = await client.query(
          `UPDATE agent_policies
              SET policy = $1::jsonb,
                  status = 'draft',
                  updated_at = now(),
                  created_by = $2
            WHERE id = $3
            RETURNING id, version, status, updated_at`,
          [JSON.stringify(validated.policy), adminId, scopeLatest.id],
        );
        row = rows[0];
      } else {
        const nextVersion = scopeLatest.version + 1;
        const { rows } = await client.query(
          `INSERT INTO agent_policies
             (org_id, agent_id, policy, status, version, created_by)
           VALUES ($1, $2, $3::jsonb, 'draft', $4, $5)
           RETURNING id, version, status, updated_at`,
          [
            orgId,
            agentId,
            JSON.stringify(validated.policy),
            nextVersion,
            adminId,
          ],
        );
        row = rows[0];
      }

      return reply.send({
        status: row.status,
        agentId,
        agentKey: validated.agentKey,
        policyExt: validated.policyExt,
        version: row.version,
        policyId: row.id,
        updatedAt: row.updated_at,
        policy: validated.policy,
      });
    });
  });

  app.post("/agents/:id/generate", async (req: any, reply: any) => {
    const agentId = String(req.params.id);
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);
    const body = (req.body ?? {}) as {
      policy?: unknown;
      expectedVersion?: number;
    };

    return withOrgScope(pool, orgId, async (client) => {
      if (!(await canEditAgent(client, { adminId, agentId, orgId }))) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      const def = await agentExists(client, agentId);
      if (!def) {
        return reply.code(404).send({ error: "AGENT_NOT_FOUND" });
      }

      const validated = await validatePolicyForAgent(
        client,
        agentId,
        body.policy,
      );
      if (!validated.ok) {
        return reply.code(validated.status).send(validated.body);
      }

      const exact = await client.query(
        orgId === null
          ? `SELECT id, version, status, policy, checksum, updated_at, created_by
               FROM agent_policies
              WHERE agent_id = $1 AND org_id IS NULL
              ORDER BY version DESC LIMIT 1`
          : `SELECT id, version, status, policy, checksum, updated_at, created_by
               FROM agent_policies
              WHERE agent_id = $1 AND org_id = $2
              ORDER BY version DESC LIMIT 1`,
        orgId === null ? [agentId] : [agentId, orgId],
      );
      const latest = exact.rows[0] ?? null;

      if (!latest) {
        return reply.code(404).send({
          error: "NO_DRAFT",
          message: "Save a policy draft before Generate",
        });
      }

      if (
        body.expectedVersion !== undefined &&
        latest.version !== body.expectedVersion
      ) {
        return reply.code(409).send({
          error: "STALE_POLICY",
          currentVersion: latest.version,
        });
      }

      if (latest.status !== "draft") {
        return reply.code(409).send({
          error: "NOT_DRAFT",
          message:
            "Latest version is not draft; Save a new draft version before Generate",
          currentVersion: latest.version,
          status: latest.status,
        });
      }

      const tmpl = await templateForAgentId(client, agentId);
      if (!tmpl) {
        return reply.code(404).send({
          error: "TEMPLATE_NOT_FOUND",
          message: "No active agent_templates row for this agent",
        });
      }

      let artifact: {
        source: string;
        checksum: string;
        graphKey: string;
        definition: unknown;
      };
      try {
        artifact = generateGraphFromTemplate(validated.policy, tmpl.template);
      } catch (err: any) {
        return reply.code(500).send({
          error: "GENERATION_FAILED",
          message: err?.message ?? String(err),
        });
      }

      const artifactRef = `agents/${validated.agentKey}/v${latest.version}/graph.json`;

      const { rows: policyRows } = await client.query(
        `UPDATE agent_policies
            SET policy = $1::jsonb,
                status = 'generated',
                checksum = $2,
                updated_at = now(),
                created_by = $3
          WHERE id = $4
          RETURNING id, version, status, updated_at`,
        [
          JSON.stringify(validated.policy),
          artifact.checksum,
          adminId,
          latest.id,
        ],
      );
      const policyRow = policyRows[0];

      const { rows: versionRows } = await client.query(
        `INSERT INTO agent_versions
           (agent_id, org_id, policy_id, version, artifact_ref, artifact_source,
            checksum, status, generated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'generated', $8)
         RETURNING id, generated_at, checksum, version`,
        [
          agentId,
          orgId,
          policyRow.id,
          policyRow.version,
          artifactRef,
          artifact.source,
          artifact.checksum,
          adminId,
        ],
      );
      const ver = versionRows[0];

      return reply.send({
        status: "generated",
        agentId,
        agentKey: validated.agentKey,
        policyExt: validated.policyExt,
        graphKey: artifact.graphKey,
        version: ver.version,
        checksum: ver.checksum,
        generatedAt: ver.generated_at,
        artifactRef,
        definition: artifact.definition,
        policyId: policyRow.id,
        versionId: ver.id,
      });
    });
  });

  app.post("/agents/:id/compile", async (req: any, reply: any) => {
    const agentId = String(req.params.id);
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);
    const body = (req.body ?? {}) as {
      expectedVersion?: number;
    };

    return withOrgScope(pool, orgId, async (client) => {
      if (!(await canEditAgent(client, { adminId, agentId, orgId }))) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      const def = await agentExists(client, agentId);
      if (!def) {
        return reply.code(404).send({ error: "AGENT_NOT_FOUND" });
      }

      const latest = await latestGeneratedArtifact(client, agentId, orgId);
      if (!latest) {
        return reply.code(404).send({
          error: "NO_GENERATED",
          message: "Generate a policy (Stage 1) before Compile.",
        });
      }

      if (
        body.expectedVersion !== undefined &&
        latest.version !== body.expectedVersion
      ) {
        return reply.code(409).send({
          error: "STALE_POLICY",
          currentVersion: latest.version,
        });
      }

      // Policy that produced this artifact.
      const policyRow = (
        await client.query<PolicyRow & QueryResultRow>(
          `SELECT id, version, status, policy, checksum, updated_at, created_by
             FROM agent_policies
            WHERE id = $1
            LIMIT 1`,
          [latest.policy_id],
        )
      ).rows[0];

      if (!policyRow) {
        return reply.code(404).send({ error: "POLICY_NOT_FOUND" });
      }

      const tmpl = await templateForAgentId(client, agentId);
      if (!tmpl) {
        return reply.code(404).send({
          error: "TEMPLATE_NOT_FOUND",
          message: "No active agent_templates row for this agent",
        });
      }

      // Re-validate policy with the same schema name used at Generate.
      const validated = validateAgentPolicy(policyRow.policy, {
        policyExt: tmpl.template.policyExt,
      });
      if (!validated.ok) {
        return reply.code(400).send({
          error: "POLICY_INVALID",
          fields: validated.fields,
        });
      }

      // Parse + validate the graph artifact produced by Stage 1.
      let parsedGraph: GraphDefinition;
      try {
        parsedGraph = GraphDefinitionSchema.parse(
          JSON.parse(latest.artifact_source),
        );
      } catch (err: any) {
        return reply.code(500).send({
          error: "ARTIFACT_PARSE_FAILED",
          message: err?.message ?? String(err),
        });
      }
      try {
        validateGraphTopology(parsedGraph);
      } catch (err: any) {
        return reply.code(500).send({
          error: "GRAPH_INVALID",
          message: err?.message ?? String(err),
        });
      }

      // Resolve deps (cheap): each graph node impl must exist in the tool registry.
      // This catches the most common "graph changes but Stage 2 still compiles"
      // misconfiguration where node.impl is unknown.
      for (const node of parsedGraph.nodes) {
        if (!isRegisteredTool(node.impl)) {
          return reply.code(400).send({
            error: "GRAPH_DEPENDENCY_MISSING",
            message: `Unknown node impl "${node.impl}" for node "${node.id}"`,
            nodeId: node.id,
            impl: node.impl,
          });
        }
      }

      // Checksum audit: refuse compile if Stage 1 artifact doesn't match checksum.
      const computed = createHash("sha256")
        .update(latest.artifact_source)
        .digest("hex");
      if (computed !== latest.checksum) {
        return reply.code(409).send({
          error: "CHECKSUM_MISMATCH",
          message: "Artifact checksum mismatch; refuse to compile.",
        });
      }

      if (
        policyRow.checksum !== null &&
        policyRow.checksum !== latest.checksum
      ) {
        return reply.code(409).send({
          error: "POLICY_ARTIFACT_CHECKSUM_MISMATCH",
          message: "Agent policy checksum doesn't match generated artifact checksum.",
          policyChecksum: policyRow.checksum,
          artifactChecksum: latest.checksum,
        });
      }

      // graph_definitions table (V11) is owned/managed by runtime migrations.
      // Stage 2 Compile should not attempt DDL during request handling.

      const graphKey = parsedGraph.graphKey;
      const scopeText = orgId ?? null; // null => global row
      const safeKey = graphKey.replace(/[^a-zA-Z0-9_\\-]/g, "_");
      const graphId = `graph_${safeKey}_v${latest.version}_${scopeText ?? "global"}`;

      await client.query(
        `INSERT INTO graph_definitions
           (id, org_id, graph_key, version, definition, checksum, status, created_by, activated_at)
         VALUES
           ($1, $2, $3, $4, $5::jsonb, $6, 'draft', $7, NULL)
         ON CONFLICT (id) DO UPDATE
           SET org_id = EXCLUDED.org_id,
               graph_key = EXCLUDED.graph_key,
               version = EXCLUDED.version,
               definition = EXCLUDED.definition,
               checksum = EXCLUDED.checksum,
               status = 'draft',
               created_by = EXCLUDED.created_by,
               activated_at = NULL`,
        [
          graphId,
          scopeText,
          graphKey,
          latest.version,
          JSON.stringify(parsedGraph),
          latest.checksum,
          adminId,
        ],
      );

      // Persist compile history (mirrors agent_versions on the graph side).
      await client.query(
        `INSERT INTO graph_versions
           (org_id, graph_id, graph_key, version, definition, checksum, status, compiled_by, compiled_at)
         VALUES
           ($1, $2, $3, $4, $5::jsonb, $6, 'compiled', $7, now())`,
        [
          scopeText,
          graphId,
          graphKey,
          latest.version,
          JSON.stringify(parsedGraph),
          latest.checksum,
          adminId,
        ],
      );

      await client.query(
        `UPDATE agent_policies
            SET status = 'compiled',
                updated_at = now()
          WHERE id = $1`,
        [policyRow.id],
      );

      await client.query(
        `UPDATE agent_versions
            SET status = 'compiled'
          WHERE id = $1`,
        [latest.id],
      );

      return reply.send({
        status: "compiled",
        agentId,
        agentKey: tmpl.agentKey,
        policyExt: tmpl.template.policyExt,
        graphKey,
        version: latest.version,
        checksum: latest.checksum,
      });
    });
  });

  /**
   * Stage 3 Publish — compiled → published only.
   * Does NOT activate, does NOT retire runtime graph keys, does NOT call the worker.
   * graph_definitions stays draft until Activate (separate, authored-key only).
   */
  app.post("/agents/:id/publish", async (req: any, reply: any) => {
    const agentId = String(req.params.id);
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);
    const body = (req.body ?? {}) as {
      expectedVersion?: number;
    };

    return withOrgScope(pool, orgId, async (client) => {
      if (!(await canEditAgent(client, { adminId, agentId, orgId }))) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      const def = await agentExists(client, agentId);
      if (!def) {
        return reply.code(404).send({ error: "AGENT_NOT_FOUND" });
      }

      const latest = await latestCompiledArtifact(client, agentId, orgId);
      if (!latest) {
        return reply.code(404).send({
          error: "NO_COMPILED",
          message: "Compile a policy (Stage 2) before Publish.",
        });
      }

      if (
        body.expectedVersion !== undefined &&
        latest.version !== body.expectedVersion
      ) {
        return reply.code(409).send({
          error: "STALE_POLICY",
          currentVersion: latest.version,
        });
      }

      const policyRow = (
        await client.query<PolicyRow & QueryResultRow>(
          `SELECT id, version, status, policy, checksum, updated_at, created_by
             FROM agent_policies
            WHERE id = $1
            LIMIT 1`,
          [latest.policy_id],
        )
      ).rows[0];

      if (!policyRow) {
        return reply.code(404).send({ error: "POLICY_NOT_FOUND" });
      }

      if (policyRow.status !== "compiled") {
        return reply.code(409).send({
          error: "NOT_COMPILED",
          message: `Policy status is "${policyRow.status}"; Publish requires compiled.`,
          status: policyRow.status,
        });
      }

      const tmpl = await templateForAgentId(client, agentId);
      if (!tmpl) {
        return reply.code(404).send({
          error: "TEMPLATE_NOT_FOUND",
          message: "No active agent_templates row for this agent",
        });
      }

      let graphKey = `${tmpl.agentKey}.authored`;
      try {
        const parsed = GraphDefinitionSchema.parse(
          JSON.parse(latest.artifact_source),
        );
        graphKey = parsed.graphKey;
      } catch {
        /* keep template-derived key */
      }

      await client.query(
        `UPDATE agent_policies
            SET status = 'published',
                updated_at = now()
          WHERE id = $1`,
        [policyRow.id],
      );

      await client.query(
        `UPDATE agent_versions
            SET status = 'published'
          WHERE id = $1`,
        [latest.id],
      );

      // History note only — do NOT set graph_definitions to active.
      const scopeText = orgId ?? null;
      await client.query(
        `UPDATE graph_versions
            SET status = 'published'
          WHERE graph_key = $1
            AND version = $2
            AND (($3::text IS NULL AND org_id IS NULL) OR org_id = $3)`,
        [graphKey, latest.version, scopeText],
      );

      // Confirm we never touched runtime keys / never activated.
      // graph_definitions for this authored key+version must remain draft (or non-active).

      return reply.send({
        status: "published",
        agentId,
        agentKey: tmpl.agentKey,
        policyExt: tmpl.template.policyExt,
        graphKey,
        version: latest.version,
        checksum: latest.checksum,
      });
    });
  });

  /**
   * Stage 3 Activate — published → active, authored graph_key only.
   * Retires previous active under the SAME graph_key + org scope.
   * Never updates syntra.*.workflow (or any non-authored key).
   */
  app.post("/agents/:id/activate", async (req: any, reply: any) => {
    const agentId = String(req.params.id);
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);
    const body = (req.body ?? {}) as {
      expectedVersion?: number;
    };

    return withOrgScope(pool, orgId, async (client) => {
      if (!(await canEditAgent(client, { adminId, agentId, orgId }))) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      const def = await agentExists(client, agentId);
      if (!def) {
        return reply.code(404).send({ error: "AGENT_NOT_FOUND" });
      }

      const latest = await latestPublishedArtifact(client, agentId, orgId);
      if (!latest) {
        return reply.code(404).send({
          error: "NO_PUBLISHED",
          message: "Publish a compiled policy before Activate.",
        });
      }

      if (
        body.expectedVersion !== undefined &&
        latest.version !== body.expectedVersion
      ) {
        return reply.code(409).send({
          error: "STALE_POLICY",
          currentVersion: latest.version,
        });
      }

      const policyRow = (
        await client.query<PolicyRow & QueryResultRow>(
          `SELECT id, version, status, policy, checksum, updated_at, created_by
             FROM agent_policies
            WHERE id = $1
            LIMIT 1`,
          [latest.policy_id],
        )
      ).rows[0];

      if (!policyRow) {
        return reply.code(404).send({ error: "POLICY_NOT_FOUND" });
      }

      if (policyRow.status !== "published") {
        return reply.code(409).send({
          error: "NOT_PUBLISHED",
          message: `Policy status is "${policyRow.status}"; Activate requires published.`,
          status: policyRow.status,
        });
      }

      const tmpl = await templateForAgentId(client, agentId);
      if (!tmpl) {
        return reply.code(404).send({
          error: "TEMPLATE_NOT_FOUND",
          message: "No active agent_templates row for this agent",
        });
      }

      let graphKey: string;
      try {
        graphKey = GraphDefinitionSchema.parse(
          JSON.parse(latest.artifact_source),
        ).graphKey;
      } catch (err: any) {
        return reply.code(500).send({
          error: "ARTIFACT_PARSE_FAILED",
          message: err?.message ?? String(err),
        });
      }

      try {
        assertAuthoredGraphKey(graphKey, tmpl.agentKey);
      } catch (err: any) {
        return reply.code(400).send({
          error: err?.code ?? "NOT_AUTHORED_KEY",
          message: err?.message ?? String(err),
          graphKey,
        });
      }

      const scopeText = orgId ?? null;
      const safeKey = graphKey.replace(/[^a-zA-Z0-9_\\-]/g, "_");
      const graphId = `graph_${safeKey}_v${latest.version}_${scopeText ?? "global"}`;

      // 1) Retire ALL previous active under THIS graph_key only (never other keys).
      await client.query(
        `UPDATE graph_definitions
            SET status = 'retired'
          WHERE graph_key = $1
            AND status = 'active'
            AND org_id IS NOT DISTINCT FROM $2::text`,
        [graphKey, scopeText],
      );

      // 2) Activate target authored definition by primary key (same id Compile wrote).
      let activated = await client.query(
        `UPDATE graph_definitions
            SET status = 'active',
                activated_at = now()
          WHERE id = $1
            AND graph_key = $2
          RETURNING id, graph_key, version, status`,
        [graphId, graphKey],
      );

      if ((activated.rowCount ?? 0) === 0) {
        activated = await client.query(
          `UPDATE graph_definitions
              SET status = 'active',
                  activated_at = now()
            WHERE graph_key = $1
              AND version = $2
              AND org_id IS NOT DISTINCT FROM $3::text
            RETURNING id, graph_key, version, status`,
          [graphKey, latest.version, scopeText],
        );
      }

      if ((activated.rowCount ?? 0) === 0 || activated.rows[0]?.status !== "active") {
        return reply.code(404).send({
          error: "GRAPH_DEFINITION_NOT_FOUND",
          message: `No graph_definitions row for ${graphKey} v${latest.version} (id=${graphId})`,
        });
      }

      const activatedId = String(activated.rows[0].id);

      // 3) Authoring one-active: demote previous active policy for this agent+scope.
      if (orgId === null) {
        await client.query(
          `UPDATE agent_policies
              SET status = 'published',
                  updated_at = now()
            WHERE agent_id = $1
              AND org_id IS NULL
              AND status = 'active'
              AND id <> $2`,
          [agentId, policyRow.id],
        );
      } else {
        await client.query(
          `UPDATE agent_policies
              SET status = 'published',
                  updated_at = now()
            WHERE agent_id = $1
              AND org_id = $2
              AND status = 'active'
              AND id <> $3`,
          [agentId, orgId, policyRow.id],
        );
      }

      await client.query(
        `UPDATE agent_policies
            SET status = 'active',
                updated_at = now()
          WHERE id = $1`,
        [policyRow.id],
      );

      // Demote other agent_versions for this agent+scope (one active authoring version).
      if (orgId === null) {
        await client.query(
          `UPDATE agent_versions
              SET status = 'published'
            WHERE agent_id = $1
              AND org_id IS NULL
              AND status = 'active'
              AND id <> $2`,
          [agentId, latest.id],
        );
      } else {
        await client.query(
          `UPDATE agent_versions
              SET status = 'published'
            WHERE agent_id = $1
              AND org_id = $2
              AND status = 'active'
              AND id <> $3`,
          [agentId, orgId, latest.id],
        );
      }

      await client.query(
        `UPDATE agent_versions
            SET status = 'active'
          WHERE id = $1`,
        [latest.id],
      );

      await client.query(
        `UPDATE graph_versions
            SET status = 'published'
          WHERE graph_key = $1
            AND status = 'active'
            AND org_id IS NOT DISTINCT FROM $2::text
            AND version <> $3`,
        [graphKey, scopeText, latest.version],
      );

      await client.query(
        `UPDATE graph_versions
            SET status = 'active'
          WHERE graph_key = $1
            AND version = $2
            AND org_id IS NOT DISTINCT FROM $3::text`,
        [graphKey, latest.version, scopeText],
      );

      return reply.send({
        status: "active",
        agentId,
        agentKey: tmpl.agentKey,
        policyExt: tmpl.template.policyExt,
        graphKey,
        version: latest.version,
        checksum: latest.checksum,
        graphId: activatedId,
      });
    });
  });

  /**
   * Stage 3 Rollback — reactivate a prior published version under the same authored graph_key.
   * Body: { targetVersion: number }
   * Never touches runtime *.workflow keys.
   */
  app.post("/agents/:id/rollback", async (req: any, reply: any) => {
    const agentId = String(req.params.id);
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);
    const body = (req.body ?? {}) as {
      targetVersion?: number;
    };

    if (
      body.targetVersion === undefined ||
      !Number.isFinite(body.targetVersion)
    ) {
      return reply.code(400).send({
        error: "TARGET_VERSION_REQUIRED",
        message: "Body must include targetVersion (number).",
      });
    }
    const targetVersion = Number(body.targetVersion);

    return withOrgScope(pool, orgId, async (client) => {
      if (!(await canEditAgent(client, { adminId, agentId, orgId }))) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      const def = await agentExists(client, agentId);
      if (!def) {
        return reply.code(404).send({ error: "AGENT_NOT_FOUND" });
      }

      const tmpl = await templateForAgentId(client, agentId);
      if (!tmpl) {
        return reply.code(404).send({
          error: "TEMPLATE_NOT_FOUND",
          message: "No active agent_templates row for this agent",
        });
      }

      const expectedKey = `${tmpl.agentKey}.authored`;
      const scopeText = orgId ?? null;

      // Target must be a published (or currently active) authored version.
      const targetRows =
        orgId === null
          ? await client.query<GeneratedArtifactRow & QueryResultRow>(
              `SELECT id, version, artifact_source, checksum, policy_id
                 FROM agent_versions
                WHERE agent_id = $1
                  AND org_id IS NULL
                  AND version = $2
                  AND status IN ('published', 'active')
                LIMIT 1`,
              [agentId, targetVersion],
            )
          : await client.query<GeneratedArtifactRow & QueryResultRow>(
              `SELECT id, version, artifact_source, checksum, policy_id
                 FROM agent_versions
                WHERE agent_id = $1
                  AND org_id = $2
                  AND version = $3
                  AND status IN ('published', 'active')
                LIMIT 1`,
              [agentId, orgId, targetVersion],
            );

      const target = targetRows.rows[0];
      if (!target) {
        return reply.code(404).send({
          error: "TARGET_NOT_FOUND",
          message: `No published version ${targetVersion} to roll back to.`,
        });
      }

      let graphKey: string;
      try {
        graphKey = GraphDefinitionSchema.parse(
          JSON.parse(target.artifact_source),
        ).graphKey;
      } catch (err: any) {
        return reply.code(500).send({
          error: "ARTIFACT_PARSE_FAILED",
          message: err?.message ?? String(err),
        });
      }

      try {
        assertAuthoredGraphKey(graphKey, tmpl.agentKey);
      } catch (err: any) {
        return reply.code(400).send({
          error: err?.code ?? "NOT_AUTHORED_KEY",
          message: err?.message ?? String(err),
          graphKey,
        });
      }

      if (graphKey !== expectedKey) {
        return reply.code(400).send({
          error: "NOT_AUTHORED_KEY",
          message: `Rollback refused: expected ${expectedKey}`,
          graphKey,
        });
      }

      const policyRow = (
        await client.query<PolicyRow & QueryResultRow>(
          `SELECT id, version, status, policy, checksum, updated_at, created_by
             FROM agent_policies
            WHERE id = $1
            LIMIT 1`,
          [target.policy_id],
        )
      ).rows[0];

      if (!policyRow) {
        return reply.code(404).send({ error: "POLICY_NOT_FOUND" });
      }

      if (!["published", "active"].includes(policyRow.status)) {
        return reply.code(409).send({
          error: "TARGET_NOT_PUBLISHED",
          message: `Target policy status is "${policyRow.status}"`,
          status: policyRow.status,
        });
      }

      // Retire current active under THIS authored key only.
      const safeKey = graphKey.replace(/[^a-zA-Z0-9_\\-]/g, "_");
      const graphId = `graph_${safeKey}_v${targetVersion}_${scopeText ?? "global"}`;

      await client.query(
        `UPDATE graph_definitions
            SET status = 'retired'
          WHERE graph_key = $1
            AND status = 'active'
            AND org_id IS NOT DISTINCT FROM $2::text`,
        [graphKey, scopeText],
      );

      let activated = await client.query(
        `UPDATE graph_definitions
            SET status = 'active',
                activated_at = now()
          WHERE id = $1
            AND graph_key = $2
          RETURNING id, status`,
        [graphId, graphKey],
      );

      if ((activated.rowCount ?? 0) === 0) {
        activated = await client.query(
          `UPDATE graph_definitions
              SET status = 'active',
                  activated_at = now()
            WHERE graph_key = $1
              AND version = $2
              AND org_id IS NOT DISTINCT FROM $3::text
            RETURNING id, status`,
          [graphKey, targetVersion, scopeText],
        );
      }

      if ((activated.rowCount ?? 0) === 0 || activated.rows[0]?.status !== "active") {
        return reply.code(404).send({
          error: "GRAPH_DEFINITION_NOT_FOUND",
          message: `No graph_definitions row for ${graphKey} v${targetVersion}`,
        });
      }

      const activatedId = String(activated.rows[0].id);

      // Authoring one-active for this agent+scope.
      if (orgId === null) {
        await client.query(
          `UPDATE agent_policies
              SET status = 'published',
                  updated_at = now()
            WHERE agent_id = $1
              AND org_id IS NULL
              AND status = 'active'
              AND id <> $2`,
          [agentId, policyRow.id],
        );
        await client.query(
          `UPDATE agent_versions
              SET status = 'published'
            WHERE agent_id = $1
              AND org_id IS NULL
              AND status = 'active'
              AND id <> $2`,
          [agentId, target.id],
        );
      } else {
        await client.query(
          `UPDATE agent_policies
              SET status = 'published',
                  updated_at = now()
            WHERE agent_id = $1
              AND org_id = $2
              AND status = 'active'
              AND id <> $3`,
          [agentId, orgId, policyRow.id],
        );
        await client.query(
          `UPDATE agent_versions
              SET status = 'published'
            WHERE agent_id = $1
              AND org_id = $2
              AND status = 'active'
              AND id <> $3`,
          [agentId, orgId, target.id],
        );
      }

      await client.query(
        `UPDATE agent_policies
            SET status = 'active',
                updated_at = now()
          WHERE id = $1`,
        [policyRow.id],
      );

      await client.query(
        `UPDATE agent_versions
            SET status = 'active'
          WHERE id = $1`,
        [target.id],
      );

      await client.query(
        `UPDATE graph_versions
            SET status = 'published'
          WHERE graph_key = $1
            AND status = 'active'
            AND org_id IS NOT DISTINCT FROM $2::text
            AND version <> $3`,
        [graphKey, scopeText, targetVersion],
      );

      await client.query(
        `UPDATE graph_versions
            SET status = 'active'
          WHERE graph_key = $1
            AND version = $2
            AND org_id IS NOT DISTINCT FROM $3::text`,
        [graphKey, targetVersion, scopeText],
      );

      return reply.send({
        status: "active",
        rolledBackTo: targetVersion,
        agentId,
        agentKey: tmpl.agentKey,
        policyExt: tmpl.template.policyExt,
        graphKey,
        version: targetVersion,
        checksum: target.checksum,
        graphId: activatedId,
      });
    });
  });
}
