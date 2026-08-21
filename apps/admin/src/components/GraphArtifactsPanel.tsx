import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getAgentArtifacts,
  resumeRuntimeThread,
  type AgentArtifacts,
} from "../api";
import {
  friendlyEventLabel,
  friendlyFailureMessage,
  friendlyToolBlurb,
  friendlyToolFamily,
  friendlyToolTitle,
  friendlyUnsupportedGap,
  isAstraTool,
  isSyntraTool,
} from "../lib/friendly-labels";

function branchPlain(key: unknown): string {
  const k = String(key ?? "");
  if (k === "pass") return "Continue automatically";
  if (k === "human_review") return "Needs a person";
  if (k === "reject") return "Stopped / rejected";
  return k || "—";
}

function stepStatusPlain(status: unknown): string {
  const s = String(status ?? "").toUpperCase();
  if (s === "OK" || s.includes("COMPLET")) return "Done";
  if (s.includes("FAIL")) return "Failed";
  if (s.includes("RUN")) return "Running";
  if (s.includes("SKIP")) return "Skipped";
  return String(status ?? "—");
}

function failurePlain(error: unknown): string | null {
  return friendlyFailureMessage(error);
}

function activityLine(toolOrNode: string): string {
  const t = toolOrNode.toLowerCase();
  if (t.includes("resume")) return "Currently processing a resume / profile";
  if (t.includes("jd.process") || t.includes("jd "))
    return "Currently processing a job description";
  if (t.includes("quality")) return "Currently checking JD quality / completeness";
  if (t.includes("normalize")) return "Currently enriching and structuring the JD";
  if (t.includes("match")) return "Currently scoring matches against filters";
  if (t.includes("branch")) return "Currently deciding the next path by score";
  if (t.includes("human")) return "Waiting for a person to approve or reject";
  if (t.includes("route")) return "Currently routing to the next agent / stopping";
  if (t.includes("duplicate")) return "Currently checking for duplicate candidates";
  if (t.includes("intake") || t.includes("ingest") || t.includes("jobboard"))
    return "Currently receiving / ingesting a requirement";
  if (t.includes("notify") || t.includes("alert") || t.includes("shortlist"))
    return "Currently updating alerts / shortlist";
  return `Currently running: ${friendlyToolTitle(toolOrNode)}`;
}

type Props = {
  agentId: string;
  refreshKey?: number | string;
};

type RunRow = AgentArtifacts["runs"][number];
type VersionRow = AgentArtifacts["versions"][number];

function buildRunStory(run: RunRow): string {
  const input = run.inputEventType
    ? friendlyEventLabel(run.inputEventType)
    : "an incoming platform event";
  const outputs = (run.outputEventTypes ?? []).map(friendlyEventLabel);
  const stepNames = run.steps.map((s) =>
    friendlyToolTitle(String(s.tool ?? s.node)),
  );
  const fromWorkflow = (run.workflowSteps ?? []).map((s) =>
    friendlyToolTitle(s.impl),
  );
  const actions =
    stepNames.length > 0
      ? stepNames.join(" → ")
      : fromWorkflow.length > 0
        ? fromWorkflow.join(" → ")
        : "its saved workflow steps";

  const policyBit = run.policyText
    ? `Under the policy (“${run.policyText.slice(0, 140)}${
        run.policyText.length > 140 ? "…" : ""
      }”), `
    : "Following this agent’s saved policy, ";

  let ending: string;
  if (run.needsHuman) {
    ending =
      "The run paused for a person — Approve or Reject to continue.";
  } else if (failurePlain(run.error)) {
    ending = `It failed: ${failurePlain(run.error)}`;
  } else if (outputs.length > 0) {
    ending = `It finished and produced: ${outputs.join("; ")}.`;
  } else if (String(run.status).toUpperCase().includes("COMPLET")) {
    ending = "It finished successfully.";
  } else {
    ending = `Current status: ${run.statusLabel ?? run.status}.`;
  }

  return `${policyBit}when “${input}” arrived, the graph ran: ${actions}. ${ending}`;
}

