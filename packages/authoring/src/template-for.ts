import type { Pool, PoolClient } from "pg";
import {
  AgentTemplateSchema,
  type AgentTemplate,
} from "./agent-template.js";
import { TEMPLATE_SEED_CATALOG } from "./template-catalog.js";

export type LoadedTemplate = {
  id: string;
  agentKey: string;
  agentId: string | null;
  displayName: string;
  version: number;
  template: AgentTemplate;
};

type Db = Pool | PoolClient;

/**
 * Load the active agent template for an agentKey (design `templateFor(agentKey)`).
 */
export async function templateFor(
  db: Db,
  agentKey: string,
): Promise<LoadedTemplate | null> {
  const { rows } = await db.query(
    `SELECT id, agent_key, agent_id, display_name, version, template
       FROM builder.agent_templates
      WHERE agent_key = $1 AND is_active = true
      ORDER BY version DESC
      LIMIT 1`,
    [agentKey],
  );
  const row = rows[0];
  if (!row) return null;

  const parsed = AgentTemplateSchema.safeParse(row.template);
  if (!parsed.success) {
    throw new Error(
      `TEMPLATE_INVALID: agent_templates.agent_key=${agentKey}: ${parsed.error.message}`,
    );
  }

  return {
    id: row.id,
    agentKey: row.agent_key,
    agentId: row.agent_id,
    displayName: row.display_name,
    version: row.version,
    template: parsed.data,
  };
}

export async function templateForAgentId(
  db: Db,
  agentId: string,
): Promise<LoadedTemplate | null> {
  const { rows } = await db.query(
    `SELECT id, agent_key, agent_id, display_name, version, template
       FROM builder.agent_templates
      WHERE agent_id = $1 AND is_active = true
      ORDER BY version DESC
      LIMIT 1`,
    [agentId],
  );
  const row = rows[0];
  if (!row) {
    // Fallback: match catalog agentId → key, then load by key (or in-memory).
    const seed = TEMPLATE_SEED_CATALOG.find((s) => s.agentId === agentId);
    if (!seed) return null;
    return templateFor(db, seed.agentKey);
  }

  const parsed = AgentTemplateSchema.safeParse(row.template);
  if (!parsed.success) {
    throw new Error(
      `TEMPLATE_INVALID: agent_templates.agent_id=${agentId}: ${parsed.error.message}`,
    );
  }

  return {
    id: row.id,
    agentKey: row.agent_key,
    agentId: row.agent_id,
    displayName: row.display_name,
    version: row.version,
    template: parsed.data,
  };
}

export async function listActiveTemplates(db: Db): Promise<LoadedTemplate[]> {
  const { rows } = await db.query(
    `SELECT id, agent_key, agent_id, display_name, version, template
       FROM builder.agent_templates
      WHERE is_active = true
      ORDER BY agent_key`,
  );

  const out: LoadedTemplate[] = [];
  for (const row of rows) {
    const parsed = AgentTemplateSchema.safeParse(row.template);
    if (!parsed.success) continue;
    out.push({
      id: row.id,
      agentKey: row.agent_key,
      agentId: row.agent_id,
      displayName: row.display_name,
      version: row.version,
      template: parsed.data,
    });
  }
  return out;
}
