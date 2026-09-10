import type { Pool } from 'pg';
import type { EventInput } from '../types.js';
import type { SyntraGraphState } from '../nodes/types.js';

export type ActionClass =
  | 'READ'
  | 'INTERNAL_WRITE'
  | 'DATA_SHAPING'
  | 'CONTROL'
  | 'EXTERNAL_COMM';

export type AutonomyLevel = 'AUTO' | 'APPROVE' | 'SUGGEST';
export type PolicyDecisionKind = 'auto' | 'require_approval' | 'suggest_only';

export type AgentPolicy = {
  id: string;
  name: string;
  version: string;
  autonomy: Record<ActionClass, AutonomyLevel>;
  allowedTools: Array<{ name: string; min_version?: string }>;
  modelConfig: Record<string, unknown>;
};

export type PolicyDecision = {
  kind: PolicyDecisionKind;
  agent: AgentPolicy;
  actionClass: ActionClass;
  level: AutonomyLevel;
};

export const DEFAULT_IMPL_ACTION_CLASS: Record<string, ActionClass> = {
  'syntra.jd.process': 'INTERNAL_WRITE',
  'syntra.resume.process': 'INTERNAL_WRITE',
  'syntra.match.process': 'INTERNAL_WRITE',
  'syntra.continuous.match': 'INTERNAL_WRITE',
  'syntra.duplicate.detect': 'INTERNAL_WRITE',
  'syntra.bench.alert': 'INTERNAL_WRITE',
  'syntra.shortlist.notify': 'EXTERNAL_COMM',
  'syntra.duplicate.merge': 'INTERNAL_WRITE',
  'syntra.run.retry': 'CONTROL',
  'astra.requirement.intake': 'EXTERNAL_COMM',
  'astra.requirement.ingest': 'INTERNAL_WRITE',
  'astra.jobboard.fetch': 'EXTERNAL_COMM',
  'astra.requirement.quality': 'DATA_SHAPING',
  'astra.requirement.normalize': 'INTERNAL_WRITE',
  'astra.route.decision': 'CONTROL',
  'orbit.lifecycle.transition': 'INTERNAL_WRITE',
  'orbit.placement.confirm': 'INTERNAL_WRITE',
  'orbit.revenue.arrange': 'INTERNAL_WRITE',
  'orbit.activity.note': 'INTERNAL_WRITE',
  'orbit.route.decision': 'CONTROL',
  'orch.branch.decision': 'CONTROL',
  'human.gate': 'CONTROL',
};

const ACTION_CLASSES: ActionClass[] = [
  'READ',
  'INTERNAL_WRITE',
  'DATA_SHAPING',
  'CONTROL',
  'EXTERNAL_COMM',
];

function asAutonomy(raw: unknown): Record<ActionClass, AutonomyLevel> {
  const obj = (raw ?? {}) as Record<string, string>;
  const out = {} as Record<ActionClass, AutonomyLevel>;
  for (const k of ACTION_CLASSES) {
    const v = obj[k];
    out[k] = v === 'APPROVE' || v === 'SUGGEST' || v === 'AUTO' ? v : 'AUTO';
  }
  return out;
}

function decisionKind(level: AutonomyLevel): PolicyDecisionKind {
  if (level === 'APPROVE') return 'require_approval';
  if (level === 'SUGGEST') return 'suggest_only';
  return 'auto';
}

/**
 * Loads `agent_definitions` and evaluates autonomy for a side-effect class.
 * Not event→workflow routing (that is SimpleRunbookResolver).
 */
export class PolicyEngine {
  private cache = new Map<string, AgentPolicy>();

  constructor(private pool: Pool) {}

  async getActiveAgent(name: string): Promise<AgentPolicy | null> {
    const hit = this.cache.get(name);
    if (hit) return hit;

    try {
      const { rows } = await this.pool.query(
        `SELECT id, name, version, autonomy, allowed_tools, model_config
         FROM builder.agent_definitions
         WHERE name = $1 AND is_active = true
         LIMIT 1`,
        [name],
      );
      const row = rows[0];
      if (!row) return null;

      const policy: AgentPolicy = {
        id: String(row.id),
        name: String(row.name),
        version: String(row.version),
        autonomy: asAutonomy(row.autonomy),
        allowedTools: Array.isArray(row.allowed_tools) ? row.allowed_tools : [],
        modelConfig:
          row.model_config && typeof row.model_config === 'object'
            ? (row.model_config as Record<string, unknown>)
            : {},
      };
      this.cache.set(name, policy);
      return policy;
    } catch (err) {
      // Missing GRANT / RLS must not kill Syntra HTTP nodes (fail-open AUTO).
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[PolicyEngine] cannot read agent_definitions for "${name}" (${msg}) — allowing AUTO`,
      );
      return null;
    }
  }

  async evaluate(
    agentName: string | undefined,
    actionClass: ActionClass,
  ): Promise<PolicyDecision | null> {
    if (!agentName) return null;
    const agent = await this.getActiveAgent(agentName);
    if (!agent) {
      console.warn(
        `[PolicyEngine] no active agent_definitions for "${agentName}" — allowing AUTO`,
      );
      return null;
    }
    const level = agent.autonomy[actionClass] ?? 'AUTO';
    return {
      kind: decisionKind(level),
      agent,
      actionClass,
      level,
    };
  }

  clearCache(): void {
    this.cache.clear();
  }
}

/** AUTO → proceed; APPROVE/SUGGEST → emit approval event and skip node body. */
export function applyPolicyGate(args: {
  decision: PolicyDecision | null;
  state: SyntraGraphState;
  nodeId: string;
  impl: string;
}): { proceed: true } | { proceed: false; patch: Partial<SyntraGraphState> } {
  const { decision, state, nodeId, impl } = args;
  if (!decision || decision.kind === 'auto') return { proceed: true };

  const trigger = state.trigger_event;
  const approvalEvent: EventInput = {
    event_id: crypto.randomUUID(),
    event_type: 'syntra.approval.requested',
    aggregate_id: trigger?.aggregate_id ?? crypto.randomUUID(),
    aggregate_type: trigger?.aggregate_type ?? 'approval',
    organization_id: trigger?.organization_id ?? '',
    correlation_id:
      trigger?.correlation_id ?? trigger?.event_id ?? crypto.randomUUID(),
    payload: {
      reason: decision.kind,
      agent_name: decision.agent.name,
      agent_definition_id: decision.agent.id,
      action_class: decision.actionClass,
      autonomy_level: decision.level,
      gated_node_id: nodeId,
      gated_impl: impl,
      source_event_id: trigger?.event_id ?? null,
    },
  };

  console.log(
    `[PolicyGate] ${decision.kind} — ${impl} under ${decision.agent.name} (${decision.actionClass}=${decision.level})`,
  );

  return {
    proceed: false,
    patch: {
      result: `policy:${decision.kind}:${nodeId}`,
      _emittedEvents: [approvalEvent],
    },
  };
}
