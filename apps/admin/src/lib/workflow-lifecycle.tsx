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
import { useIsAdmin } from "./me.js";
import {
  approveGoLive,
  cancelGoLiveRequest,
  requestGoLive,
  sendForApprovalRequest,
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
  /**
   * Which transition this is, so a screen can decline to offer one.
   *
   * The editor does not offer `send`: editing and sending for approval are
   * different jobs, and the way through is the test page — you look at what it
   * does before you ask somebody to put it live.
   */
  id: "send" | "approve" | "offline";
  label: string;
  title: string;
  kind: "normal" | "primary" | "quiet";
  run: LifecycleCall;
  /** Shown under the button, so the state is legible without pressing it. */
  because: string;
} | null;

/**
 * Compile and request, as one act.
 *
 * THEY WERE TWO BUTTONS AND THERE WAS NEVER A REASON TO PRESS THE FIRST ALONE.
 *
 * Compiling takes a frozen numbered copy of the working draft, and freezing is
 * genuinely load-bearing: runs are pinned to a version, so v4 must mean one
 * thing for ever; the approver has to be looking at something that cannot
 * change under them; and rollback needs old versions to still exist.
 *
 * None of that is the author's problem. A compiled-and-unrequested version can
 * not be run, browsed to, or branched from — `startDraft` copies the ACTIVE
 * version — so the only thing the screen could offer next was "Request it".
 * Two presses for one intention, the first of which exposed a mechanism.
 *
 * The guarantees are untouched: the snapshot is still taken, still numbered,
 * still immutable while somebody reviews it.
 *
 * If the request half fails, the compiled version stands and the next step
 * becomes "Request v4" — which is exactly where the two-button version left
 * you, so nothing is lost and nothing is compiled twice.
 */
export const sendForApproval =
  (note?: string): LifecycleCall =>
  (graphKey) =>
    sendForApprovalRequest(graphKey, note);

