import { z } from "zod";

/**
 * Field-error helpers (shared). Prefer AgentPolicyBase + policyExt via
 * `policySchemaForExt` / `validateAgentPolicy({ policyExt })`.
 */

export type PolicyFieldError = { path: string; message: string };

export function formatZodFieldErrors(err: z.ZodError): PolicyFieldError[] {
  return err.issues.map((i) => ({
    path: i.path.join(".") || "(root)",
    message: i.message,
  }));
}

/** @deprecated Use AgentPolicyBase + policyExt. Kept for transitional imports. */
export { AgentPolicyBase as AgentPolicySchema } from "./agent-policy-base.js";
export type { AgentPolicy } from "./validate-policy.js";
