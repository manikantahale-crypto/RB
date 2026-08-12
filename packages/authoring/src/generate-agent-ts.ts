import { createHash } from "node:crypto";
import type { AgentPolicy } from "./validate-policy.js";

export type GenerateResult = {
  source: string;
  checksum: string;
};

/**
 * @deprecated Interim agent.ts dump. Use generateGraphFromTemplate for A6.
 */
export function generateAgentTs(policy: AgentPolicy): GenerateResult {
  const tools = Array.isArray(policy.allowedTools)
    ? (policy.allowedTools as string[])
    : [];
  const toolsLiteral = tools.map((t) => `  ${JSON.stringify(t)},`).join("\n");
  const prompt = typeof policy.prompt === "string" ? policy.prompt : "";

  const source = `/**
 * AUTO-GENERATED — do not edit by hand.
 * Source: agent policy (Stage 1 Generate — legacy agent.ts).
 * Prefer graph JSON from generateGraphFromTemplate.
 */

export const agentId = ${JSON.stringify(policy.agentId)} as const;
export const agentKey = ${JSON.stringify(policy.agentKey)} as const;
export const systemPrompt = ${JSON.stringify(prompt)} as const;
export const allowedTools = [
${toolsLiteral}
] as const;
export const policy = ${JSON.stringify(policy, null, 2)} as const;
export default { agentId, agentKey, systemPrompt, allowedTools, policy };
`;

  const checksum = createHash("sha256").update(source).digest("hex");
  return { source, checksum };
}
