import {
  canDeleteAgentFromBuilder,
  isBuilderVisibleAgentId,
} from "@tekisho/authoring/src/mock-product-agents.js";

export { canDeleteAgentFromBuilder, isBuilderVisibleAgentId };

export function filterBuilderAgents<T extends { id: string }>(agents: T[]): T[] {
  return agents.filter((a) => isBuilderVisibleAgentId(a.id));
}
