import {
  formatZodFieldErrors,
  type PolicyFieldError,
} from "./agent-policy.js";
import type { AgentPolicyBaseType } from "./agent-policy-base.js";
import { policySchemaForExt } from "./policy-ext.js";
import { isRegisteredTool } from "./tool-registry.js";
import { isTriggerEventType } from "./trigger-events.js";

/** Composed policy: base + product-specific extension fields. */
export type AgentPolicy = AgentPolicyBaseType & Record<string, unknown>;

export type PolicyValidationResult =
  | { ok: true; policy: AgentPolicy }
  | { ok: false; fields: PolicyFieldError[] };

export type ValidatePolicyOptions = {
  /** Template `policyExt` name, e.g. SyntraPolicyExt (design §4.1 / A6). */
  policyExt: string;
};

/**
 * Validate against AgentPolicyBase.merge(policyExt) + optional allowedTools registry check.
 */
export function validateAgentPolicy(
  raw: unknown,
  opts: ValidatePolicyOptions,
): PolicyValidationResult {
  let schema;
  try {
    schema = policySchemaForExt(opts.policyExt);
  } catch (err: any) {
    return {
      ok: false,
      fields: [
        {
          path: "policyExt",
          message: err?.message ?? `Unknown policyExt "${opts.policyExt}"`,
        },
      ],
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fields: formatZodFieldErrors(parsed.error) };
  }

  const policy = parsed.data as AgentPolicy;
  const fields: PolicyFieldError[] = [];
  const tools = policy.allowedTools;
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (typeof tool !== "string" || !isRegisteredTool(tool)) {
        fields.push({
          path: "allowedTools",
          message: `tool "${String(tool)}" is not a registered tool`,
        });
      }
    }
  } else {
    fields.push({
      path: "allowedTools",
      message: "Select at least one registered tool",
    });
  }

  const trigger = policy.triggerEventType;
  if (typeof trigger !== "string" || !trigger.trim()) {
    fields.push({
      path: "triggerEventType",
      message: "Select a trigger event",
    });
  } else if (!isTriggerEventType(trigger)) {
    fields.push({
      path: "triggerEventType",
      message: `event "${trigger}" is not a selectable trigger event`,
    });
  }

  if (typeof policy.prompt !== "string" || !policy.prompt.trim()) {
    fields.push({
      path: "prompt",
      message: "System prompt is required",
    });
  }

  if (fields.length > 0) {
    return { ok: false, fields };
  }

  return { ok: true, policy };
}
