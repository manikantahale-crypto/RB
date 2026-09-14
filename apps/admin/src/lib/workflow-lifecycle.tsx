/**
 * The lifecycle of one workflow: the single next step, and a button for it.
 *
 * It lived on the registry row for a while. That was wrong twice over — a list
 * whose job is finding things had four controls per row, and "put this live"
 * sat one careless click from "fire this for real" on a screen nobody had the
 * flow open on. It belongs next to the thing it changes.
 *
 * A workflow moves working copy -> compiled -> requested -> live, and at any
 * moment exactly one of those transitions is available. Offering one button
 * rather than four with three disabled means the control says what will happen
 * and cannot be pressed in the wrong order.
 */

import type { WorkflowRegistryRow } from "../api";
import {
  approveGoLive,
  cancelGoLiveRequest,
  compileDraft,
  requestGoLive,
  takeOffline,
} from "../api/editor";
/**
 * Any of the lifecycle calls. They differ in what they return on success and
 * agree on the only two things this screen uses: whether it worked, and the
 * sentence to show either way.
 */
export type LifecycleCall = (graphKey: string) => Promise<
  | { ok: true; data: { note?: string } }
  | { ok: false; status: number; body: { message?: string; error?: string } }
>;

type NextStep = {
  label: string;
  title: string;
  kind: "normal" | "primary" | "quiet";
  run: LifecycleCall;
  /** Shown under the button, so the state is legible without pressing it. */
  because: string;
} | null;

function nextStep(row: WorkflowRegistryRow): NextStep {
  const { hasWorkingCopy, compiledVersion, pendingVersion } = row.lifecycle;

  if (pendingVersion != null) {
    return {
      label: `Approve v${pendingVersion}`,
      title:
        `Put v${pendingVersion} on the air and create its binding. Somebody ` +
        `other than the person who asked has to do this.`,
      kind: "primary",
      run: approveGoLive,
      because: `v${pendingVersion} is waiting for approval`,
    };
  }
  if (compiledVersion != null) {
    return {
      label: `Request v${compiledVersion}`,
      title:
        `Send v${compiledVersion} for approval. Nothing runs differently ` +
        `until somebody approves it.`,
      kind: "normal",
      run: requestGoLive,
      because: `v${compiledVersion} is compiled and not yet requested`,
    };
  }
  if (hasWorkingCopy) {
    return {
      label: "Compile draft",
      title:
        "Take a numbered copy of the working copy. The draft is left alone, " +
        "so editing can carry on.",
      kind: "normal",
      run: compileDraft,
      because: "there are edits that have not been compiled",
    };
  }
  if (row.activeVersion != null) {
    return {
      label: "Take offline",
      title:
        "Retire the binding. The versions are untouched, and the workflow " +
        "can be bound again later.",
      kind: "quiet",
      run: takeOffline,
      because: "live, with nothing waiting",
    };
  }
  return null;
}

/**
 * The next lifecycle step for one workflow, with the reason underneath.
 *
 * "Withdraw" sits beside Approve rather than replacing it, because a request
 * that cannot be taken back is a request people hesitate to make.
 */
export function LifecycleCell({
  row,
  busy,
  onAct,
}: {
  row: WorkflowRegistryRow;
  busy: boolean;
  onAct: (graphKey: string, run: LifecycleCall) => void;
}) {
  const step = nextStep(row);
  if (!step) {
    return (
      <div className="wf-lifecycle">
        <span className="wf-muted">nothing to do</span>
      </div>
    );
  }
  return (
    <div className="wf-lifecycle">
      <button
        type="button"
        className={`wf-btn wf-btn--${step.kind}`}
        title={step.title}
        disabled={busy}
        onClick={() => onAct(row.graphKey, step.run)}
      >
        {busy ? "Working…" : step.label}
      </button>
      {row.lifecycle.pendingVersion != null ? (
        <button
          type="button"
          className="wf-btn wf-btn--quiet"
          title="Withdraw the request. The version is kept and can be requested again."
          disabled={busy}
          onClick={() => onAct(row.graphKey, cancelGoLiveRequest)}
        >
          Withdraw
        </button>
      ) : null}
      <span className="wf-lifecycle-why">{step.because}</span>
    </div>
  );
}

