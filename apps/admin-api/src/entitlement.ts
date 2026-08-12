import type { DbQueryable } from "./with-org-scope.js";

export type EntitlementArgs = {
  adminId: string;
  agentId: string;
  orgId: string | null;
};

/**
 * Per-agent edit entitlement (design A3). Fail closed: no row → no edit.
 * Org-specific grant/deny overrides a global (org_id IS NULL) row.
 */
export async function canEditAgent(
  db: DbQueryable,
  args: EntitlementArgs,
): Promise<boolean> {
  const { rows } =
    args.orgId === null
      ? await db.query<{ org_id: string | null; can_edit: boolean }>(
          `SELECT org_id, can_edit
             FROM admin_agent_entitlements
            WHERE admin_id = $1
              AND agent_id = $2
              AND org_id IS NULL`,
          [args.adminId, args.agentId],
        )
      : await db.query<{ org_id: string | null; can_edit: boolean }>(
          `SELECT org_id, can_edit
             FROM admin_agent_entitlements
            WHERE admin_id = $1
              AND agent_id = $2
              AND (org_id IS NULL OR org_id = $3)`,
          [args.adminId, args.agentId, args.orgId],
        );

  if (rows.length === 0) return false;

  if (args.orgId !== null) {
    const scoped = rows.find((r) => r.org_id === args.orgId);
    if (scoped) return Boolean(scoped.can_edit);
  }

  const global = rows.find((r) => r.org_id == null);
  return global ? Boolean(global.can_edit) : false;
}

/** Batch for Agent List — set of agent ids the admin may edit. */
export async function editableAgentIds(
  db: DbQueryable,
  adminId: string,
  orgId: string | null,
  agentIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (agentIds.length === 0) return out;

  const { rows } =
    orgId === null
      ? await db.query<{ agent_id: string; org_id: string | null; can_edit: boolean }>(
          `SELECT agent_id, org_id, can_edit
             FROM admin_agent_entitlements
            WHERE admin_id = $1
              AND org_id IS NULL
              AND agent_id = ANY($2::uuid[])`,
          [adminId, agentIds],
        )
      : await db.query<{ agent_id: string; org_id: string | null; can_edit: boolean }>(
          `SELECT agent_id, org_id, can_edit
             FROM admin_agent_entitlements
            WHERE admin_id = $1
              AND (org_id IS NULL OR org_id = $2)
              AND agent_id = ANY($3::uuid[])`,
          [adminId, orgId, agentIds],
        );

  const byAgent = new Map<string, { org_id: string | null; can_edit: boolean }[]>();
  for (const r of rows) {
    const list = byAgent.get(r.agent_id) ?? [];
    list.push(r);
    byAgent.set(r.agent_id, list);
  }

  for (const [agentId, list] of byAgent) {
    if (orgId !== null) {
      const scoped = list.find((r) => r.org_id === orgId);
      if (scoped) {
        if (scoped.can_edit) out.add(agentId);
        continue;
      }
    }
    const global = list.find((r) => r.org_id == null);
    if (global?.can_edit) out.add(agentId);
  }

  return out;
}