/**
 * Tabular History with modal detail + live activity stream.
 */
export function GraphArtifactsPanel({ agentId, refreshKey }: Props) {
  const [data, setData] = useState<AgentArtifacts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await getAgentArtifacts(agentId);
    if (!res.ok) {
      setError(res.body.message ?? "Could not load history");
      setData(null);
      return;
    }
    setData(res.data);
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const activeRuns = useMemo(
    () =>
      (data?.runs ?? []).filter(
        (r) =>
          r.needsHuman ||
          String(r.status).toUpperCase().includes("RUN") ||
          String(r.status).toUpperCase().includes("QUEUE") ||
          String(r.status).toUpperCase().includes("WAIT"),
      ),
    [data],
  );

  const shouldPoll = activeRuns.length > 0;

  useEffect(() => {
    if (!shouldPoll) return;
    const t = window.setInterval(() => void load(), 3500);
    return () => window.clearInterval(t);
  }, [shouldPoll, load]);

  useEffect(() => {
    if (!selectedRunId && !selectedVersionId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedRunId(null);
        setSelectedVersionId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedRunId, selectedVersionId]);

  const selectedRun: RunRow | null =
    data?.runs.find((r) => r.id === selectedRunId) ?? null;
  const selectedVersion: VersionRow | null =
    data?.versions.find((v) => v.id === selectedVersionId) ?? null;

  const liveStreamLines = useMemo(() => {
    if (!data) return [] as string[];
    if (activeRuns.length === 0) {
      if (data.liveBinding || data.liveNow) {
        return [
          "Agent is live and idle — waiting for the next matching event.",
        ];
      }
      return [];
    }
    return activeRuns.slice(0, 3).map((r) => {
      const last = [...r.steps].reverse().find(Boolean);
      const tool = last ? String(last.tool ?? last.node) : "";
      if (r.needsHuman) {
        return "Paused — waiting for Approve / Reject from a person.";
      }
      if (tool) return activityLine(tool);
      return r.currentAction || "Working…";
    });
  }, [data, activeRuns]);

  async function resume(run: RunRow, approved: boolean) {
    if (!run.threadId || !run.graphKey || !run.organizationId) {
      setNote("This run cannot be resumed from here.");
      return;
    }
    setBusy(true);
    setNote(null);
    const res = await resumeRuntimeThread({
      thread_id: String(run.threadId),
      graph_key: String(run.graphKey),
      organization_id: String(run.organizationId),
      decision: { approved },
    });
    setBusy(false);
    if (!res.ok) {
      setNote(res.body.message ?? "Resume failed");
      return;
    }
    setNote(approved ? "Approved — run will continue" : "Rejected — run stopped");
    await load();
  }

  if (error) {
    return (
      <div className="agent-panel">
        <div className="agent-panel-head">
          <h3>History</h3>
        </div>
        <p className="muted">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="agent-panel">
        <div className="agent-panel-head">
          <h3>History</h3>
        </div>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const live = data.liveNow ?? data.liveBinding;
  const versionCount = data.versions.length;
  const runCount = data.runs.length;
  const failedRunCount = data.runs.filter((r) => Boolean(failurePlain(r.error))).length;

  return (
    <div className="agent-panel artifacts-panel artifacts-panel--table">
      <button
        type="button"
        className="artifacts-panel-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="artifacts-panel-toggle-main">
          <h3>History &amp; traceability</h3>
          <span className="artifacts-panel-summary muted">
            {versionCount} graph version{versionCount === 1 ? "" : "s"}
            {runCount > 0
              ? ` · ${runCount} run${runCount === 1 ? "" : "s"}`
              : ""}
            {failedRunCount > 0 ? ` · ${failedRunCount} failed` : ""}
            {live ? " · Live" : ""}
          </span>
        </span>
        <span className="artifacts-panel-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded ? (
        <>
          <div className="artifacts-panel-actions">
            <button
              type="button"
              className="btn secondary btn--compact"
              onClick={() => void load()}
            >
              Refresh
            </button>
          </div>

      <div
        className={`artifacts-live-status${
          live ? " artifacts-live-status--on" : ""
        }${shouldPoll ? " artifacts-live-status--busy" : ""}`}
      >
        {live ? (
          <>
            <span className="live-dot" aria-hidden="true" />
            <div className="artifacts-live-body">
              <strong>
                {shouldPoll ? "Live · working now" : "Live · idle"}
              </strong>
              <p>
                Starts when{" "}
                <strong>
                  {friendlyEventLabel(
                    "eventType" in live
                      ? live.eventType
                      : data.liveBinding!.eventType,
                  )}
                </strong>
                {" · "}
                version {live.version}
              </p>
              {liveStreamLines.length > 0 ? (
                <ul className="artifacts-stream">
                  {liveStreamLines.map((line, i) => (
                    <li key={`${i}-${line}`}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </>
        ) : (
          <p className="muted">
            Not live — generate a workflow, then Make it live.
          </p>
        )}
      </div>

      {note ? <p className="artifacts-note">{note}</p> : null}

      <h4 className="artifacts-subhead">Graph versions</h4>
      {data.versions.length === 0 ? (
        <p className="muted">No graphs generated yet.</p>
      ) : (
        <div className="artifacts-table-wrap">
          <table className="data-table artifacts-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Starts when</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.versions.map((v) => (
                <tr key={v.id}>
                  <td>v{v.version}</td>
                  <td>
                    <span
                      className={`artifact-pill${v.isLive ? " live" : ""}`}
                    >
                      {v.isLive ? "Live" : v.label}
                    </span>
                  </td>
                  <td>
                    {v.triggerEventType
                      ? friendlyEventLabel(v.triggerEventType)
                      : "—"}
                  </td>
                  <td className="muted">
                    {v.generatedAt
                      ? new Date(v.generatedAt).toLocaleString()
                      : "—"}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn secondary btn--compact"
                      onClick={() => {
                        setSelectedVersionId(v.id);
                        setSelectedRunId(null);
                      }}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 className="artifacts-subhead">Runs</h4>
      {data.runs.length === 0 ? (
        <p className="muted">
          No runs yet. After go-live, Syntra actions that hit this agent appear
          here.
        </p>
      ) : (
        <div className="artifacts-table-wrap">
          <table className="data-table artifacts-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Doing now</th>
                <th>Input</th>
                <th>Output</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => {
                const failed = Boolean(failurePlain(run.error));
                return (
                  <tr key={run.id} className={failed ? "row-fail" : undefined}>
                    <td className="muted">
                      {run.createdAt
                        ? new Date(String(run.createdAt)).toLocaleString()
                        : "—"}
                    </td>
                    <td>
                      {failed
                        ? "Failed"
                        : run.statusLabel ?? run.status}
                    </td>
                    <td>
                      {failed
                        ? failurePlain(run.error)?.slice(0, 120)
                        : run.currentAction ?? "—"}
                    </td>
                    <td>
                      {run.inputEventType
                        ? friendlyEventLabel(run.inputEventType)
                        : "—"}
                    </td>
                    <td>
                      {(run.outputEventTypes ?? []).length > 0
                        ? (run.outputEventTypes ?? [])
                            .map((t) => friendlyEventLabel(t))
                            .slice(0, 2)
                            .join(", ")
                        : "—"}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn secondary btn--compact"
                        onClick={() => {
                          setSelectedRunId(run.id);
                          setSelectedVersionId(null);
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedVersion ? (
        <DetailModal
          title={`Graph version ${selectedVersion.version}${
            selectedVersion.isLive ? " · Live" : ` · ${selectedVersion.label}`
          }`}
          onClose={() => setSelectedVersionId(null)}
        >
          <VersionDetailBody version={selectedVersion} />
        </DetailModal>
      ) : null}

      {selectedRun ? (
        <DetailModal
          title={`Run detail${
            selectedRun.graphVersion != null
              ? ` · graph v${selectedRun.graphVersion}`
              : ""
          }`}
          onClose={() => setSelectedRunId(null)}
        >
          <RunDetailBody
            run={selectedRun}
            busy={busy}
            onResume={(approved) => void resume(selectedRun, approved)}
          />
        </DetailModal>
      ) : null}
        </>
      ) : null}
    </div>
  );
}

function DetailModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card modal-card--wide artifacts-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button
            type="button"
            className="btn secondary btn--compact"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="artifacts-modal-body">{children}</div>
      </div>
    </div>
  );
}

function VersionDetailBody({ version }: { version: VersionRow }) {
  const story = version.triggerEventType
    ? `This version starts when “${friendlyEventLabel(
        version.triggerEventType,
      )}”. The workflow below is what the orchestrator will run after Make live.`
    : "Set a trigger in Policy before going live so the orchestrator knows when to start.";

  const steps = version.workflowSteps ?? [];
  const astraTools = steps.filter((s) => isAstraTool(s.impl));
  const syntraTools = steps.filter((s) => isSyntraTool(s.impl));
  const unsupported = version.unsupported ?? [];

  return (
    <>
      <p className="artifacts-story">{story}</p>

      {steps.length > 0 ? (
        <section className="artifacts-detail-block">
          <h5>Tools in this workflow</h5>
          <div className="artifacts-tool-summary">
            {astraTools.length > 0 ? (
              <p>
                <span className="artifact-tool-family artifact-tool-family--astra">
                  ASTRA
                </span>{" "}
                {astraTools.length} step{astraTools.length === 1 ? "" : "s"} — job
                intake, fetch, normalize
              </p>
            ) : null}
            {syntraTools.length > 0 ? (
              <p>
                <span className="artifact-tool-family artifact-tool-family--syntra">
                  SYNTRA
                </span>{" "}
                {syntraTools.length} step{syntraTools.length === 1 ? "" : "s"} — matching,
                shortlist, profiles
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {unsupported.length > 0 ? (
        <section className="artifacts-fail-box artifacts-gap-box" role="status">
          <h5>Could not add from your policy</h5>
          <ul className="artifacts-gap-list">
            {unsupported.map((gap) => (
              <li key={gap}>{friendlyUnsupportedGap(gap)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="artifacts-detail-block">
        <h5>Policy written for this graph</h5>
        {version.policyText ? (
          <pre className="artifacts-policy">{version.policyText}</pre>
        ) : (
          <p className="muted">No policy text stored for this version.</p>
        )}
      </section>

      <section className="artifacts-detail-block">
        <h5>Workflow steps created</h5>
        {steps.length === 0 ? (
          <p className="muted">No steps stored.</p>
        ) : (
          <ol className="artifacts-workflow-list artifacts-workflow-list--detailed">
            {steps.map((s) => (
              <li key={`${s.order}-${s.impl}`}>
                <span
                  className={`artifact-tool-family artifact-tool-family--${friendlyToolFamily(s.impl).toLowerCase()}`}
                >
                  {friendlyToolFamily(s.impl)}
                </span>
                <strong>{friendlyToolTitle(s.impl)}</strong>
                {s.description ? (
                  <span className="muted"> — {s.description}</span>
                ) : friendlyToolBlurb(s.impl) ? (
                  <span className="muted"> — {friendlyToolBlurb(s.impl)}</span>
                ) : null}
                {s.config && Object.keys(s.config).length > 0 ? (
                  <span className="artifacts-step-config muted">
                    {" "}
                    (settings:{" "}
                    {Object.entries(s.config)
                      .map(([k, v]) => `${k}=${String(v)}`)
                      .join(", ")}
                    )
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function RunDetailBody({
  run,
  busy,
  onResume,
}: {
  run: RunRow;
  busy: boolean;
  onResume: (approved: boolean) => void;
}) {
  const fail = failurePlain(run.error);
  const story = buildRunStory(run);

  return (
    <>
      <p className="artifacts-story">{story}</p>

      <div className="artifacts-detail-grid">
        <section className="artifacts-detail-block">
          <h5>Status</h5>
          <p>
            <strong>{fail ? "Failed" : run.statusLabel ?? run.status}</strong>
          </p>
          <p className="muted">{run.currentAction}</p>
        </section>
        <section className="artifacts-detail-block">
          <h5>Input event</h5>
          <p>
            {run.inputEventType
              ? friendlyEventLabel(run.inputEventType)
              : "Unknown"}
          </p>
          <p className="muted">What started this run</p>
        </section>
        <section className="artifacts-detail-block">
          <h5>Output events</h5>
          {(run.outputEventTypes ?? []).length === 0 ? (
            <p className="muted">None yet</p>
          ) : (
            <ul>
              {(run.outputEventTypes ?? []).map((t) => (
                <li key={t}>{friendlyEventLabel(t)}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {fail ? (
        <section className="artifacts-fail-box" role="alert">
          <h5>Why this run failed</h5>
          <p>{fail}</p>
        </section>
      ) : null}

      {run.needsHuman ? (
        <div className="artifact-human-actions">
          <p className="muted" style={{ flex: 1, margin: 0 }}>
            Waiting for a person before the next step.
          </p>
          <button
            type="button"
            className="btn btn--compact"
            disabled={busy}
            onClick={() => onResume(true)}
          >
            Approve
          </button>
          <button
            type="button"
            className="btn secondary btn--compact"
            disabled={busy}
            onClick={() => onResume(false)}
          >
            Reject
          </button>
        </div>
      ) : null}

      <section className="artifacts-detail-block">
        <h5>Policy used</h5>
        {run.policyText ? (
          <pre className="artifacts-policy">{run.policyText}</pre>
        ) : (
          <p className="muted">
            Policy text was not stored against this run’s graph version.
          </p>
        )}
      </section>

      <section className="artifacts-detail-block">
        <h5>Workflow nodes on this graph</h5>
        {(run.workflowSteps ?? []).length === 0 ? (
          <p className="muted">Workflow steps not found for this run.</p>
        ) : (
          <ol className="artifacts-workflow-list artifacts-workflow-list--detailed">
            {(run.workflowSteps ?? []).map((s) => (
              <li key={`${s.order}-${s.impl}`}>
                <span
                  className={`artifact-tool-family artifact-tool-family--${friendlyToolFamily(s.impl).toLowerCase()}`}
                >
                  {friendlyToolFamily(s.impl)}
                </span>
                <strong>{friendlyToolTitle(s.impl)}</strong>
                {friendlyToolBlurb(s.impl) ? (
                  <span className="muted"> — {friendlyToolBlurb(s.impl)}</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="artifacts-detail-block">
        <h5>What happened step by step</h5>
        {run.steps.length === 0 ? (
          <p className="muted">No step outputs yet.</p>
        ) : (
          <div className="artifacts-table-wrap">
            <table className="data-table artifacts-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Step</th>
                  <th>Result</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {run.steps.map((s) => (
                  <tr key={`${run.id}-${s.seq}`}>
                    <td>{String(s.seq)}</td>
                    <td>{friendlyToolTitle(String(s.tool ?? s.node))}</td>
                    <td>{stepStatusPlain(s.status)}</td>
                    <td>
                      {s.branchKey != null ? branchPlain(s.branchKey) : "—"}
                      {s.confidence != null
                        ? ` · score ${String(s.confidence)}`
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