function nextStep(row: WorkflowRegistryRow): NextStep {
  const { hasWorkingCopy, compiledVersion, pendingVersion } = row.lifecycle;

  if (pendingVersion != null) {
    return {
      id: "approve",
      label: `Approve v${pendingVersion}`,
      title:
        `Put v${pendingVersion} on the air and create its binding. Somebody ` +
        `other than the person who asked has to do this.`,
      kind: "primary",
      run: approveGoLive,
      because: `v${pendingVersion} is waiting for approval`,
    };
  }
  /**
   * Only reachable when the request half of `sendForApproval` failed: the
   * snapshot exists and nobody has been asked yet. Kept so that state has a
   * way out, not as a step anyone is meant to walk through.
   */
  if (compiledVersion != null) {
    return {
      id: "send",
      label: `Raise approval request for v${compiledVersion}`,
      title:
        `v${compiledVersion} was taken but nobody has been asked yet. ` +
        `Nothing runs differently until somebody approves it.`,
      kind: "primary",
      run: (graphKey: string) => requestGoLive(graphKey),
      because: `v${compiledVersion} was taken but not sent`,
    };
  }
  if (hasWorkingCopy) {
    return {
      id: "send",
      label: "Raise approval request",
      title:
        "Freeze what you have as a numbered version and ask somebody to put " +
        "it live. Your working copy is left alone, so editing can carry on.",
      kind: "primary",
      run: sendForApproval(),
      because: "there are edits nobody has been asked about",
    };
  }
  if (row.activeVersion != null) {
    return {
      id: "offline",
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
  skip,
  emptyLabel,
  showWhy = true,
}: {
  row: WorkflowRegistryRow;
  busy: boolean;
  /**
   * `id` says WHICH transition, so a screen can intercept one.
   *
   * The test page intercepts `send` to show what is about to be sent before
   * sending it; everything else still acts on the press.
   */
  onAct: (
    graphKey: string,
    run: LifecycleCall,
    id: NonNullable<NextStep>["id"],
  ) => void;
  /**
   * Transitions this screen does not offer.
   *
   * The editor skips `send`. Asking for approval is a different job from
   * editing, and the way to it is the test page — you look at what the thing
   * does before asking somebody to put it live. Testing is not compulsory;
   * being on the screen that offers it is.
   */
  skip?: Array<NonNullable<NextStep>["id"]>;
  /**
   * What to say when there is nothing this screen will offer.
   *
   * `null` renders nothing at all, which is the right answer on a screen that
   * declines a step. The editor skips `send`, so while you are editing a draft
   * there is nothing for it to show — and a control announcing "nothing
   * waiting" is worse than an absent one: it reads as a status about the
   * workflow rather than about a button that was never going to appear.
   */
  emptyLabel?: string | null;
  /**
   * Show the line under the button explaining the current state.
   *
   * Worth it where a screen distinguishes states — "live, with nothing
   * waiting" tells you something the label does not. Not worth it on a screen
   * built around a single action, where it only says the button again.
   */
  showWhy?: boolean;
}) {
  /**
   * AN OPERATOR IS OFFERED THE SAME TWO STEPS EVERY SCREEN DECLINES.
   *
   * `approve` and `offline` are the verbs that change what is running, and
   * admin-api refuses both from an operator (`lib/admin-only.ts`). Skipping
   * them here is the same mechanism a screen already uses to decline a step,
   * so the states below — "requested, somebody else approves it", with
   * Withdraw still offered — are reached without inventing a second way of
   * saying the same thing.
   *
   * The button is not disabled. A disabled control is a thing you press and
   * learn nothing from; an absent one with a sentence beside it is an answer.
   */
  const isAdmin = useIsAdmin();
  const declined = [
    ...(skip ?? []),
    ...(isAdmin ? [] : (["approve", "offline"] as const)),
  ];
  const found = nextStep(row);
  const step = found && declined.includes(found.id) ? null : found;

  /**
   * SENT, AND WAITING FOR SOMEBODY ELSE.
   *
   * A screen that declines `approve` still has something true to say when a
   * version is pending — and the person looking at it is usually the one who
   * just sent it, for whom Approve is not merely unavailable but FORBIDDEN:
   * `graph_versions_two_person_ck` refuses an approval by the requester, so
   * the button would be a control guaranteed to fail.
   *
   * Withdraw stays, because taking back your own request is yours to do, and a
   * request that cannot be taken back is one people hesitate to make.
   */
  if (!step && row.lifecycle.pendingVersion != null) {
    return (
      <div className="wf-lifecycle">
        <span className="wf-muted">
          v{row.lifecycle.pendingVersion} requested — somebody else approves it
        </span>
        <button
          type="button"
          className="wf-btn wf-btn--quiet"
          title="Withdraw the request. The version is kept and can be sent again."
          disabled={busy}
          onClick={() => onAct(row.graphKey, cancelGoLiveRequest, "send")}
        >
          Withdraw
        </button>
      </div>
    );
  }

  /**
   * Live, nothing waiting, and taking it off the air is not yours to do. Said
   * rather than left blank, because an empty cell next to a live workflow
   * reads as a screen that failed to load.
   */
  if (!step && !isAdmin && found?.id === "offline") {
    return (
      <div className="wf-lifecycle">
        <span className="wf-muted">live — an admin takes it offline</span>
      </div>
    );
  }

  if (!step) {
    if (emptyLabel === null) return null;
    return (
      <div className="wf-lifecycle">
        <span className="wf-muted">{emptyLabel ?? "nothing to do"}</span>
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
        onClick={() => onAct(row.graphKey, step.run, step.id)}
      >
        {busy ? "Working…" : step.label}
      </button>
      {row.lifecycle.pendingVersion != null ? (
        <button
          type="button"
          className="wf-btn wf-btn--quiet"
          title="Withdraw the request. The version is kept and can be requested again."
          disabled={busy}
          onClick={() => onAct(row.graphKey, cancelGoLiveRequest, "approve")}
        >
          Withdraw
        </button>
      ) : null}
      {showWhy ? <span className="wf-lifecycle-why">{step.because}</span> : null}
    </div>
  );
}

