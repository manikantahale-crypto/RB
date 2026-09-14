/**
 * Freeze the working copy so a test can run the thing on screen.
 *
 * WHAT WAS WRONG. Screen 5 fires a real event, the router resolved the
 * binding, and a binding names the LIVE version — so "Test" ran the version
 * already in production, not the edit in front of you. A workflow that had
 * never been live could not be tried at all.
 *
 * WHY TESTING COMPILES. The run has to point at something immutable:
 * `orch.runs` records `graph_version`, and a run recorded as v4 must mean one
 * thing for ever. A draft is mutable by definition, so running one directly
 * would produce a run nobody can reconstruct.
 *
 * Freezing first also makes the flow honest end to end — the version you
 * tested is the version you send for approval, and the version the approver
 * reads. Before this, the snapshot was taken AFTER testing, so the two could
 * differ and nothing said so.
 *
 * WHY IT DOES NOT COMPILE EVERY TIME. The draft and every version carry a
 * checksum. If the newest version already matches the draft, that version IS
 * the draft and is reused — so testing three times without editing gives one
 * version rather than three. Version numbers are cheap, but a list full of
 * identical ones is a list nobody reads.
 */

import { versionForDraft } from "./version-for-draft.js";

export type Queryable = {
  query: (
    sql: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type TestPin = {
  graphKey: string;
  graphVersion: number;
  moduleQueue: string;
};

export type PinOutcome =
  | { ok: true; pin: TestPin; version: number; compiled: boolean; checksum: string }
  | { ok: false; reason: "no_draft" | "no_queue"; message: string };

/**
 * Where a pinned run should be enqueued.
 *
 * The active binding's queue when there is one. Otherwise the convention the
 * seeds use — `module.<application>.<entity>` — falling back to the
 * application's own queue, because a workflow that has never been live has no
 * binding to take a queue from and that is the case this exists for.
 */
export async function queueForTest(
  db: Queryable,
  graphKey: string,
): Promise<string | null> {
  const bound = await db.query(
    `SELECT b.queue_key
       FROM authoring.event_bindings b
       JOIN authoring.graphs g ON g.id = b.graph_id
      WHERE g.graph_key = $1 AND b.status = 'active'
      LIMIT 1`,
    [graphKey],
  );
  if (bound.rows[0]?.queue_key) return String(bound.rows[0].queue_key);

  /**
   * No binding. Any queue the application already serves will do — the worker
   * subscribes per queue and the job carries the graph key, so which of an
   * application's queues it lands on changes nothing about what runs.
   *
   * Asking `platform.queues` rather than composing a name: a queue is a
   * foreign key on bindings, and inventing one that no worker subscribes to
   * would leave the job sitting there for ever with nothing to say why.
   */
  const application = graphKey.split(".")[0] ?? "";
  const known = await db.query(
    `SELECT key FROM platform.queues
      WHERE application = $1
      ORDER BY (key LIKE 'module.' || $1 || '%') DESC, key
      LIMIT 1`,
    [application],
  );
  return known.rows[0]?.key ? String(known.rows[0].key) : null;
}

/**
 * The version a test should run, compiling the working copy if it has moved.
 *
 * `compileDraft` is passed in rather than imported so this stays testable
 * without a database and without the write path — the same reason the routing
 * contract is pure.
 */
export async function pinForTest(
  db: Queryable,
  args: {
    graphKey: string;
    orgId: string | null;
    by?: string | null;
    compileDraft: (args: {
      graphKey: string;
      orgId: string | null;
      by?: string | null;
    }) => Promise<{ version: number; checksum: string } | null>;
  },
): Promise<PinOutcome> {
  const moduleQueue = await queueForTest(db, args.graphKey);
  if (!moduleQueue) {
    return {
      ok: false,
      reason: "no_queue",
      message:
        `No queue serves ${args.graphKey.split(".")[0]}, so a run would sit ` +
        `unclaimed. Bind the workflow, or add the queue.`,
    };
  }

  const chosen = await versionForDraft(db, {
    graphKey: args.graphKey,
    orgId: args.orgId,
    by: args.by,
    compileDraft: args.compileDraft,
  });
  if (!chosen.ok) {
    return { ok: false, reason: "no_draft", message: chosen.message };
  }

  return {
    ok: true,
    compiled: chosen.compiled,
    version: chosen.version,
    checksum: chosen.checksum,
    pin: {
      graphKey: args.graphKey,
      graphVersion: chosen.version,
      moduleQueue,
    },
  };
}
