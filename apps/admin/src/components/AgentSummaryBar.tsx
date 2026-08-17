import type { BuilderOverviewAgent } from "../api";
import { agentIngressStatus } from "../lib/agent-status";
import { canDeleteAgentFromBuilder } from "../lib/agent-filters";
import { friendlyAgentTitle } from "../lib/platform-narrative";
import { deleteAgent } from "../api";
import { useState } from "react";

type AgentSummaryBarProps = {
  agent: BuilderOverviewAgent;
  onDeleted: () => void;
};

export function AgentSummaryBar({ agent, onDeleted }: AgentSummaryBarProps) {
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const ingress = agentIngressStatus({
    policy: agent.policyStatus ? { status: agent.policyStatus } : null,
    activeVersion: agent.graphVersion,
    binding: agent.binding,
  });

  const deletable = canDeleteAgentFromBuilder(agent.id);

  async function onDelete() {
    if (
      !window.confirm(
        `Delete "${friendlyAgentTitle(agent.name)}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    const res = await deleteAgent(agent.id);
    setDeleteBusy(false);
    if (!res.ok) {
      setDeleteError(res.body.message ?? res.body.error ?? "Delete failed");
      return;
    }
    onDeleted();
  }

  return (
    <header className="agent-summary-bar">
      <div>
        <div className="agent-summary-bar-main">
          <h2>{friendlyAgentTitle(agent.name)}</h2>
          <span className={`badge ${ingress.badgeClass}`}>{ingress.label}</span>
        </div>
        {agent.purpose ? (
          <p className="agent-summary-purpose muted">{agent.purpose}</p>
        ) : null}
      </div>
      {deletable ? (
        <button
          type="button"
          className="btn danger btn--compact"
          disabled={deleteBusy}
          onClick={() => void onDelete()}
        >
          {deleteBusy ? "Deleting…" : "Delete"}
        </button>
      ) : null}
      {deleteError ? <div className="banner err">{deleteError}</div> : null}
    </header>
  );
}
