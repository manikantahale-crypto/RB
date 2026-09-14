/**
 * A plan is the unit an author approves and releases.
 *
 * There used to be a second, displayed plan — `build-plan.ts` computed one
 * from the description and stored nothing, for the box screen 2 drew above the
 * proposal. That box is gone, and so is the module behind it. What survives is
 * this: the plan that is WRITTEN DOWN when a chain is accepted, which is a
 * different thing and exists because of three jobs the displayed one never did:
 *
 *   - release every step together, or none of them
 *   - wait for another application's owner to approve their step
 *   - still be there in six months, next to the sentence it came from
 *
 * The rules here are the product, not plumbing, so they are stated once and
 * tested directly. `canRelease` is a pure function for exactly that reason.
 */


type Queryable = {
  query: <T = any>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A step as it is stored, which is narrower than the computed one. */
export type StoredStep = {
  seq: number;
  kind: "existing" | "changed" | "new" | "blocked";
  graphKey: string | null;
  inboundEventType: string | null;
  blockedReason: string | null;
  ownerApplication: string | null;
  approvedAt: string | null;
};

export type StoredPlan = {
  id: string;
  status: "draft" | "pending_approval" | "live" | "abandoned";
  requestText: string;
  requestedBy: string | null;
  approvedBy: string | null;
  steps: StoredStep[];
};

export type ReleaseVerdict =
  | { ok: true; willRelease: number[] }
  | { ok: false; reason: string };

/**
 * Whether this plan may be released, and why not when it may not.
 *
 * Four rules, in the order a person would ask them:
 *
 *   1. It has been approved. An unapproved plan is a proposal.
 *   2. Nothing in it is blocked. A blocked step is one the platform could not
 *      resolve, so releasing "the rest" releases a chain with a hole in it —
 *      which is the specific failure the plan exists to prevent.
 *   3. Every step touching somebody else's application has that owner's
 *      approval. Their step, their call.
 *   4. There is something to release. A plan of nothing but `existing` steps
 *      describes what already runs, and calling that a release would put a
 *      row in the history saying something changed when nothing did.
 *
 * Pure, so the rules can be read and tested without a database standing in
 * the way of either.
 */
export function canRelease(plan: StoredPlan): ReleaseVerdict {
  if (plan.status !== "pending_approval" && plan.status !== "draft") {
    return {
      ok: false,
      reason:
        plan.status === "live"
          ? "This plan has already been released."
          : "This plan was abandoned. Start a new one rather than reviving it.",
    };
  }

  if (!plan.approvedBy) {
    return {
      ok: false,
      reason:
        "Nobody has approved this plan. It changes what runs in production, " +
        "so somebody other than the person who asked has to say yes.",
    };
  }

  const blocked = plan.steps.filter((s) => s.kind === "blocked");
  if (blocked.length > 0) {
    return {
      ok: false,
      reason:
        `${blocked.length} step(s) are blocked: ` +
        blocked.map((s) => `step ${s.seq} — ${s.blockedReason}`).join("; ") +
        ". Releasing the rest would leave the chain with a hole in it.",
    };
  }

  const unowned = plan.steps.filter(
    (s) => s.ownerApplication !== null && s.approvedAt === null,
  );
  if (unowned.length > 0) {
    return {
      ok: false,
      reason:
        `${unowned.length} step(s) touch another application and its owner ` +
        `has not approved: ` +
        unowned
          .map((s) => `step ${s.seq} (${s.ownerApplication})`)
          .join(", ") +
        ".",
    };
  }

  const willRelease = plan.steps
    .filter((s) => s.kind === "new" || s.kind === "changed")
    .map((s) => s.seq);

  if (willRelease.length === 0) {
    return {
      ok: false,
      reason:
        "Every step in this plan already exists and runs. There is nothing " +
        "to release — which is an answer, not a failure.",
    };
  }

  return { ok: true, willRelease };
}

/**
 * Who did this, split the way the rest of the authoring tables split it: a
 * foreign-keyed id for a known user, a label for anything else.
 *
 * The two-person rule compares ids, so a label cannot satisfy it. That is
 * deliberate — see `approvePlan`.
 */
async function attribution(
  db: Queryable,
  by: string | null | undefined,
): Promise<{ userId: string | null; label: string | null }> {
  const value = by == null ? null : String(by).trim();
  if (!value) return { userId: null, label: null };
  if (!UUID.test(value)) return { userId: null, label: value };

  const { rows } = await db.query<{ id: string }>(
    `SELECT id::text AS id FROM platform.users WHERE id = $1::uuid`,
    [value],
  );
  return rows[0] ? { userId: value, label: null } : { userId: null, label: value };
}

/**
 * Record a plan from an accepted chain.
 *
 * This is the only way a plan is recorded. There was a second, `savePlan`,
 * which took the computed plan the propose screen used to display — that
 * screen section is gone and nothing ever called it, so it went with it.
 * What is stored is the links the author actually agreed to.
 *
 * A link whose workflow this request created is `new`; one naming a workflow
 * that already existed is `existing` and releases nothing. A step outside the
 * author's own application carries its owner, which is what turns that owner's
 * approval into a precondition rather than an etiquette.
 */
export async function savePlanFromLinks(
  db: Queryable,
  args: {
    orgId: string | null;
    requestText: string;
    authorModule: string;
    links: Array<{ graphKey?: unknown; module?: unknown; triggerEventType?: unknown }>;
    createdKeys: Set<string>;
    by?: string | null;
  },
): Promise<string | null> {
  // A plan belongs to a tenant. Without one there is nothing to attach it to,
  // and inventing an org to hold it would put a plan in the wrong place.
  if (!args.orgId) return null;

  const { userId, label } = await attribution(db, args.by);

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO authoring.plans
       (org_id, request_text, status, created_by, created_by_label)
     VALUES ($1::uuid, $2, 'draft', $3::uuid, $4)
     RETURNING id::text AS id`,
    [args.orgId, args.requestText, userId, label],
  );
  const planId = rows[0]!.id;

  let seq = 0;
  for (const link of args.links) {
    seq += 1;
    const graphKey = String(link.graphKey ?? "").trim();
    const stepModule = String(link.module ?? "").trim();
    if (!graphKey) continue;

    await db.query(
      `INSERT INTO authoring.plan_steps
         (plan_id, seq, kind, graph_id, inbound_event_type, owner_application)
       VALUES (
         $1::uuid, $2, $3,
         (SELECT g.id FROM authoring.graphs g
           WHERE g.graph_key = $4 AND g.org_id IS NULL LIMIT 1),
         $5,
         (SELECT a.key FROM platform.applications a WHERE a.key = $6))`,
      [
        planId,
        seq,
        args.createdKeys.has(graphKey) ? "new" : "existing",
        graphKey,
        link.triggerEventType ? String(link.triggerEventType) : null,
        stepModule && stepModule !== args.authorModule ? stepModule : null,
      ],
    );
  }

  return planId;
}

/** Read a plan back in the shape the rules are written against. */
export async function loadPlan(
  db: Queryable,
  planId: string,
): Promise<StoredPlan | null> {
  const { rows } = await db.query<any>(
    `SELECT p.id::text, p.status, p.request_text,
            coalesce(p.requested_by::text, p.requested_by_label) AS requested_by,
            coalesce(p.approved_by::text, p.approved_by_label)   AS approved_by
       FROM authoring.plans p WHERE p.id = $1::uuid`,
    [planId],
  );
  const p = rows[0];
  if (!p) return null;

  const { rows: steps } = await db.query<any>(
    `SELECT s.seq, s.kind,
            (SELECT g.graph_key FROM authoring.graphs g WHERE g.id = s.graph_id) AS graph_key,
            s.inbound_event_type, s.blocked_reason, s.owner_application,
            s.approved_at
       FROM authoring.plan_steps s
      WHERE s.plan_id = $1::uuid ORDER BY s.seq`,
    [planId],
  );

  return {
    id: String(p.id),
    status: p.status,
    requestText: p.request_text,
    requestedBy: p.requested_by ?? null,
    approvedBy: p.approved_by ?? null,
    steps: steps.map((s) => ({
      seq: Number(s.seq),
      kind: s.kind,
      graphKey: s.graph_key ?? null,
      inboundEventType: s.inbound_event_type ?? null,
      blockedReason: s.blocked_reason ?? null,
      ownerApplication: s.owner_application ?? null,
      approvedAt: s.approved_at ? String(s.approved_at) : null,
    })),
  };
}

export async function requestPlanApproval(
  db: Queryable,
  args: { planId: string; by?: string | null },
): Promise<boolean> {
  const { userId, label } = await attribution(db, args.by);
  const { rowCount } = await db.query(
    `UPDATE authoring.plans
        SET status = 'pending_approval',
            requested_by = $2::uuid, requested_by_label = $3,
            requested_at = now()
      WHERE id = $1::uuid AND status = 'draft'`,
    [args.planId, userId, label],
  );
  return (rowCount ?? 0) > 0;
}

export type ApproveResult =
  | { ok: true }
  | { ok: false; status: number; error: string; message: string };

/**
 * Say yes to a plan somebody else asked for.
 *
 * The two-person rule is a check constraint, so the database refuses a
 * self-approval whatever this function does. It is checked here as well for
 * one reason: a constraint violation reaches the caller as a Postgres error
 * with a constraint name in it, and the person reading it deserves a sentence
 * about why instead.
 *
 * An approver with no user id is refused outright. The constraint compares
 * ids, so `admin-local` approving `admin-local` would satisfy it — two labels
 * are not two people, and a rule that can be walked around by not signing in
 * is not a rule.
 */
export async function approvePlan(
  db: Queryable,
  args: { planId: string; by?: string | null },
): Promise<ApproveResult> {
  const { userId } = await attribution(db, args.by);
  if (!userId) {
    return {
      ok: false,
      status: 403,
      error: "approver_unknown",
      message:
        "Approving a plan records who approved it, so it has to be a known " +
        "user rather than a deployment label. Sign in and try again.",
    };
  }

  const plan = await loadPlan(db, args.planId);
  if (!plan) {
    return { ok: false, status: 404, error: "plan_not_found", message: "No such plan." };
  }
  if (plan.status !== "pending_approval") {
    return {
      ok: false,
      status: 409,
      error: "not_awaiting_approval",
      message:
        plan.status === "live"
          ? "This plan has already been released."
          : `This plan is ${plan.status}, so there is nothing to approve.`,
    };
  }
  if (plan.requestedBy && plan.requestedBy === userId) {
    return {
      ok: false,
      status: 409,
      error: "same_person",
      message:
        "You asked for this plan, so you cannot also be the one who approves " +
        "it. A release changes what runs for everybody on these workflows.",
    };
  }

  await db.query(
    `UPDATE authoring.plans
        SET approved_by = $2::uuid, approved_at = now()
      WHERE id = $1::uuid`,
    [args.planId, userId],
  );
  return { ok: true };
}

/** One application's owner signing off the step that touches them. */
export async function approvePlanStep(
  db: Queryable,
  args: { planId: string; seq: number; by?: string | null },
): Promise<boolean> {
  const { userId, label } = await attribution(db, args.by);
  const { rowCount } = await db.query(
    `UPDATE authoring.plan_steps
        SET approved_by = $3::uuid, approved_by_label = $4, approved_at = now()
      WHERE plan_id = $1::uuid AND seq = $2
        AND owner_application IS NOT NULL
        AND approved_at IS NULL`,
    [args.planId, args.seq, userId, label],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Put every step live, together.
 *
 * The caller holds the transaction. That is not a convenience: "all of it or
 * none of it" is the entire reason this table exists, and a function that
 * opened its own would give each step its own atomicity and the plan none.
 */
export async function releasePlan(
  db: Queryable,
  args: { planId: string },
): Promise<{ released: string[]; missing: string[] }> {
  /**
   * By graph_id, not by key and org.
   *
   * The step already stores the workflow it means. Re-resolving it from the
   * key and the plan's org got this wrong: workflows are global (org_id NULL)
   * and a plan belongs to a tenant, so `g.org_id IS NOT DISTINCT FROM <org>`
   * matched nothing and the release reported every step as uncompiled. The id
   * is the thing that was decided when the plan was made; asking again invites
   * a different answer.
   */
  const { rows: steps } = await db.query<{ graph_id: string; graph_key: string }>(
    `SELECT s.graph_id::text AS graph_id, g.graph_key
       FROM authoring.plan_steps s
       JOIN authoring.graphs g ON g.id = s.graph_id
      WHERE s.plan_id = $1::uuid AND s.kind IN ('new','changed')
      ORDER BY s.seq`,
    [args.planId],
  );

  const released: string[] = [];
  const missing: string[] = [];

  for (const { graph_id, graph_key } of steps) {
    const { rows: target } = await db.query<{ version: number }>(
      `SELECT version FROM authoring.graph_versions
        WHERE graph_id = $1::uuid
          AND status IN ('compiled','pending_go_live')
        ORDER BY version DESC LIMIT 1`,
      [graph_id],
    );

    // Nothing compiled to promote. NOT skipped: a plan that releases three of
    // its four steps is the exact half-applied state this table exists to
    // prevent, so the caller is told and rolls the whole thing back.
    if (!target[0]) {
      missing.push(graph_key);
      continue;
    }

    const version = target[0].version;
    await db.query(
      `UPDATE authoring.graph_versions
          SET status = 'retired'
        WHERE graph_id = $1::uuid AND status = 'live' AND version <> $2`,
      [graph_id, version],
    );
    await db.query(
      `UPDATE authoring.graph_versions
          SET status = 'live', approved_at = coalesce(approved_at, now())
        WHERE graph_id = $1::uuid AND version = $2`,
      [graph_id, version],
    );
    await db.query(
      `UPDATE authoring.graphs SET status = 'active', updated_at = now()
        WHERE id = $1::uuid AND status <> 'active'`,
      [graph_id],
    );
    released.push(`${graph_key}@${version}`);
  }

  // Only a plan that released everything it promised is a released plan.
  if (missing.length === 0) {
    await db.query(
      `UPDATE authoring.plans SET status = 'live', released_at = now()
        WHERE id = $1::uuid`,
      [args.planId],
    );
  }

  return { released, missing };
}
