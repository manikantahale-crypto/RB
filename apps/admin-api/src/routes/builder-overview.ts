import type { Pool } from "pg";
import {
  parseStoredGraphArtifact,
  summarizeGraphWorkflow,
  getToolCatalog,
  listTriggerEvents,
} from "@tekisho/authoring";
import { withOrgScope } from "../with-org-scope.js";

type FastifyLike = {
  get: (path: string, handler: any) => void;
};

function readOrgId(headers: Record<string, unknown>): string | null {
  const raw = headers["x-org-id"];
  if (raw === undefined || raw === null || raw === "" || raw === "~global~") {
    return null;
  }
  return String(raw);
}

/**
 * Single call for the Builder main page: all agents, policies, graphs, bindings.
 */
export function registerBuilderOverviewRoutes(app: FastifyLike, pool: Pool): void {
  app.get("/builder/overview", async (req: any, reply: any) => {
    const orgId = readOrgId(req.headers);

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
          d.name AS agent_key_name,
          d.purpose,
          t.display_name,
          t.agent_key,
          p.status AS policy_status,
          p.version AS policy_version,
          p.policy AS policy_json,
          v.version AS graph_version,
          v.artifact_source,
          v.status AS graph_artifact_status,
          v.checksum AS graph_checksum,
          geb.event_type AS binding_event,
          geb.graph_key AS binding_graph_key,
          geb.version AS binding_version,
          geb.module_queue AS binding_queue,
          geb.source AS binding_source
        FROM agent_definitions d
        LEFT JOIN LATERAL (
          SELECT display_name, agent_key
            FROM agent_templates
           WHERE agent_id = d.id AND is_active = true
           ORDER BY version DESC LIMIT 1
        ) t ON true
        LEFT JOIN LATERAL (
          SELECT status, version, policy
            FROM agent_policies
           WHERE agent_id = d.id AND (${scopePred})
           ORDER BY ${scopeOrder} LIMIT 1
        ) p ON true
        LEFT JOIN LATERAL (
          SELECT version, artifact_source, status, checksum
            FROM agent_versions
           WHERE agent_id = d.id AND (${scopePred})
           ORDER BY generated_at DESC NULLS LAST, version DESC
           LIMIT 1
        ) v ON true
        LEFT JOIN LATERAL (
          SELECT event_type, graph_key, version, module_queue, source
            FROM graph_event_bindings
           WHERE agent_id = d.id AND status = 'active'
           ORDER BY updated_at DESC LIMIT 1
        ) geb ON true
        WHERE d.is_active = true
        ORDER BY COALESCE(t.display_name, d.name)
        `,
        params,
      );

      const tools = getToolCatalog().map((t) => ({
        key: t.key,
        description: t.description,
        triggeredBy: t.triggeredBy,
        outputEvent: t.output.event,
        outputShape: t.output.shape,
      }));

      const triggerEvents = listTriggerEvents().map((e) => ({
        eventType: e.eventType,
        label: e.label,
        description: e.description,
        defaultGraphKey: e.defaultGraphKey,
      }));

      const agents = rows.map((r: Record<string, unknown>) => {
        const policyJson = r.policy_json as Record<string, unknown> | null;
        const policyText =
          typeof policyJson?.prompt === "string"
            ? policyJson.prompt
            : typeof r.purpose === "string"
              ? r.purpose
              : "";
        const triggerEventType =
          typeof policyJson?.triggerEventType === "string"
            ? policyJson.triggerEventType
            : null;

        const parsed = parseStoredGraphArtifact(
          typeof r.artifact_source === "string" ? r.artifact_source : null,
        );
        const summary = summarizeGraphWorkflow(parsed ?? undefined);

        return {
          id: String(r.id),
          name: String(r.display_name ?? r.agent_key_name ?? "Agent"),
          agentKey: String(r.agent_key ?? r.agent_key_name ?? ""),
          purpose: String(r.purpose ?? ""),
          policyStatus: r.policy_status ? String(r.policy_status) : null,
          policyVersion: r.policy_version as number | null,
          policyText,
          triggerEventType,
          graphVersion: r.graph_version as number | null,
          graphStatus: r.graph_artifact_status
            ? String(r.graph_artifact_status)
            : null,
          graphChecksum: r.graph_checksum ? String(r.graph_checksum) : null,
          graphKey: summary.graphKey || null,
          workflowSteps: summary.steps,
          workflowEmpty: summary.empty,
          definition: parsed ?? null,
          binding: r.binding_event
            ? {
                eventType: String(r.binding_event),
                graphKey: String(r.binding_graph_key),
                version: r.binding_version as number | null,
                moduleQueue: String(r.binding_queue ?? ""),
                source: String(r.binding_source ?? ""),
              }
            : null,
        };
      });

      return reply.send({
        orgId,
        agents,
        tools,
        triggerEvents,
      });
    });
  });
}
