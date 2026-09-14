import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  getToolCatalog,
  listTriggerEvents,
  loadEventSchemaDetail,
} from "@tekisho/authoring";
import { withOrgScope } from "../with-org-scope.js";

import { EVENT_SCHEMAS } from "../lib/authoring-views.js";
import { authorableSourcesSql } from "../lib/authorable-steps.js";
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

    /**
     * THE CATALOGUE IS THE LIST. The hardcoded eighteen are defaults on top.
     *
     * This used to offer `listTriggerEvents()` and only that — eighteen events,
     * while `event_schemas` holds forty-five. An event somebody registered
     * themselves never appeared, so the only way to trigger a workflow on it
     * was to know its name and type it somewhere else.
     *
     * Now every registered event is offered. The hardcoded entry still supplies
     * the label and the deliberately chosen `moduleQueue`
     * (`module.design.resume` is not derivable from `syntra.resume.received`),
     * and an event without one gets its own name as the label and no queue —
     * which `upsertActiveEventBinding` then derives at bind time.
     */
    const known = new Map(listTriggerEvents().map((t) => [t.eventType, t]));
    return withOrgScope(pool, readOrgId(req.headers), async (client) => {
      const { rows } = await client.query<{
        event_type: string;
        description: string | null;
      }>(
        `SELECT event_type, description
           FROM ${EVENT_SCHEMAS}
          WHERE schema_version = '1.0'
          ORDER BY event_type`,
      );

      const fromCatalogue = rows.map((r) => {
        const hardcoded = known.get(r.event_type);
        return {
          eventType: r.event_type,
          label: hardcoded?.label ?? r.event_type,
          description: r.description ?? hardcoded?.description ?? null,
          moduleQueue: hardcoded?.moduleQueue ?? null,
          defaultGraphKey: hardcoded?.defaultGraphKey ?? null,
        };
      });

      /**
       * A hardcoded trigger the catalogue has no row for is still offered.
       * Dropping it would silently remove something that works today, which is
       * a worse failure than listing one event twice — and it cannot be twice,
       * because these are the ones the loop above did not find.
       */
      const seen = new Set(fromCatalogue.map((e) => e.eventType));
      const orphans = [...known.values()]
        .filter((t) => !seen.has(t.eventType))
        .map((t) => ({
          eventType: t.eventType,
          label: t.label,
          description: t.description,
          moduleQueue: t.moduleQueue,
          defaultGraphKey: t.defaultGraphKey,
        }));

      return reply.send({ events: [...fromCatalogue, ...orphans] });
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
                   FROM builder.agent_definitions d
                   LEFT JOIN LATERAL (
                     SELECT policy FROM builder.agent_policies
                      WHERE agent_id = d.id AND org_id IS NULL
                      ORDER BY version DESC LIMIT 1
                   ) p ON true
                   LEFT JOIN LATERAL (
                     SELECT template FROM builder.agent_templates
                      WHERE agent_id = d.id AND is_active = true
                      ORDER BY version DESC LIMIT 1
                   ) t ON true
                  WHERE d.id = $1::uuid`
              : `SELECT d.purpose, p.policy, t.template
                   FROM builder.agent_definitions d
                   LEFT JOIN LATERAL (
                     SELECT policy FROM builder.agent_policies
                      WHERE agent_id = d.id AND (org_id = $2 OR org_id IS NULL)
                      ORDER BY (org_id IS NOT NULL) DESC, version DESC LIMIT 1
                   ) p ON true
                   LEFT JOIN LATERAL (
                     SELECT template FROM builder.agent_templates
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
             FROM builder.agent_templates
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
        `INSERT INTO builder.agent_definitions (
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
        `INSERT INTO builder.agent_templates (
           id, agent_key, agent_id, display_name, version, template, is_active
         ) VALUES (
           gen_random_uuid(), $1, $2::uuid, $3, 1, $4::jsonb, true
         )`,
        [agentKey, agentId, name, JSON.stringify(nextTemplate)],
      );

      await client.query(
        `INSERT INTO builder.admin_agent_entitlements (admin_id, agent_id, org_id, can_edit)
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
        `INSERT INTO builder.agent_policies (
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
  /**
   * Which applications a workflow can actually be authored for.
   *
   * THE LIST WAS HARDCODED, AND THEN IT WAS WRONG.
   *
   * Screen 2 carried `["syntra", "astra", "orbit"]` in a const. When ASTRA's
   * data was removed from this project the dropdown kept offering it, and
   * choosing it produced a proposal with two generated steps, no trigger and
   * no candidates — a workflow nothing could ever start, with Accept still
   * enabled. The node contracts are in git and materialise into the registry,
   * so ASTRA had steps; its events had gone.
   *
   * That is the failure mode of every hardcoded list in this codebase, and it
   * is the third time it has bitten: a constant that was true when it was
   * written and has no way to notice it stopped being.
   *
   * So: from `platform.applications`, with what each one actually has. An
   * application with no startable event cannot have a workflow authored for
   * it, and the screen needs to be able to say so rather than let somebody
   * build one and find out at go-live.
   *
   * `terminal` events do not count as startable. They are acknowledged and
   * dropped before any binding is read, so a workflow triggered on one can
   * never run — see the same rule in the trigger candidate filter.
   */
  app.get("/applications", async (req: any, reply: any) => {
    try {
      /**
       * NO STATUS FILTER, DELIBERATELY.
       *
       * The column holds `available`, `beta` and `planned`, and the first
       * attempt here filtered on `active` — a value that does not exist — so
       * the endpoint returned an empty list and the dropdown would have had
       * nothing in it at all. Swapping one guess about the vocabulary for
       * another is not the fix.
       *
       * `authorable` is measured instead: an application is authorable when it
       * has steps to use and an event that can start them. A `planned`
       * application has neither, so it falls out without anybody having to
       * encode what `planned` means.
       */
      const { rows } = await pool.query(
        `SELECT a.key,
                a.name,
                a.status,
                /*
                 * Steps this application may actually BUILD WITH — which is
                 * not the same as steps it owns, and not every row either.
                 *
                 * Two corrections to counting rows blindly.
                 *
                 * Undeclared steps are excluded. Such a row is one the engine
                 * resolves but nobody described, and it hands work downstream
                 * by mutating the trigger payload, which a declared step does
                 * not read. A workflow built from one finishes green having
                 * done nothing, so the generator is not offered them — and an
                 * application must not look authorable on their strength.
                 *
                 * Other applications' shareable steps are included, and
                 * platform's. Every ORBIT step is legacy, so counting only its
                 * own would have made ORBIT unauthorable — wrong in the other
                 * direction: it has nine events and may build on the two
                 * platform steps and seven shareable SYNTRA ones, which is the
                 * cross-application borrowing the proposer already supports.
                 */
                (SELECT count(*) FROM authoring.node_registry n
                  WHERE n.source IN (${authorableSourcesSql()})
                    AND (n.application = a.key
                         OR n.application = 'platform'
                         OR n.shareable))::int AS nodes,
                (SELECT count(*) FROM authoring.event_catalog e
                  WHERE e.application = a.key
                    AND coalesce(e.handling, 'graph') <> 'terminal')::int AS triggers
           FROM platform.applications a
          ORDER BY a.key`,
      );

      return {
        applications: rows.map((r: any) => ({
          key: String(r.key),
          name: String(r.name ?? r.key),
          status: String(r.status ?? ""),
          nodes: Number(r.nodes),
          triggers: Number(r.triggers),
          /**
           * Both halves are needed. Steps with no event is a workflow that
           * cannot start; an event with no steps is a workflow with nothing
           * to do.
           *
           * `nodes` counts steps this application may USE, its own and the
           * borrowable ones — see the query. ASTRA fails on `triggers`: six
           * steps in git, no events left in this project.
           */
          authorable: Number(r.nodes) > 0 && Number(r.triggers) > 0,
        })),
      };
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "applications_failed", message: String(err) });
    }
  });
}
