import type { BuilderOverviewAgent } from "../api";
import { friendlyAgentTitle } from "../lib/platform-narrative";

type PlatformPoliciesModalProps = {
  agents: BuilderOverviewAgent[];
  onClose: () => void;
};

function buildCombinedPolicyText(agents: BuilderOverviewAgent[]): string {
  if (agents.length === 0) return "";
  return agents
    .map((a) => {
      const title = friendlyAgentTitle(a.name);
      const body = a.policyText?.trim() || "(No policy written yet)";
      return `${title}\n${body}`;
    })
    .join("\n\n——————————\n\n");
}

export function PlatformPoliciesModal({
  agents,
  onClose,
}: PlatformPoliciesModalProps) {
  const combined = buildCombinedPolicyText(agents);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal-card modal-card--wide"
        role="dialog"
        aria-labelledby="platform-policies-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h3 id="platform-policies-title">Overall platform policy</h3>
          <button type="button" className="btn secondary btn--compact" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="muted modal-hint">
          All agents in one place. Edit each agent separately in the Builder.
        </p>
        {agents.length === 0 ? (
          <p className="muted platform-policies-empty">No agents yet.</p>
        ) : (
          <textarea
            className="platform-policy-combined"
            readOnly
            rows={18}
            value={combined}
            aria-label="Combined policy for all agents"
          />
        )}
      </div>
    </div>
  );
}
