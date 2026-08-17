/** Placeholder product agents (ASTRA, ORBIT, …) — hidden from Builder UI. */
export const MOCK_PRODUCT_AGENT_IDS: readonly string[] = [
  "01900000-0000-7000-8000-000000000504",
  "01900000-0000-7000-8000-000000000505",
  "01900000-0000-7000-8000-000000000506",
  "01900000-0000-7000-8000-000000000507",
  "01900000-0000-7000-8000-000000000508",
  "01900000-0000-7000-8000-000000000509",
] as const;

/** Core shipped agents — cannot delete from Builder. */
export const PROTECTED_PRODUCT_AGENT_IDS: readonly string[] = [
  "01900000-0000-7000-8000-000000000501", // SYNTRA
  "01900000-0000-7000-8000-000000000502", // Intake
  "01900000-0000-7000-8000-000000000503", // Copilot
] as const;

const mockSet = new Set<string>(MOCK_PRODUCT_AGENT_IDS);
const protectedSet = new Set<string>(PROTECTED_PRODUCT_AGENT_IDS);

export function isMockProductAgentId(agentId: string): boolean {
  return mockSet.has(agentId);
}

export function isProtectedProductAgentId(agentId: string): boolean {
  return protectedSet.has(agentId);
}

export function isBuilderVisibleAgentId(agentId: string): boolean {
  return !isMockProductAgentId(agentId);
}

export function canDeleteAgentFromBuilder(agentId: string): boolean {
  return !isProtectedProductAgentId(agentId) && !isMockProductAgentId(agentId);
}
