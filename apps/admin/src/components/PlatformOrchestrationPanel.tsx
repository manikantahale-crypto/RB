import { useMemo } from "react";
import type { BuilderOverview, BuilderOverviewAgent } from "../api";
import { GraphDiagram } from "./GraphDiagram";
import {
  buildFlowChain,
  buildAdminPlatformNarrative,
  friendlyAgentTitle,
  friendlyEventLabel,
} from "../lib/platform-narrative";
import { agentIngressStatus } from "../lib/agent-status";

type PlatformOrchestrationPanelProps = {
  overview: BuilderOverview | null;
  loading: boolean;
  error: string | null;
  selectedId?: string;
  onSelectAgent: (id: string) => void;
};

function cardIngress(agent: BuilderOverviewAgent) {
  return agentIngressStatus({
    policy: agent.policyStatus ? { status: agent.policyStatus } : null,
    activeVersion: agent.graphVersion,
    binding: agent.binding
      ? {
          eventType: agent.binding.eventType,
          graphKey: agent.binding.graphKey,
          version: agent.binding.version,
        }
      : null,
  });
}

export function PlatformOrchestrationPanel({
  overview,
  loading,
  error,
  selectedId,
  onSelectAgent,
}: PlatformOrchestrationPanelProps) {
  const flowChain = useMemo(
    () => buildFlowChain(overview?.agents ?? []),
    [overview?.agents],
  );

  const platformNarrative = useMemo(
    () => buildAdminPlatformNarrative(overview?.agents ?? []),
    [overview?.agents],
  );

  if (loading) {
    return (
      <section className="platform-panel">
        <div className="loading platform-loading">Loading your agents…</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="platform-panel">
        <div className="banner err">{error}</div>
        <p className="muted">
          If this keeps happening, ask your engineer to start the admin service.
        </p>
      </section>
    );
  }

  if (!overview) return null;

  return (
    <section className="platform-panel">
      <header className="platform-head">
        <div>
          <h2>Your hiring agents</h2>
          <p className="muted">
            Each agent has its own policy and workflow. Select one below to edit,
            or create a new agent from an existing one.
          </p>
        </div>
      </header>

      <div className="platform-narrative-field">
        <div className="platform-narrative-head">
          <h3 className="platform-subhead">Overall platform policy</h3>
          <p className="muted platform-narrative-desc">
            Read-only summary of every agent. Select an agent below to edit its
            Policy box.
          </p>
        </div>
        <div className="platform-narrative-scroll" tabIndex={0}>
          <pre className="platform-narrative-text">{platformNarrative}</pre>
        </div>
      </div>

      <div className="platform-flow-chain">
        <h3 className="platform-subhead">What runs when events arrive</h3>
        <ol className="flow-chain-list">
          {flowChain.map((step, i) => (
            <li
              key={i}
              className={`flow-chain-item${step.live ? " live" : ""}${step.conflict ? " conflict" : ""}`}
            >
              <span className="flow-chain-event">
                {step.event === "real platform events"
                  ? "Platform events"
                  : friendlyEventLabel(step.event)}
              </span>
              <span className="flow-chain-to">→ {step.toAgent}</span>
              {step.live ? <span className="badge active">Live</span> : null}
              {step.conflict ? (
                <span className="flow-chain-warn">{step.conflict}</span>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="muted flow-chain-note">
          Only one agent can be active per trigger (e.g. one agent for &quot;resume
          arrived&quot;). Change the trigger event in policy settings if you see a
          conflict when making live.
        </p>
      </div>

      <div className="platform-agent-grid">
        <h3 className="platform-subhead">All agents</h3>
        <div className="platform-agent-cards">
          {overview.agents.map((a) => (
            <AgentOverviewCard
              key={a.id}
              agent={a}
              selected={a.id === selectedId}
              onSelect={() => onSelectAgent(a.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function AgentOverviewCard({
  agent,
  selected,
  onSelect,
}: {
  agent: BuilderOverviewAgent;
  selected: boolean;
  onSelect: () => void;
}) {
  const ingress = cardIngress(agent);

  return (
    <article
      className={`platform-agent-card${selected ? " selected" : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
    >
      <header className="platform-agent-card-head">
        <h4>{friendlyAgentTitle(agent.name)}</h4>
        <span className={`badge ${ingress.badgeClass}`} title={ingress.detail ?? undefined}>
          {ingress.label}
        </span>
      </header>
      <p className="platform-agent-policy">
        {agent.policyText || <em className="muted">No description yet</em>}
      </p>
      {agent.triggerEventType ? (
        <p className="platform-agent-binding muted">
          Starts: {friendlyEventLabel(agent.triggerEventType)}
        </p>
      ) : null}
      <GraphDiagram
        definition={agent.definition}
        version={agent.graphVersion}
        compact
      />
      <button
        type="button"
        className="btn secondary btn--compact platform-edit-btn"
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        Edit this agent
      </button>
    </article>
  );
}
