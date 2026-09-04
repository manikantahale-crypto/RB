import type { Pool, PoolClient, QueryResultRow } from "pg";
import { createHash } from "node:crypto";
import {
  baseFieldsFor,
  extFieldsFor,
  generateGraphFromTemplate,
  generateGraphFromLlm,
  GenerationFailedError,
  loadEventCatalog,
  loadEventSchemaDetail,
  GraphDefinitionSchema,
  validateAuthoredGraphForGoLive,
  evaluateGoLiveGate,
  buildGenerationMeta,
  buildLlmGenerationTrace,
  buildGraphSystemPrompt,
  readGenerationMeta,
  readGapAckFromMeta,
  oneActiveIndexIsPerGraphKey,
  listActiveTemplates,
  parseStoredGraphArtifact,
  summarizeGraphWorkflow,
  templateForAgentId,
  validateAgentPolicy,
  enrichPolicyFromDefaults,
  EventAlreadyBoundError,
  upsertActiveEventBinding,
  resolveActiveEventBinding,
  type GraphDefinition,
  type AgentPolicy,
  type LLMClient,
  isBuilderVisibleAgentId,
  canDeleteAgentFromBuilder,
} from "@tekisho/authoring";
import { canEditAgent, editableAgentIds } from "../entitlement.js";
import { withOrgScope, type DbQueryable } from "../with-org-scope.js";

type FastifyLike = {
  get: (path: string, handler: any) => void;
  put: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
  delete: (path: string, handler: any) => void;
  /** Present on real Fastify — used by approve-go-live to chain Stage 2–3. */
  inject?: (opts: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }) => Promise<{ statusCode: number; json: () => unknown }>;
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
  meta: unknown;
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

const AGENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseAgentId(raw: unknown): string | null {
  const id = String(raw ?? "").trim();
  if (!id || !AGENT_ID_RE.test(id)) return null;
  return id;
}

