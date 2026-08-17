import { friendlyEventLabel } from "./platform-narrative";

export type IngressStatus = {
  label: string;
  detail?: string;
  badgeClass: string;
};

/**
 * Plain-language status for sidebar and agent cards.
 * "Live" = uploads/events actually run this workflow; "Not connected" = saved as live but missing trigger link.
 */
export function agentIngressStatus(
  agent: {
    policy?: { status?: string } | null;
    activeVersion?: number | null;
    binding?: { eventType: string } | null;
  },
): IngressStatus {
  const policyStatus = agent.policy?.status;
  const hasBinding = Boolean(agent.binding?.eventType);

  if (hasBinding) {
    const b = agent.binding!;
    return {
      label: "Live",
      detail: `${friendlyEventLabel(b.eventType)} — this agent runs when that happens`,
      badgeClass: "active",
    };
  }

  if (policyStatus === "active" || agent.activeVersion != null) {
    return {
      label: "Not connected",
      detail:
        "You saved this as live, but uploads still won't use it until Make live connects a trigger",
      badgeClass: "published",
    };
  }

  switch (policyStatus) {
    case "draft":
      return { label: "Draft", badgeClass: "" };
    case "generated":
    case "compiled":
    case "published":
    case "pending_go_live":
      return {
        label: "Ready to go live",
        detail: "Workflow is saved — use Make live when you're ready",
        badgeClass: "generated",
      };
    default:
      return { label: policyStatus ?? "New", badgeClass: "" };
  }
}

/** Short line under Make live when the banner alone is not enough. */
export function policyEditorIngressLabel(
  policyStatus: string | null,
  binding: { eventType: string; graphKey: string; version?: number | null } | null,
): string {
  if (binding) {
    return "";
  }
  if (policyStatus === "active") {
    return "Run Make live again and pick the trigger (e.g. when a resume arrives) to connect this agent to uploads.";
  }
  return "";
}
