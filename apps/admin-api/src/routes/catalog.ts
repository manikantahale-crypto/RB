import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  getToolCatalog,
  listTriggerEvents,
  loadEventSchemaDetail,
} from "@tekisho/authoring";
import { withOrgScope } from "../with-org-scope.js";

type FastifyLike = {
  get: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
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

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return s || "agent";
}

/**
 * Catalog + Create Agent (Admin Authoring Layer Understanding v2).
 */
export function registerCatalogAndCreateRoutes(
  app: FastifyLike,
  pool: Pool,
  privilegedPool?: Pool,
): void {
  app.get("/catalog/tools", async (_req: any, reply: any) => {
    return reply.send({
      tools: getToolCatalog().map((t) => ({
        key: t.key,
        description: t.description,
        input: t.input,
        output: t.output,
        triggeredBy: t.triggeredBy,
      })),
    });
  });

  app.get("/catalog/events", async (req: any, reply: any) => {
    const kind = String(req.query?.kind ?? "trigger");
    if (kind !== "trigger") {
      return reply.code(400).send({
        error: "UNSUPPORTED_KIND",
        message: 'Only kind=trigger is supported in v1',
      });
    }

    // Prefer DB event_schemas descriptions when present; always bound to trigger catalog.
    const triggers = listTriggerEvents();
    return withOrgScope(pool, readOrgId(req.headers), async (client) => {
      const types = triggers.map((t) => t.eventType);
      const { rows } = await client.query<{
        event_type: string;
        description: string | null;
      }>(
        `SELECT event_type, description
           FROM event_schemas
          WHERE event_type = ANY($1::text[])
            AND schema_version = '1.0'`,
        [types],
      );
      const byType = new Map(rows.map((r) => [r.event_type, r.description]));

      return reply.send({
        events: triggers.map((t) => ({
          eventType: t.eventType,
          label: t.label,
          description: byType.get(t.eventType) ?? t.description,
          moduleQueue: t.moduleQueue,
          defaultGraphKey: t.defaultGraphKey,
        })),
      });
    });
  });

  app.get("/catalog/events/:eventType/schema", async (req: any, reply: any) => {
    const eventType = String(req.params.eventType ?? "").trim();
    if (!eventType) {
      return reply.code(400).send({
        error: "EVENT_TYPE_REQUIRED",
        message: "Provide an event_type path segment.",
      });
    }

    const schemaVersion = String(req.query?.version ?? "1.0");

    return withOrgScope(pool, readOrgId(req.headers), async (client) => {
      const detail = await loadEventSchemaDetail(
        client,
        eventType,
        schemaVersion,
      );
      if (!detail) {
        return reply.code(404).send({
          error: "SCHEMA_NOT_FOUND",
          message: `No active schema for ${eventType}@${schemaVersion}`,
        });
      }
      return reply.send({
        eventType: detail.eventType,
        schemaVersion: detail.schemaVersion,
        description: detail.description,
        payloadSchema: detail.payloadSchema,
        envelopeFields: detail.envelopeFields,
        producedWhen: detail.producedWhen,
        primaryConsumer: detail.primaryConsumer,
      });
    });
  });

  /**
   * Create a brand-new agent (new agent_id, version 1 draft).
   * Body: { name, purpose?, baseTemplateKey? } — clones Syntra template shape by default.
   */
  app.post("/agents", async (req: any, reply: any) => {
    const orgId = readOrgId(req.headers);
    const adminId = readAdminId(req.headers);
    const body = (req.body ?? {}) as {
      name?: string;
      purpose?: string;
      baseTemplateKey?: string;
      /** Clone policy + template wiring from an existing agent (customization flow). */
      cloneFromAgentId?: string;
    };

    const name = String(body.name ?? "").trim();
    if (!name) {
      return reply.code(400).send({
        error: "NAME_REQUIRED",
        message: "Provide a name for the new agent.",
      });
    }

    const baseKey = String(body.baseTemplateKey ?? "syntra").trim() || "syntra";
    const cloneId = String(body.cloneFromAgentId ?? "").trim();
    const createPool = privilegedPool ?? pool;

    return withOrgScope(createPool, orgId, async (client) => {
      let clonePolicy: Record<string, unknown> | null = null;
      let cloneTemplate: Record<string, unknown> | null = null;
      let clonePurpose: string | null = null;

      if (cloneId) {
        const cloneRow = (
          await client.query<{
            purpose: string;
            policy: unknown;
            template: unknown;
          }>(
            orgId === null
              ? `SELECT d.purpose, p.policy, t.template
                   FROM agent_definitions d
                   LEFT JOIN LATERAL (
                     SELECT policy FROM agent_policies
                      WHERE agent_id = d.id AND org_id IS NULL
                      ORDER BY version DESC LIMIT 1
                   ) p ON true
                   LEFT JOIN LATERAL (
                     SELECT template FROM agent_templates
                      WHERE agent_id = d.id AND is_active = true
                      ORDER BY version DESC LIMIT 1
                   ) t ON true
                  WHERE d.id = $1::uuid`
              : `SELECT d.purpose, p.policy, t.template
                   FROM agent_definitions d
                   LEFT JOIN LATERAL (
                     SELECT policy FROM agent_policies
                      WHERE agent_id = d.id AND (org_id = $2 OR org_id IS NULL)
                      ORDER BY (org_id IS NOT NULL) DESC, version DESC LIMIT 1
                   ) p ON true
                   LEFT JOIN LATERAL (
                     SELECT template FROM agent_templates
                      WHERE agent_id = d.id AND is_active = true
                      ORDER BY version DESC LIMIT 1
                   ) t ON true
                  WHERE d.id = $1::uuid`,
            orgId === null ? [cloneId] : [cloneId, orgId],
          )
        ).rows[0];
        if (!cloneRow) {
          return reply.code(404).send({
            error: "CLONE_SOURCE_NOT_FOUND",
            message: "Could not find the agent to clone from.",
          });
        }
        clonePurpose = cloneRow.purpose;
        clonePolicy =
          typeof cloneRow.policy === "object" && cloneRow.policy !== null
            ? (cloneRow.policy as Record<string, unknown>)
            : null;
        cloneTemplate =
          typeof cloneRow.template === "object" && cloneRow.template !== null
            ? (cloneRow.template as Record<string, unknown>)
            : null;
      }

      const purpose =
        String(body.purpose ?? "").trim() ||
        clonePurpose ||
        `Custom agent: ${name}`;

      const baseTmpl = (
        await client.query<{
          template: unknown;
          policy_ext: string | null;
        }>(
          `SELECT template
             FROM agent_templates
            WHERE agent_key = $1 AND is_active = true
            ORDER BY version DESC
            LIMIT 1`,
          [baseKey],
        )
      ).rows[0];

      if (!baseTmpl) {
        return reply.code(404).send({
          error: "BASE_TEMPLATE_NOT_FOUND",
          message: `No active template for key "${baseKey}"`,
        });
      }

      const agentId = randomUUID();
      const agentKey = `custom.${slugify(name)}.${agentId.slice(0, 8)}`;
      const tmplObj = cloneTemplate
        ? { ...cloneTemplate }
        : typeof baseTmpl.template === "string"
          ? JSON.parse(baseTmpl.template)
          : (baseTmpl.template as Record<string, unknown>);

      const policyExt =
        typeof tmplObj.policyExt === "string"
          ? tmplObj.policyExt
          : "SyntraPolicyExt";

      await client.query(
        `INSERT INTO agent_definitions (
           id, name, version, purpose, system_prompt_ref,
           allowed_tools, autonomy, model_config, is_active
         ) VALUES (
           $1::uuid, $2, '1.0.0', $3, $4,
           $5::jsonb, $6::jsonb, $7::jsonb, true
         )`,
        [
          agentId,
          agentKey,
          purpose,
          `prompts/${agentKey}@1.0.0`,
          JSON.stringify([{ name: "syntra.jd.process", min_version: "1.0.0" }]),
          JSON.stringify({
            READ: "AUTO",
            INTERNAL_WRITE: "AUTO",
            DATA_SHAPING: "AUTO",
            CONTROL: "AUTO",
            EXTERNAL_COMM: "SUGGEST",
          }),
          JSON.stringify({
            provider: "openrouter",
            model: "auto",
            temperature: 0,
          }),
        ],
      );

      const nextTemplate = {
        ...tmplObj,
        agentKey,
        displayName: name,
        policyExt,
      };

      await client.query(
        `INSERT INTO agent_templates (
           id, agent_key, agent_id, display_name, version, template, is_active
         ) VALUES (
           gen_random_uuid(), $1, $2::uuid, $3, 1, $4::jsonb, true
         )`,
        [agentKey, agentId, name, JSON.stringify(nextTemplate)],
      );

      await client.query(
        `INSERT INTO admin_agent_entitlements (admin_id, agent_id, org_id, can_edit)
         VALUES ($1, $2::uuid, $3::uuid, true)`,
        [adminId, agentId, orgId],
      );

      // Blank draft policy v1 with Builder defaults
      const defaultPolicy: Record<string, unknown> = clonePolicy
        ? {
            ...clonePolicy,
            agentId,
            agentKey,
            prompt:
              typeof clonePolicy.prompt === "string"
                ? clonePolicy.prompt
                : `Custom copy of existing agent policy for ${name}.`,
          }
        : {
            agentId,
            agentKey,
            prompt: `You are ${name}. Follow the selected tools and policy settings.`,
            allowedTools: ["syntra.jd.process"],
            triggerEventType: "syntra.jd.received",
            retry: { max: 3, fallback: "human_review" },
            escalation: "none",
            guardrails: { piiRedact: false },
          };
      if (!clonePolicy) {
        if (policyExt === "SyntraPolicyExt") {
          defaultPolicy.matchThreshold = 60;
          defaultPolicy.hardFilters = [];
          defaultPolicy.rerank = true;
        } else if (policyExt === "IntakePolicyExt") {
          defaultPolicy.autoClassify = true;
          defaultPolicy.allowedTools = ["syntra.resume.process"];
          defaultPolicy.triggerEventType = "syntra.resume.received";
        }
      }

      await client.query(
        `INSERT INTO agent_policies (
           id, org_id, agent_id, policy, status, version, created_by
         ) VALUES (
           gen_random_uuid(), $1::uuid, $2::uuid, $3::jsonb, 'draft', 1, $4
         )`,
        [orgId, agentId, JSON.stringify(defaultPolicy), adminId],
      );

      return reply.code(201).send({
        id: agentId,
        name,
        agentKey,
        purpose,
        policyExt,
        status: "draft",
        version: 1,
      });
    });
  });
}