function invalidAgentId(reply: any) {
  return reply.code(400).send({
    error: "INVALID_AGENT_ID",
    message: "Provide a valid agent UUID in the URL.",
  });
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
          `SELECT id, version, artifact_source, checksum, policy_id, meta
             FROM agent_versions
            WHERE agent_id = $1
              AND org_id IS NULL
              AND status = 'generated'
            ORDER BY version DESC
            LIMIT 1`,
          [agentId],
        )
      : await client.query<GeneratedArtifactRow & QueryResultRow>(
          `SELECT id, version, artifact_source, checksum, policy_id, meta
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
      ? enrichPolicyFromDefaults(
          {
            ...(rawPolicy as object),
            agentId,
            agentKey: tmpl.agentKey,
          },
          tmpl.template.policyExt,
        )
      : enrichPolicyFromDefaults(
          { agentId, agentKey: tmpl.agentKey },
          tmpl.template.policyExt,
        );

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

export type AgentRouteOptions = {
  /**
   * LLM client for description-driven Generate (llm-graph-generator-design).
   * Required when the client sends a non-empty `request` body field.
   */
  llm?: LLMClient;
  /** Migrator pool for writes the relay role cannot perform (e.g. soft-delete). */
  privilegedPool?: Pool;
};

export function registerAgentRoutes(
  app: FastifyLike,
  pool: Pool,
  opts: AgentRouteOptions = {},
): void {
  const writePool = opts.privilegedPool ?? pool;
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
          COALESCE(t.display_name, d.name) AS name,
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
          g.status AS last_generated_status,
          b.event_type AS binding_event_type,
          b.graph_key AS binding_graph_key,
          b.version AS binding_version,
          b.source AS binding_source
        FROM agent_definitions d
        LEFT JOIN LATERAL (
          SELECT display_name
            FROM agent_templates
           WHERE agent_id = d.id
             AND is_active = true
           ORDER BY version DESC
           LIMIT 1
        ) t ON true
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
        LEFT JOIN LATERAL (
          SELECT event_type, graph_key, version, source
            FROM graph_event_bindings
           WHERE agent_id = d.id
             AND status = 'active'
           ORDER BY updated_at DESC
           LIMIT 1
        ) b ON true
        WHERE d.is_active = true
        ORDER BY COALESCE(t.display_name, d.name)
        `,
        params,
      );

      const visibleRows = rows.filter((r: { id: string }) =>
        isBuilderVisibleAgentId(r.id),
      );

      const editable = await editableAgentIds(
        client,
        adminId,
        orgId,
        visibleRows.map((r: { id: string }) => r.id),
      );

      return reply.send({
        orgId,
        agents: visibleRows.map((r: any) => ({
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
          binding: r.binding_event_type
            ? {
                eventType: r.binding_event_type,
                graphKey: r.binding_graph_key,
                version: r.binding_version ?? null,
                source: r.binding_source ?? "authoring",
              }
            : null,
        })),
      });
    });
  });

  app.get("/agents/:id", async (req: any, reply: any) => {
    const agentId = parseAgentId(req.params.id);
    if (!agentId) return invalidAgentId(reply);
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

      let workflow: {
        definition: unknown;
        version: number;
        checksum: string;
        status?: string;
        generatedAt?: Date;
        meta?: unknown;
      } | null = null;
      // Latest generated graph for this agent — not tied to current draft version
      // (a new Save draft bumps version without clearing the prior workflow).
      {
        const verRows = await client.query(
          orgId === null
            ? `SELECT version, artifact_source, checksum, status, generated_at, meta
                 FROM agent_versions
                WHERE agent_id = $1 AND org_id IS NULL
                  AND artifact_source IS NOT NULL
                  AND artifact_source <> ''
                ORDER BY generated_at DESC NULLS LAST, version DESC
                LIMIT 1`
            : `SELECT version, artifact_source, checksum, status, generated_at, meta
                 FROM agent_versions
                WHERE agent_id = $1 AND org_id = $2
                  AND artifact_source IS NOT NULL
                  AND artifact_source <> ''
                ORDER BY generated_at DESC NULLS LAST, version DESC
                LIMIT 1`,
          orgId === null ? [agentId] : [agentId, orgId],
        );
        const vrow = verRows.rows[0] as
          | {
              version: number;
              artifact_source: string;
              checksum: string;
              status: string;
              generated_at: Date;
              meta: unknown;
            }
          | undefined;
        if (vrow?.artifact_source) {
          const definition = parseStoredGraphArtifact(vrow.artifact_source);
          if (definition) {
            workflow = {
              definition,
              version: vrow.version,
              checksum: vrow.checksum,
              status: vrow.status,
              generatedAt: vrow.generated_at,
              meta: vrow.meta,
            };
          }
        }
      }

      const generation = workflow?.meta
        ? readGenerationMeta(workflow.meta)
        : null;

      const triggerEventType =
        typeof (latest?.policy as Record<string, unknown> | undefined)
          ?.triggerEventType === "string"
          ? String(
              (latest!.policy as Record<string, unknown>).triggerEventType,
            )
          : generation?.triggerEventType ?? null;

      let triggerEventSchema = null;
      if (triggerEventType) {
        try {
          triggerEventSchema = await loadEventSchemaDetail(
            client,
            triggerEventType,
          );
        } catch {
          /* ignore */
        }
      }

      const runtimeBinding = await client.query(
        `SELECT event_type, graph_key, module_queue, version, source, status
           FROM graph_event_bindings
          WHERE agent_id = $1::uuid
            AND status = 'active'
          ORDER BY updated_at DESC
          LIMIT 1`,
        [agentId],
      );
      const bindingRow = runtimeBinding.rows[0] as
        | {
            event_type: string;
            graph_key: string;
            module_queue: string;
            version: number | null;
            source: string;
            status: string;
          }
        | undefined;

      let activeCompiledGraph: {
        graphKey: string;
        version: number;
        checksum: string;
        status: string;
      } | null = null;
      const authoredKey = tmpl ? `${tmpl.agentKey}.authored` : null;
      const graphKeyLookup = bindingRow?.graph_key ?? authoredKey;
      if (graphKeyLookup) {
        const gRows = await client.query(
          orgId === null
            ? `SELECT graph_key, version, checksum, status
                 FROM graph_definitions
                WHERE graph_key = $1
                  AND org_id IS NULL
                  AND status = 'active'
                LIMIT 1`
            : `SELECT graph_key, version, checksum, status
                 FROM graph_definitions
                WHERE graph_key = $1
                  AND (org_id = $2 OR org_id IS NULL)
                  AND status = 'active'
                ORDER BY (org_id IS NOT NULL) DESC
                LIMIT 1`,
          orgId === null ? [graphKeyLookup] : [graphKeyLookup, orgId],
        );
        const g = gRows.rows[0] as
          | {
              graph_key: string;
              version: number;
              checksum: string;
              status: string;
            }
          | undefined;
        if (g) {
          activeCompiledGraph = {
            graphKey: g.graph_key,
            version: g.version,
            checksum: g.checksum,
            status: g.status,
          };
        }
      }

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
        workflow: workflow
          ? {
              definition: workflow.definition,
              version: workflow.version,
              checksum: workflow.checksum,
              status: workflow.status,
              generatedAt: workflow.generatedAt,
            }
          : null,
        generation,
        triggerEventSchema,
        runtime: bindingRow
          ? {
              binding: {
                eventType: bindingRow.event_type,
                graphKey: bindingRow.graph_key,
                moduleQueue: bindingRow.module_queue,
                version: bindingRow.version,
                source: bindingRow.source,
                status: bindingRow.status,
              },
              activeCompiledGraph,
            }
          : { binding: null, activeCompiledGraph },
      });
    });
  });

  app.put("/agents/:id/policy", async (req: any, reply: any) => {
    const agentId = parseAgentId(req.params.id);
    if (!agentId) return invalidAgentId(reply);
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
    const agentId = parseAgentId(req.params.id);
    if (!agentId) return invalidAgentId(reply);
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);
    const body = (req.body ?? {}) as {
      policy?: unknown;
      expectedVersion?: number;
      /** Plain-English workflow request (LLM path). */
      request?: string;
      /**
       * `llm` — description-driven (default when `request` is non-empty).
       * `template` — legacy snap-together (default when `request` is empty).
       */
      mode?: "llm" | "template";
      /**
       * Layer 3: preview only — run LLM + validate, do not store.
       * Admin must Accept with definition + accept:true to persist.
       */
      preview?: boolean;
      /** Layer 3: persist a previously previewed (and re-validated) definition. */
      accept?: boolean;
      /** Graph definition from preview; required when accept=true. */
      definition?: unknown;
    };

    const userRequest =
      typeof body.request === "string" ? body.request.trim() : "";
    const mode: "llm" | "template" =
      body.mode === "llm" || body.mode === "template"
        ? body.mode
        : userRequest
          ? "llm"
          : "template";
    const preview = body.preview === true;
    const accept = body.accept === true;
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

      // First generate requires draft; LLM preview/accept/regenerate allowed while
      // generated or pending_go_live (tweak English — withdraws the go-live request on accept).
      if (latest.status === "draft") {
        // ok
      } else if (
        (latest.status === "generated" || latest.status === "pending_go_live") &&
        mode === "llm" &&
        (accept || preview || Boolean(userRequest))
      ) {
        // preview / accept / regenerate
      } else if (latest.status !== "draft") {
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
        model?: string;
        mode: "llm" | "template";
        unsupported?: string[];
        builtSummary?: string;
        rawText?: string;
        generationTrace?: ReturnType<typeof buildLlmGenerationTrace>;
      };

      if (mode === "llm" && accept) {
        if (!body.definition || typeof body.definition !== "object") {
          return reply.code(400).send({
            error: "DEFINITION_REQUIRED",
            message: "Accept requires the previewed graph definition.",
          });
        }
        try {
          const def = validateAuthoredGraphForGoLive(body.definition, {
            defaultGraphKey: `${validated.agentKey}.authored`,
          });
          const locked = {
            ...def,
            graphKey: `${validated.agentKey}.authored`,
          };
          const source = `${JSON.stringify(locked, null, 2)}\n`;
          const unsupported = Array.isArray((body as { unsupported?: unknown })
            .unsupported)
            ? (
                (body as { unsupported: unknown[] }).unsupported as unknown[]
              ).filter((x): x is string => typeof x === "string")
            : [];
          artifact = {
            source,
            checksum: createHash("sha256").update(source).digest("hex"),
            graphKey: locked.graphKey,
            definition: locked,
            mode: "llm",
            unsupported,
            builtSummary: summarizeGraphWorkflow(locked).line,
            generationTrace: buildLlmGenerationTrace({
              userRequest:
                userRequest ||
                String(
                  (validated.policy as Record<string, unknown>).prompt ?? "",
                ),
              systemPrompt: buildGraphSystemPrompt({ events: [] }),
              rawText: "(persisted from accepted preview)",
              model: "accepted",
              definition: locked,
            }),
          };
        } catch (err: any) {
          const message = err?.message ?? String(err);
          return reply.code(422).send({
            error: "GENERATION_FAILED",
            message,
          });
        }
      } else if (mode === "llm") {
        if (!userRequest) {
          return reply.code(400).send({
            error: "REQUEST_REQUIRED",
            message:
              "LLM generate requires a non-empty `request` (plain-English description).",
          });
        }
        if (!opts.llm) {
          return reply.code(503).send({
            error: "LLM_NOT_CONFIGURED",
            message:
              "Set LLM_PROVIDER, LLM_API_KEY, and LLM_MODEL to use description-driven Generate.",
          });
        }

        let events: Awaited<ReturnType<typeof loadEventCatalog>> = [];
        try {
          events = await loadEventCatalog(client);
        } catch (err: any) {
          req.log?.warn?.(
            { err: err?.message ?? err },
            "loadEventCatalog failed; continuing without event descriptions",
          );
        }

        try {
          const llmResult = await generateGraphFromLlm({
            llm: opts.llm,
            userRequest,
            events,
            graphKey: `${validated.agentKey}.authored`,
          });
          const systemPrompt = buildGraphSystemPrompt({ events });
          const generationTrace = buildLlmGenerationTrace({
            userRequest,
            systemPrompt,
            rawText: llmResult.rawText,
            model: llmResult.model,
            definition: llmResult.definition,
          });
          artifact = {
            source: llmResult.source,
            checksum: llmResult.checksum,
            graphKey: llmResult.graphKey,
            definition: llmResult.definition,
            model: llmResult.model,
            mode: "llm",
            unsupported: llmResult.unsupported,
            builtSummary: llmResult.builtSummary,
            rawText: llmResult.rawText,
            generationTrace,
          };
        } catch (err: any) {
          const message = err?.message ?? String(err);
          const code =
            err instanceof GenerationFailedError ||
            message.startsWith("GENERATION_FAILED")
              ? 422
              : 500;
          return reply.code(code).send({
            error: "GENERATION_FAILED",
            message,
          });
        }

        if (preview) {
          return reply.send({
            status: "preview",
            preview: true,
            agentId,
            agentKey: validated.agentKey,
            graphKey: artifact.graphKey,
            version: latest.version,
            definition: artifact.definition,
            mode: "llm",
            model: artifact.model ?? null,
            request: userRequest,
            unsupported: artifact.unsupported ?? [],
            builtSummary: artifact.builtSummary ?? null,
            generationTrace: artifact.generationTrace ?? null,
            message:
              (artifact.unsupported?.length ?? 0) > 0
                ? `Built: ${artifact.builtSummary}. Could NOT add: ${(artifact.unsupported ?? []).join(", ")} (no tool available yet).`
                : `Built: ${artifact.builtSummary}. Review and Accept to save.`,
          });
        }
      } else {
        try {
          const templated = generateGraphFromTemplate(
            validated.policy,
            tmpl.template,
          );
          artifact = {
            source: templated.source,
            checksum: templated.checksum,
            graphKey: templated.graphKey,
            definition: templated.definition,
            mode: "template",
          };
        } catch (err: any) {
          return reply.code(500).send({
            error: "GENERATION_FAILED",
            message: err?.message ?? String(err),
          });
        }
      }

      const artifactRef = `agents/${validated.agentKey}/v${latest.version}/graph.json`;

      let events: Awaited<ReturnType<typeof loadEventCatalog>> = [];
      try {
        events = await loadEventCatalog(client);
      } catch (err: any) {
        req.log?.warn?.(
          { err: err?.message ?? err },
          "loadEventCatalog failed; continuing without event descriptions",
        );
      }

      const policyRecord = validated.policy as Record<string, unknown>;
      const triggerType = String(policyRecord.triggerEventType ?? "").trim();
      let triggerEventSchema: {
        eventType: string;
        schemaVersion: string;
        description: string;
        payloadSchema: unknown;
        envelopeFields: unknown;
      } | null = null;
      if (triggerType) {
        try {
          const detail = await loadEventSchemaDetail(client, triggerType);
          if (detail) {
            triggerEventSchema = {
              eventType: detail.eventType,
              schemaVersion: detail.schemaVersion,
              description: detail.description,
              payloadSchema: detail.payloadSchema,
              envelopeFields: detail.envelopeFields,
            };
          }
        } catch {
          /* ignore */
        }
      }

      const generationMeta = buildGenerationMeta({
        mode: artifact.mode,
        model: artifact.model ?? null,
        userRequest: mode === "llm" ? userRequest : null,
        rawText: artifact.rawText ?? null,
        events,
        policy: policyRecord,
        definition: artifact.definition as GraphDefinition,
        unsupported: artifact.unsupported ?? [],
        builtSummary: artifact.builtSummary ?? null,
        triggerEventSchema,
      });

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

      // Upsert version row: regenerate updates the same version artifact.
      const existingVer = await client.query(
        orgId === null
          ? `SELECT id FROM agent_versions
              WHERE agent_id = $1 AND org_id IS NULL AND version = $2
              LIMIT 1`
          : `SELECT id FROM agent_versions
              WHERE agent_id = $1 AND org_id = $2 AND version = $3
              LIMIT 1`,
        orgId === null
          ? [agentId, policyRow.version]
          : [agentId, orgId, policyRow.version],
      );

      let ver: QueryResultRow;
      if (existingVer.rows[0]) {
        const { rows: versionRows } = await client.query(
          `UPDATE agent_versions
              SET artifact_ref = $1,
                  artifact_source = $2,
                  checksum = $3,
                  status = 'generated',
                  generated_by = $4,
                  generated_at = now(),
                  policy_id = $5,
                  meta = $6::jsonb
            WHERE id = $7
            RETURNING id, generated_at, checksum, version`,
          [
            artifactRef,
            artifact.source,
            artifact.checksum,
            adminId,
            policyRow.id,
            JSON.stringify(generationMeta),
            existingVer.rows[0].id,
          ],
        );
        ver = versionRows[0];
      } else {
        const { rows: versionRows } = await client.query(
          `INSERT INTO agent_versions
             (agent_id, org_id, policy_id, version, artifact_ref, artifact_source,
              checksum, status, generated_by, meta)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'generated', $8, $9::jsonb)
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
            JSON.stringify(generationMeta),
          ],
        );
        ver = versionRows[0];
      }

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
        mode: artifact.mode,
        model: artifact.model ?? null,
        request: mode === "llm" ? userRequest : null,
        unsupported: artifact.unsupported ?? [],
        builtSummary: artifact.builtSummary ?? null,
        generationTrace: artifact.generationTrace ?? null,
        preview: false,
      });
    });
  });

  /**
   * Auto go-live — deterministic gate (6 checks), then compile → publish → activate.
   * No human approval. Any check fail → 422 with a plain "Can't go live yet" message.
   */
  app.post("/agents/:id/go-live", async (req: any, reply: any) => {
    const agentId = parseAgentId(req.params.id);
    if (!agentId) return invalidAgentId(reply);
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);
    const body = (req.body ?? {}) as { expectedVersion?: number };

    if (typeof app.inject !== "function") {
      return reply.code(500).send({
        error: "GO_LIVE_UNAVAILABLE",
        message: "Go-live requires the full API server.",
      });
    }

    const prep = await withOrgScope(pool, orgId, async (client) => {
      if (!(await canEditAgent(client, { adminId, agentId, orgId }))) {
        return { ok: false as const, status: 403, body: { error: "FORBIDDEN" } };
      }

      const tmpl = await templateForAgentId(client, agentId);
      if (!tmpl) {
        return {
          ok: false as const,
          status: 404,
          body: {
            error: "TEMPLATE_NOT_FOUND",
            message: "No active template for this agent.",
          },
        };
      }

      const latest = await latestPolicy(client, agentId, orgId);
      if (!latest) {
        return {
          ok: false as const,
          status: 404,
          body: {
            error: "NO_POLICY",
            message: "Save a workflow before making it live.",
          },
        };
      }
      if (
        body.expectedVersion !== undefined &&
        latest.version !== body.expectedVersion
      ) {
        return {
          ok: false as const,
          status: 409,
          body: {
            error: "STALE_POLICY",
            currentVersion: latest.version,
          },
        };
      }
      if (latest.status === "active") {
        return {
          ok: false as const,
          status: 409,
          body: {
            error: "ALREADY_LIVE",
            message: "This agent is already live.",
            status: latest.status,
          },
        };
      }
      if (
        latest.status !== "generated" &&
        latest.status !== "pending_go_live" &&
        latest.status !== "compiled" &&
        latest.status !== "published"
      ) {
        return {
          ok: false as const,
          status: 409,
          body: {
            error: "NOT_READY",
            message:
              "Accept & save a workflow first, then you can make it live.",
            status: latest.status,
          },
        };
      }

      const ver = await client.query(
        orgId === null
          ? `SELECT id, version, artifact_source, checksum, policy_id, meta, status
               FROM agent_versions
              WHERE agent_id = $1 AND org_id IS NULL AND version = $2
              LIMIT 1`
          : `SELECT id, version, artifact_source, checksum, policy_id, meta, status
               FROM agent_versions
              WHERE agent_id = $1 AND org_id = $2 AND version = $3
              LIMIT 1`,
        orgId === null
          ? [agentId, latest.version]
          : [agentId, orgId, latest.version],
      );
      const row = ver.rows[0] as
        | (GeneratedArtifactRow & { status: string })
        | undefined;
      if (!row?.artifact_source) {
        return {
          ok: false as const,
          status: 404,
          body: {
            error: "NO_ARTIFACT",
            message:
              "No saved workflow found. Create and Accept a workflow first.",
          },
        };
      }

      let oneActiveIndexPerGraphKey = false;
      try {
        const idx = await client.query(
          `SELECT indexdef FROM pg_indexes
            WHERE indexname = 'graph_definitions_one_active'
            LIMIT 1`,
        );
        oneActiveIndexPerGraphKey = oneActiveIndexIsPerGraphKey(
          idx.rows[0]?.indexdef as string | undefined,
        );
      } catch {
        oneActiveIndexPerGraphKey = false;
      }

      /**
       * EVIDENCE FOR THE TWO CHECKS THAT ASK ABOUT MORE THAN SHAPE.
       *
       * Checks 7 and 8 need the node registry and the trigger's payload
       * schema, and the gate is a pure function that cannot reach a database.
       * Gathered here and handed in.
       *
       * When either lookup fails the blob is left out, and the gate reports
       * "not checked" rather than passing. A check that goes quiet when it
       * cannot see is worse than no check, because it reads like a pass.
       */
      const gateEvidence = await collectGateEvidence(
        client,
        row.artifact_source,
        `${tmpl.agentKey}.authored`,
      );

      const gate = evaluateGoLiveGate({
        artifactSource: row.artifact_source,
        storedChecksum: row.checksum,
        expectedGraphKey: `${tmpl.agentKey}.authored`,
        gapAck: readGapAckFromMeta(row.meta),
        oneActiveIndexPerGraphKey,
        ...gateEvidence,
      });

      if (!gate.ok) {
        return {
          ok: false as const,
          status: 422,
          body: {
            error: "GO_LIVE_BLOCKED",
            message: gate.message,
            checks: gate.checks,
            blockedBy: gate.blockedBy,
          },
        };
      }

      return {
        ok: true as const,
        version: latest.version,
        artifactStatus: row.status,
        checks: gate.checks,
        agentKey: tmpl.agentKey,
      };
    });

    if (!prep.ok) {
      return reply.code(prep.status).send(prep.body);
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-admin-id": adminId,
    };
    if (orgId) headers["x-org-id"] = orgId;
    const payload = { expectedVersion: body.expectedVersion ?? prep.version };

    const steps =
      prep.artifactStatus === "published"
        ? (["activate"] as const)
        : prep.artifactStatus === "compiled"
          ? (["publish", "activate"] as const)
          : (["compile", "publish", "activate"] as const);

    // If policy is pending_go_live, move to generated so compile can advance status.
    if (steps[0] === "compile") {
      await withOrgScope(pool, orgId, async (client) => {
        if (orgId === null) {
          await client.query(
            `UPDATE agent_policies
                SET status = 'generated', updated_at = now()
              WHERE agent_id = $1
                AND version = $2
                AND status = 'pending_go_live'
                AND org_id IS NULL`,
            [agentId, prep.version],
          );
        } else {
          await client.query(
            `UPDATE agent_policies
                SET status = 'generated', updated_at = now()
              WHERE agent_id = $1
                AND version = $2
                AND status = 'pending_go_live'
                AND org_id = $3`,
            [agentId, prep.version, orgId],
          );
        }
      });
    }

    let lastJson: Record<string, unknown> = {};
    for (const step of steps) {
      const res = await app.inject!({
        method: "POST",
        url: `/agents/${agentId}/${step}`,
        headers,
        payload,
      });
      lastJson = res.json() as Record<string, unknown>;
      if (res.statusCode >= 400) {
        return reply.code(res.statusCode).send({
          error: "GO_LIVE_FAILED",
          failedStep: step,
          message:
            (typeof lastJson.message === "string" && lastJson.message) ||
            `Couldn't finish going live (${step}).`,
          details: lastJson,
          checks: prep.checks,
        });
      }
    }

    // Check 6 post-condition: exactly one active authored definition for this key.
    const graphKey = `${prep.agentKey}.authored`;
    const activeCount = await withOrgScope(pool, orgId, async (client) => {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM graph_definitions
          WHERE graph_key = $1
            AND status = 'active'
            AND org_id IS NOT DISTINCT FROM $2::text`,
        [graphKey, orgId],
      );
      return rows[0]?.n as number;
    });
    if (activeCount !== 1) {
      return reply.code(500).send({
        error: "ONE_ACTIVE_INTEGRITY",
        message: `Can't go live yet: expected exactly one live version for this agent, found ${activeCount}.`,
        checks: prep.checks,
      });
    }

    return reply.send({
      status: lastJson.status ?? "active",
      agentId,
      version: lastJson.version ?? prep.version,
      checksum: lastJson.checksum ?? null,
      graphKey,
      message: `This agent is now live (version ${lastJson.version ?? prep.version}).`,
      checks: prep.checks,
    });
  });

  /**
   * Business "Request to go live" — pending only. Does NOT compile/publish/activate.
   * Prefer POST /go-live (deterministic auto gate). Kept for backlog / manual review.
   */
  app.post("/agents/:id/request-go-live", async (req: any, reply: any) => {
    const agentId = parseAgentId(req.params.id);
    if (!agentId) return invalidAgentId(reply);
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);
    const body = (req.body ?? {}) as { expectedVersion?: number };

    return withOrgScope(pool, orgId, async (client) => {
      if (!(await canEditAgent(client, { adminId, agentId, orgId }))) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      const def = await agentExists(client, agentId);
      if (!def) {
        return reply.code(404).send({ error: "AGENT_NOT_FOUND" });
      }

      const latest = await latestPolicy(client, agentId, orgId);
      if (!latest) {
        return reply.code(404).send({
          error: "NO_POLICY",
          message: "Save a workflow before requesting to go live.",
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

      if (latest.status === "pending_go_live") {
        return reply.send({
          status: "pending_go_live",
          agentId,
          version: latest.version,
          message: "Already waiting for go-live review.",
          alreadyPending: true,
        });
      }

      if (latest.status === "active") {
        return reply.code(409).send({
          error: "ALREADY_LIVE",
          message: "This agent is already live.",
          status: latest.status,
        });
      }

      if (
        latest.status !== "generated" &&
        latest.status !== "compiled" &&
        latest.status !== "published"
      ) {
        return reply.code(409).send({
          error: "NOT_READY",
          message:
            "Save a workflow first, then you can request to go live.",
          status: latest.status,
        });
      }

      // Keep agent_versions at generated/compiled/published so Approve can still
      // find an artifact — only the policy status signals the pending request.
      await client.query(
        `UPDATE agent_policies
            SET status = 'pending_go_live',
                created_by = $1,
                updated_at = now()
          WHERE id = $2`,
        [adminId, latest.id],
      );

      return reply.send({
        status: "pending_go_live",
        agentId,
        version: latest.version,
        message:
          "Request sent. A technical reviewer will make it live after checking it is safe.",
        alreadyPending: false,
      });
    });
  });

  /** Withdraw a go-live request (back to generated — not live). */
  app.post("/agents/:id/cancel-go-live-request", async (req: any, reply: any) => {
    const agentId = parseAgentId(req.params.id);
    if (!agentId) return invalidAgentId(reply);
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);
    const body = (req.body ?? {}) as { expectedVersion?: number };

    return withOrgScope(pool, orgId, async (client) => {
      if (!(await canEditAgent(client, { adminId, agentId, orgId }))) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      const latest = await latestPolicy(client, agentId, orgId);
      if (!latest) {
        return reply.code(404).send({ error: "NO_POLICY" });
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
      if (latest.status !== "pending_go_live") {
        return reply.code(409).send({
          error: "NOT_PENDING",
          message: "No go-live request is waiting.",
          status: latest.status,
        });
      }

      await client.query(
        `UPDATE agent_policies
            SET status = 'generated',
                updated_at = now()
          WHERE id = $1`,
        [latest.id],
      );

      return reply.send({
        status: "generated",
        agentId,
        version: latest.version,
        message: "Go-live request withdrawn.",
      });
    });
  });

  /**
   * Technical review queue — workflows waiting to go live.
   * Nothing here has hit production yet.
   */
  app.get("/go-live-requests", async (req: any, reply: any) => {
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);

    return withOrgScope(pool, orgId, async (client) => {
      const scopePred =
        orgId === null ? "p.org_id IS NULL" : "(p.org_id = $1 OR p.org_id IS NULL)";
      const params = orgId === null ? [] : [orgId];

      const { rows } = await client.query(
        `
        SELECT
          d.id AS agent_id,
          COALESCE(t.display_name, d.name) AS name,
          d.purpose,
          p.version,
          p.status,
          p.updated_at,
          p.created_by AS requested_by,
          p.checksum
        FROM agent_policies p
        INNER JOIN agent_definitions d ON d.id = p.agent_id AND d.is_active = true
        LEFT JOIN LATERAL (
          SELECT display_name
            FROM agent_templates
           WHERE agent_id = d.id AND is_active = true
           ORDER BY version DESC
           LIMIT 1
        ) t ON true
        WHERE p.status = 'pending_go_live'
          AND (${scopePred})
          AND p.version = (
            SELECT MAX(p2.version)
              FROM agent_policies p2
             WHERE p2.agent_id = p.agent_id
               AND p2.org_id IS NOT DISTINCT FROM p.org_id
          )
        ORDER BY p.updated_at ASC
        `,
        params,
      );

      const editable = await editableAgentIds(
        client,
        adminId,
        orgId,
        rows.map((r: { agent_id: string }) => r.agent_id),
      );

      return reply.send({
        requests: rows
          .filter((r: { agent_id: string }) => editable.has(r.agent_id))
          .map((r: any) => ({
            agentId: r.agent_id,
            name: r.name,
            purpose: r.purpose,
            version: r.version,
            status: r.status,
            requestedAt: r.updated_at,
            requestedBy: r.requested_by,
            checksum: r.checksum,
          })),
      });
    });
  });

  /**
   * Technical Approve — runs compile → publish → activate under the hood.
   * Business admins never call this; reviewers do after checking the request.
   */
  app.post("/agents/:id/approve-go-live", async (req: any, reply: any) => {
    const agentId = parseAgentId(req.params.id);
    if (!agentId) return invalidAgentId(reply);
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);
    const body = (req.body ?? {}) as { expectedVersion?: number };

    if (typeof app.inject !== "function") {
      return reply.code(500).send({
        error: "APPROVE_UNAVAILABLE",
        message: "Approve requires the full API server.",
      });
    }

    const prep = await withOrgScope(pool, orgId, async (client) => {
      if (!(await canEditAgent(client, { adminId, agentId, orgId }))) {
        return { ok: false as const, status: 403, body: { error: "FORBIDDEN" } };
      }

      const latest = await latestPolicy(client, agentId, orgId);
      if (!latest) {
        return {
          ok: false as const,
          status: 404,
          body: { error: "NO_POLICY" },
        };
      }
      if (
        body.expectedVersion !== undefined &&
        latest.version !== body.expectedVersion
      ) {
        return {
          ok: false as const,
          status: 409,
          body: {
            error: "STALE_POLICY",
            currentVersion: latest.version,
          },
        };
      }
      if (latest.status !== "pending_go_live") {
        return {
          ok: false as const,
          status: 409,
          body: {
            error: "NOT_PENDING",
            message: `Nothing to approve (status is "${latest.status}").`,
            status: latest.status,
          },
        };
      }

      // agent_versions stays at generated/compiled/published so Stage 2–3
      // endpoints still find the artifact. Policy pending_go_live is overwritten
      // as compile → publish → activate advance status.
      const ver = await client.query(
        orgId === null
          ? `SELECT status FROM agent_versions
              WHERE agent_id = $1 AND org_id IS NULL AND version = $2
              LIMIT 1`
          : `SELECT status FROM agent_versions
              WHERE agent_id = $1 AND org_id = $2 AND version = $3
              LIMIT 1`,
        orgId === null
          ? [agentId, latest.version]
          : [agentId, orgId, latest.version],
      );
      const artifactStatus = (ver.rows[0]?.status as string | undefined) ?? "generated";

      return {
        ok: true as const,
        version: latest.version,
        artifactStatus,
      };
    });

    if (!prep.ok) {
      return reply.code(prep.status).send(prep.body);
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-admin-id": adminId,
    };
    if (orgId) headers["x-org-id"] = orgId;

    const payload = { expectedVersion: body.expectedVersion ?? prep.version };

    const steps =
      prep.artifactStatus === "published"
        ? (["activate"] as const)
        : prep.artifactStatus === "compiled"
          ? (["publish", "activate"] as const)
          : (["compile", "publish", "activate"] as const);

    let lastJson: Record<string, unknown> = {};
    for (const step of steps) {
      const res = await app.inject!({
        method: "POST",
        url: `/agents/${agentId}/${step}`,
        headers,
        payload,
      });
      lastJson = res.json() as Record<string, unknown>;
      if (res.statusCode >= 400) {
        return reply.code(res.statusCode).send({
          error: "APPROVE_FAILED",
          failedStep: step,
          message:
            (typeof lastJson.message === "string" && lastJson.message) ||
            (typeof lastJson.error === "string" && lastJson.error) ||
            `Could not finish go-live (${step}).`,
          details: lastJson,
        });
      }
    }

    return reply.send({
      status: lastJson.status ?? "active",
      agentId,
      version: lastJson.version ?? prep.version,
      checksum: lastJson.checksum ?? null,
      graphKey: lastJson.graphKey ?? null,
      message: `Approved — this agent is now live (version ${lastJson.version ?? prep.version}).`,
    });
  });

  app.post("/agents/:id/compile", async (req: any, reply: any) => {
    const agentId = parseAgentId(req.params.id);
    if (!agentId) return invalidAgentId(reply);
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

      // Full authored-graph gate (same as Generate): tools + schema + topology + config.
      let parsedGraph: GraphDefinition;
      try {
        parsedGraph = validateAuthoredGraphForGoLive(latest.artifact_source, {
          defaultGraphKey: `${validated.policy.agentKey}.authored`,
        });
      } catch (err: any) {
        const message = err?.message ?? String(err);
        return reply.code(422).send({
          error: "GRAPH_INVALID",
          message:
            message.replace(/^GENERATION_FAILED:\s*/i, "") ||
            "Graph failed validation; fix via Update workflow before Prepare.",
        });
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
    const agentId = parseAgentId(req.params.id);
    if (!agentId) return invalidAgentId(reply);
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
    const agentId = parseAgentId(req.params.id);
    if (!agentId) return invalidAgentId(reply);
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

      // Bind trigger event → this authored graph (DB-only ingress; no code fallback).
      const policyJson =
        typeof policyRow.policy === "string"
          ? JSON.parse(policyRow.policy)
          : (policyRow.policy as Record<string, unknown>);
      const triggerEventType = String(policyJson?.triggerEventType ?? "").trim();
      let bindingEvent: string | null = null;
      if (triggerEventType) {
        try {
          await upsertActiveEventBinding(client, {
            eventType: triggerEventType,
            orgId,
            graphKey,
            agentId,
            version: latest.version,
          });
          bindingEvent = triggerEventType;
        } catch (err: any) {
          if (err instanceof EventAlreadyBoundError || err?.code === "EVENT_ALREADY_BOUND") {
            return reply.code(409).send({
              error: "EVENT_ALREADY_BOUND",
              message: err.message,
              eventType: err.eventType ?? triggerEventType,
              existingAgentId: err.existingAgentId ?? null,
              existingGraphKey: err.existingGraphKey ?? null,
            });
          }
          throw err;
        }
      }

      return reply.send({
        status: "active",
        agentId,
        agentKey: tmpl.agentKey,
        policyExt: tmpl.template.policyExt,
        graphKey,
        version: latest.version,
        checksum: latest.checksum,
        graphId: activatedId,
        triggerEventType: bindingEvent,
      });
    });
  });

  /**
   * Stage 3 Rollback — reactivate a prior published version under the same authored graph_key.
   * Body: { targetVersion: number }
   * Never touches runtime *.workflow keys.
   */
  app.post("/agents/:id/rollback", async (req: any, reply: any) => {
    const agentId = parseAgentId(req.params.id);
    if (!agentId) return invalidAgentId(reply);
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

      const policyJson =
        typeof policyRow.policy === "string"
          ? JSON.parse(policyRow.policy)
          : (policyRow.policy as Record<string, unknown>);
      const triggerEventType = String(policyJson?.triggerEventType ?? "").trim();
      let bindingEvent: string | null = null;
      if (triggerEventType) {
        try {
          await upsertActiveEventBinding(client, {
            eventType: triggerEventType,
            orgId,
            graphKey,
            agentId,
            version: targetVersion,
          });
          bindingEvent = triggerEventType;
        } catch (err: any) {
          if (
            err instanceof EventAlreadyBoundError ||
            err?.code === "EVENT_ALREADY_BOUND"
          ) {
            return reply.code(409).send({
              error: "EVENT_ALREADY_BOUND",
              message: err.message,
              eventType: err.eventType ?? triggerEventType,
              existingAgentId: err.existingAgentId ?? null,
              existingGraphKey: err.existingGraphKey ?? null,
            });
          }
          throw err;
        }
      }

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
        triggerEventType: bindingEvent,
      });
    });
  });

  app.post("/agents/:id/take-offline", async (req: any, reply: any) => {
    const agentId = parseAgentId(req.params.id);
    if (!agentId) return invalidAgentId(reply);
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);
    const body = (req.body ?? {}) as { expectedVersion?: number };

    return withOrgScope(pool, orgId, async (client) => {
      if (!(await canEditAgent(client, { adminId, agentId, orgId }))) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      const tmpl = await templateForAgentId(client, agentId);
      if (!tmpl) {
        return reply.code(404).send({
          error: "TEMPLATE_NOT_FOUND",
          message: "No active template for this agent.",
        });
      }

      const latest = await latestPolicy(client, agentId, orgId);
      if (!latest) {
        return reply.code(404).send({
          error: "NO_POLICY",
          message: "No policy found for this agent.",
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

      const graphKey = `${tmpl.agentKey}.authored`;
      const scopeText = orgId;

      await client.query("BEGIN");
      try {
        await client.query(
          `UPDATE graph_event_bindings
              SET status = 'retired', updated_at = NOW()
            WHERE agent_id = $1 AND status = 'active'`,
          [agentId],
        );
        await client.query(
          `UPDATE graph_definitions
              SET status = 'retired'
            WHERE graph_key = $1
              AND status = 'active'
              AND org_id IS NOT DISTINCT FROM $2::text`,
          [graphKey, scopeText],
        );
        if (orgId === null) {
          await client.query(
            `UPDATE agent_policies
                SET status = 'published', updated_at = now()
              WHERE agent_id = $1
                AND status = 'active'
                AND org_id IS NULL`,
            [agentId],
          );
        } else {
          await client.query(
            `UPDATE agent_policies
                SET status = 'published', updated_at = now()
              WHERE agent_id = $1
                AND status = 'active'
                AND org_id = $2`,
            [agentId, orgId],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }

      return reply.send({
        status: "offline",
        agentId,
        version: latest.version,
        message:
          "Agent taken offline. New uploads will not use this workflow until you make it live again.",
      });
    });
  });

  app.delete("/agents/:id", async (req: any, reply: any) => {
    const agentId = parseAgentId(req.params.id);
    if (!agentId) return invalidAgentId(reply);
    if (!canDeleteAgentFromBuilder(agentId)) {
      return reply.code(403).send({
        error: "AGENT_DELETE_FORBIDDEN",
        message:
          "This agent cannot be deleted from Builder (core platform agent).",
      });
    }

    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);

    return withOrgScope(writePool, orgId, async (client) => {
      const def = await agentExists(client, agentId);
      if (!def || !def.is_active) {
        return reply.code(404).send({ error: "AGENT_NOT_FOUND" });
      }

      const canEdit = await canEditAgent(client, { adminId, agentId, orgId });
      if (!canEdit) {
        return reply.code(403).send({
          error: "FORBIDDEN",
          message: "You do not have permission to delete this agent.",
        });
      }

      await client.query("BEGIN");
      try {
        await client.query(
          `UPDATE graph_event_bindings
              SET status = 'retired', updated_at = NOW()
            WHERE agent_id = $1 AND status = 'active'`,
          [agentId],
        );
        await client.query(
          `UPDATE agent_definitions
              SET is_active = false, updated_at = NOW()
            WHERE id = $1`,
          [agentId],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }

      return reply.send({ status: "deleted", agentId });
    });
  });
}

/* ─────────────────────── evidence for the go-live gate ─────────────────── */

/**
 * What checks 7 and 8 need from the database.
 *
 * `entryInput` on an authored definition holds the trigger event type — the
 * chosen trigger travels inside the definition because a draft binding cannot
 * be stored, so this is where the trigger lives until go-live creates one.
 *
 * Returns `{}` on any failure. That is deliberate: the gate reports
 * "not checked" for evidence it did not receive, and blocking a release
 * because a catalogue query failed would be the wrong trade — the six
 * structural checks still run.
 */
async function collectGateEvidence(
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: any[] }> },
  artifactSource: string,
  graphKey: string,
): Promise<{
  inputs?: {
    triggerFields: readonly string[];
    requiredByImpl: Map<string, readonly string[]>;
  };
  ownership?: {
    graphModule: string;
    moduleByImpl: Map<string, string>;
    shareableImpls: Set<string>;
  };
}> {
  try {
    const def = JSON.parse(artifactSource) as {
      entryInput?: string;
      nodes?: Array<{ impl?: string }>;
    };
    const impls = [
      ...new Set((def.nodes ?? []).map((n) => String(n.impl ?? ""))),
    ].filter(Boolean);
    if (impls.length === 0) return {};

    const { rows } = await client.query(
      `SELECT key, module, shareable, input_schema
         FROM node_registry WHERE key = ANY($1::text[])`,
      [impls],
    );

    const requiredByImpl = new Map<string, readonly string[]>();
    const moduleByImpl = new Map<string, string>();
    const shareableImpls = new Set<string>();
    for (const r of rows) {
      const key = String(r.key);
      moduleByImpl.set(key, String(r.module));
      if (r.shareable === true) shareableImpls.add(key);
      const required = r.input_schema?.required;
      requiredByImpl.set(key, Array.isArray(required) ? required : []);
    }

    /**
     * `syntra.authored` → `syntra`. The same derivation the editor and the
     * materializer use; when the module registry is wired through to this
     * layer it should come from there instead of a prefix.
     */
    const graphModule = graphKey.split(".")[0] ?? "platform";

    let triggerFields: string[] = [];
    if (def.entryInput) {
      const ev = await client.query(
        `SELECT payload_schema FROM event_schemas WHERE event_type = $1 LIMIT 1`,
        [def.entryInput],
      );
      triggerFields = Object.keys(ev.rows[0]?.payload_schema?.properties ?? {});
    }

    return {
      // Without a trigger there is nothing to check availability against, and
      // claiming every field is missing would be noise, not a finding.
      ...(def.entryInput ? { inputs: { triggerFields, requiredByImpl } } : {}),
      ownership: { graphModule, moduleByImpl, shareableImpls },
    };
  } catch {
    return {};
  }
}
