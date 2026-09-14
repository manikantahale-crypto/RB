/**
 * Writing a workflow, when one table has become three.
 *
 * `public.graph_definitions` was doing three jobs at once — the identity of a
 * workflow, its editable working copy, and a numbered version — and the
 * fourteen places that wrote to it each had to know which job they meant.
 * They expressed it through `status` and a hand-built id like
 * `graph_syntra_jd_workflow_v7_global`, which is why a binding once pointed at
 * version 119: 123 of those numbers had been spent on editing sessions.
 *
 * The authoring layer splits the three:
 *
 *   authoring.graphs         the workflow exists, and belongs to someone
 *   authoring.graph_drafts   ONE working copy per workflow, no version
 *   authoring.graph_versions numbered, immutable, one of them live
 *
 * These five functions are the only places admin-api writes them, so the
 * mapping is decided once rather than fourteen times.
 *
 * READS still go through GRAPH_DEFINITIONS in ./authoring-views.js, which
 * presents all three under the old column names.
 */

import { checksumOf } from "@tekisho/graph-contract";

type Queryable = {
  query: <T = any>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who did this, filed as what it actually is.
 *
 * The upstream column is text and holds two different kinds of thing: three
 * rows carry a real user id, 543 carry a deployment label such as
 * `stage-v31-relay`, `admin-local` or `test`. Both are provenance and neither
 * should be thrown away, so the id goes in the typed, foreign-keyed column and
 * the label goes in the one that is honestly just a label.
 *
 * A uuid that is not a known user is a label too — a foreign key would reject
 * it, and losing the value to keep the column tidy would be worse.
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

/** The workflow's identity row, created if this is the first anyone has heard of it. */
export async function ensureGraph(
  db: Queryable,
  args: {
    graphKey: string;
    orgId: string | null;
    title?: string;
    /** Falls back to the key's prefix, which is where every other application comes from. */
    application?: string | null;
    by?: string | null;
  },
): Promise<string> {
  const { userId, label } = await attribution(db, args.by);
  const application =
    args.application ?? (args.graphKey.split(".")[0] || null);

  const { rows } = await db.query<{ id: string }>(
    // The unique index is on an expression — coalesce(org_id, '~global~') and
    // graph_key — because a global workflow has a NULL org and NULL is not
    // equal to itself. ON CONFLICT has to name the same expression.
    `INSERT INTO authoring.graphs
       (org_id, graph_key, application, title, status, created_by, created_by_label)
     VALUES ($1::uuid, $2,
             (SELECT a.key FROM platform.applications a WHERE a.key = $3),
             $4, 'draft', $5::uuid, $6)
     ON CONFLICT (coalesce(org_id::text, '~global~'), graph_key)
       DO UPDATE SET updated_at = now()
     RETURNING id::text AS id`,
    [
      args.orgId,
      args.graphKey,
      application,
      args.title ?? args.graphKey,
      userId,
      label,
    ],
  );
  return rows[0]!.id;
}

/**
 * Save the working copy.
 *
 * One row per workflow, replaced in place. This is what the old
 * `status = 'draft'` row was, and the reason it never needed a version: a
 * draft is not a version, it is the thing you are editing before there is one.
 */
export async function saveDraft(
  db: Queryable,
  args: {
    graphKey: string;
    orgId: string | null;
    definition: unknown;
    checksum?: string;
    by?: string | null;
    title?: string;
  },
): Promise<{ graphId: string; checksum: string }> {
  const graphId = await ensureGraph(db, {
    graphKey: args.graphKey,
    orgId: args.orgId,
    title: args.title,
    by: args.by,
  });
  const checksum = args.checksum ?? checksumOf(args.definition as any);
  const { userId } = await attribution(db, args.by);

  await db.query(
    `INSERT INTO authoring.graph_drafts
       (graph_id, definition, checksum, updated_by, updated_at)
     VALUES ($1::uuid, $2::jsonb, $3, $4::uuid, now())
     ON CONFLICT (graph_id) DO UPDATE SET
       definition = EXCLUDED.definition,
       checksum   = EXCLUDED.checksum,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [graphId, JSON.stringify(args.definition), checksum, userId],
  );

  return { graphId, checksum };
}

/**
 * Record a compiled definition as a numbered version. NOT live.
 *
 * This is what Compile does: it turns an agent policy into a topology and
 * files it under that policy's version number. Nothing runs yet — going live
 * is a separate, checked act, and `activateVersion` below is that act.
 *
 * `compiled` is a real status in authoring.graph_versions, and it is the
 * distinction the old table could not draw: `status = 'draft'` there meant
 * both "the working copy somebody is editing" and "a numbered build waiting to
 * go live", which are not the same thing and do not have the same lifetime.
 *
 * The number is passed in rather than allocated, because it is the policy's
 * version and the binding pins it.
 */
export async function compileVersion(
  db: Queryable,
  args: {
    graphKey: string;
    orgId: string | null;
    version: number;
    definition: unknown;
    checksum?: string;
    by?: string | null;
    title?: string;
  },
): Promise<{ graphId: string; version: number }> {
  const graphId = await ensureGraph(db, {
    graphKey: args.graphKey,
    orgId: args.orgId,
    title: args.title,
    by: args.by,
  });
  const checksum = args.checksum ?? checksumOf(args.definition as any);
  const { userId, label } = await attribution(db, args.by);

  const { rows } = await db.query<{ version: number }>(
    `INSERT INTO authoring.graph_versions
       (graph_id, org_id, version, definition, checksum, status,
        compiled_by, compiled_by_label, compiled_at)
     VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, 'compiled', $6::uuid, $7, now())
     ON CONFLICT (graph_id, version) DO UPDATE SET
       definition        = EXCLUDED.definition,
       checksum          = EXCLUDED.checksum,
       compiled_by       = EXCLUDED.compiled_by,
       compiled_by_label = EXCLUDED.compiled_by_label,
       compiled_at       = now(),
       -- A recompile of the LIVE version must not take it off the air. Only a
       -- version that was not live goes back to 'compiled'.
       status = CASE WHEN authoring.graph_versions.status = 'live'
                     THEN 'live' ELSE 'compiled' END
     RETURNING version`,
    [
      graphId,
      args.orgId,
      args.version,
      JSON.stringify(args.definition),
      checksum,
      userId,
      label,
    ],
  );

  return { graphId, version: Number(rows[0]!.version) };
}

/**
 * Make an EXISTING version the live one. Rollback, not publish.
 *
 * Returns null when there is no such version, which is what tells the caller
 * to answer 404 rather than pretend something happened.
 */
export async function activateVersion(
  db: Queryable,
  args: { graphKey: string; orgId: string | null; version: number },
): Promise<{ version: number } | null> {
  const { rows: found } = await db.query<{ graph_id: string }>(
    `SELECT v.graph_id::text AS graph_id
       FROM authoring.graph_versions v
       JOIN authoring.graphs g ON g.id = v.graph_id
      WHERE g.graph_key = $1
        AND g.org_id IS NOT DISTINCT FROM $2::uuid
        AND v.version = $3
      LIMIT 1`,
    [args.graphKey, args.orgId, args.version],
  );
  if (!found[0]) return null;

  await db.query(
    `UPDATE authoring.graph_versions
        SET status = 'retired'
      WHERE graph_id = $1::uuid AND status = 'live' AND version <> $2`,
    [found[0].graph_id, args.version],
  );
  const { rows } = await db.query<{ version: number }>(
    `UPDATE authoring.graph_versions
        SET status = 'live'
      WHERE graph_id = $1::uuid AND version = $2
      RETURNING version`,
    [found[0].graph_id, args.version],
  );
  if (!rows[0]) return null;

  // The workflow itself is active once one of its versions is.
  await db.query(
    `UPDATE authoring.graphs SET status = 'active', updated_at = now()
      WHERE id = $1::uuid AND status <> 'active'`,
    [found[0].graph_id],
  );

  return { version: Number(rows[0].version) };
}

/** Take whatever is live off the air. The versions themselves are untouched. */
export async function retireActive(
  db: Queryable,
  args: { graphKey: string; orgId: string | null },
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE authoring.graph_versions v
        SET status = 'retired'
       FROM authoring.graphs g
      WHERE g.id = v.graph_id
        AND g.graph_key = $1
        AND g.org_id IS NOT DISTINCT FROM $2::uuid
        AND v.status = 'live'`,
    [args.graphKey, args.orgId],
  );
  return rowCount ?? 0;
}

/**
 * Ask for a version to go live.
 *
 * A request is cheap and reversible; promoting is neither. So this only moves
 * a `compiled` build to `pending_go_live` and records who asked — it changes
 * nothing about what runs, which is what makes it safe to offer to anyone who
 * can edit.
 *
 * Returns null when there is no such version to request, so the caller answers
 * 404 rather than reporting a request nobody can act on.
 */
export async function requestGoLive(
  db: Queryable,
  args: {
    graphKey: string;
    orgId: string | null;
    /** Defaults to the highest version that is not live and not retired. */
    version?: number;
    by?: string | null;
    /**
     * What the author says this changes and why.
     *
     * Optional on purpose. An empty note is honest about a change that speaks
     * for itself; forcing one produces "update" a thousand times, which is
     * worse than nothing because it looks like an answer.
     */
    note?: string | null;
  },
): Promise<{ version: number; status: string } | null> {
  const { userId, label } = await attribution(db, args.by);

  /**
   * A RETIRED VERSION CAN BE ASKED FOR AGAIN, AND THAT IS THE WAY BACK.
   *
   * This accepted only `compiled`, which left taking a workflow offline as a
   * one-way door: the binding was gone, and now the version is retired too, so
   * there was nothing in a requestable state and no screen that could put it
   * back. (The dead end predates the change — a live-but-unbound workflow had
   * no re-bind path either — but making the state honest also has to make the
   * exit honest.)
   *
   * So coming back online is the ordinary route, not a special one: request,
   * then somebody else approves. That keeps the two-person rule and the whole
   * go-live gate on the act of putting something into production, which is
   * exactly where they belong. A `bring-online` button that skipped them would
   * be a second, quieter way to change what runs.
   *
   * The default still prefers the newest COMPILED version — the common case is
   * releasing new work, not restoring old. A retired one has to be asked for
   * by number, which is the right amount of friction for "put last month's
   * version back".
   */
  const { rows } = await db.query<{ version: number; status: string }>(
    `UPDATE authoring.graph_versions v
        SET status             = 'pending_go_live',
            requested_by       = $4::uuid,
            requested_by_label = $5,
            requested_at       = now(),
            -- The approver is never the author, so without this they open the
            -- queue and see a key, a number and a checksum.
            request_note       = $6
       FROM authoring.graphs g
      WHERE g.id = v.graph_id
        AND g.graph_key = $1
        AND g.org_id IS NOT DISTINCT FROM $2::uuid
        AND v.status IN ('compiled', 'retired')
        AND v.version = coalesce($3, (
          SELECT max(v2.version) FROM authoring.graph_versions v2
           WHERE v2.graph_id = v.graph_id AND v2.status = 'compiled'))
      RETURNING v.version, v.status`,
    [
      args.graphKey,
      args.orgId,
      args.version ?? null,
      userId,
      label,
      args.note?.trim() ? args.note.trim() : null,
    ],
  );
  return rows[0] ?? null;
}

/**
 * Is the approver the person who asked?
 *
 * Pure, and separate from the query, because it is the whole rule and the
 * subtlety is all here rather than in the SQL.
 *
 * ONE IDENTITY, TWO COLUMNS. `attribution()` writes a uuid into `*_by` when
 * the caller resolves to a row in `platform.users` and a free-text label into
 * `*_by_label` otherwise. Both sides are compared after that collapse, so
 * `alice` approving `alice` is caught even though neither is a uuid — which is
 * every request the admin screens make today.
 *
 * UNKNOWN IS NOT A SECOND PERSON. When either side is missing this returns
 * false and the approval proceeds: the caller cannot show the two are the same
 * person, and refusing every unattributed approval would block the seeded and
 * deployment-labelled versions that make up most of the table. The database
 * constraint takes the stricter line for rows where both acts are recorded and
 * neither identity is — see V20260909.53.
 */
export function isSamePerson(
  approver: string | null,
  requester: string | null,
): boolean {
  if (approver === null || requester === null) return false;
  return approver.trim() === requester.trim();
}

/**
 * Say yes, and put it on the air.
 *
 * Approval and promotion are one act deliberately. Separating them would leave
 * a fourth state — approved but not running — that nothing else in the system
 * understands, and somebody would eventually have to ask which of the two
 * mattered.
 *
 * Whatever was live steps down first: `graph_versions_one_live_idx` allows a
 * single live version per workflow, so the order is not a preference.
 *
 * THE TWO-PERSON RULE IS ENFORCED HERE, AND UNTIL NOW IT WAS ENFORCED NOWHERE.
 *
 * V20260909.49 added `requested_by` / `approved_by` and the comments around
 * them describe a rule that the person who asks cannot be the person who says
 * yes. The CHECK constraint those comments name was never written, and this
 * function never compared the two — so one person could request and approve
 * their own workflow into production, which is exactly what the columns exist
 * to prevent. V20260909.53 adds the constraint as the backstop; this is the
 * half that can explain itself to whoever hit it.
 *
 * It compares the EFFECTIVE identity, not the uuid. `attribution()` writes a
 * uuid for a known user and a free-text label for everyone else, and the admin
 * screens send a label — so a rule comparing only the uuid columns would find
 * NULL on both sides of every request the UI makes and pass every time.
 */
export async function approveGoLive(
  db: Queryable,
  args: {
    graphKey: string;
    orgId: string | null;
    /** Defaults to the version that has been waiting longest. */
    version?: number;
    by?: string | null;
  },
): Promise<
  | { version: number; previousLive: number | null }
  /** The approver is the person who asked. Nothing was changed. */
  | { refused: "same_person"; version: number; requestedBy: string }
  | null
> {
  const { rows: pending } = await db.query<{
    graph_id: string;
    version: number;
    asked_by: string | null;
  }>(
    `SELECT v.graph_id::text AS graph_id, v.version,
            coalesce(v.requested_by::text, v.requested_by_label) AS asked_by
       FROM authoring.graph_versions v
       JOIN authoring.graphs g ON g.id = v.graph_id
      WHERE g.graph_key = $1
        AND g.org_id IS NOT DISTINCT FROM $2::uuid
        AND v.status = 'pending_go_live'
        AND ($3::int IS NULL OR v.version = $3)
      ORDER BY v.requested_at ASC NULLS LAST
      LIMIT 1`,
    [args.graphKey, args.orgId, args.version ?? null],
  );
  if (!pending[0]) return null;

  const { graph_id: graphId, version } = pending[0];
  const { userId, label } = await attribution(db, args.by);

  // Whoever the approver is, under whichever column they landed in.
  const asked = pending[0].asked_by;
  if (isSamePerson(userId ?? label ?? null, asked)) {
    return {
      refused: "same_person",
      version: Number(version),
      requestedBy: asked ?? "whoever requested it",
    };
  }

  const { rows: steppedDown } = await db.query<{ version: number }>(
    `UPDATE authoring.graph_versions
        SET status = 'retired'
      WHERE graph_id = $1::uuid AND status = 'live' AND version <> $2
      RETURNING version`,
    [graphId, version],
  );

  await db.query(
    `UPDATE authoring.graph_versions
        SET status            = 'live',
            approved_by       = $3::uuid,
            approved_by_label = $4,
            approved_at       = now()
      WHERE graph_id = $1::uuid AND version = $2`,
    [graphId, version, userId, label],
  );

  await db.query(
    `UPDATE authoring.graphs SET status = 'active', updated_at = now()
      WHERE id = $1::uuid AND status <> 'active'`,
    [graphId],
  );

  return {
    version: Number(version),
    previousLive: steppedDown[0] ? Number(steppedDown[0].version) : null,
  };
}

/**
 * Withdraw the request. The build stays exactly where it was.
 *
 * Back to `compiled`, not to retired: withdrawing is "not yet", and throwing
 * the version away would mean recompiling to ask again.
 */
export async function cancelGoLiveRequest(
  db: Queryable,
  args: { graphKey: string; orgId: string | null; version?: number },
): Promise<{ version: number } | null> {
  const { rows } = await db.query<{ version: number }>(
    `UPDATE authoring.graph_versions v
        SET status             = 'compiled',
            requested_by       = NULL,
            requested_by_label = NULL,
            requested_at       = NULL
       FROM authoring.graphs g
      WHERE g.id = v.graph_id
        AND g.graph_key = $1
        AND g.org_id IS NOT DISTINCT FROM $2::uuid
        AND v.status = 'pending_go_live'
        AND ($3::int IS NULL OR v.version = $3)
      RETURNING v.version`,
    [args.graphKey, args.orgId, args.version ?? null],
  );
  return rows[0] ? { version: Number(rows[0].version) } : null;
}

/**
 * Turn the working copy into a numbered version.
 *
 * The step the editor was missing. `compileVersion` above is the agent path,
 * where the number comes from the policy; a workflow authored in the editor
 * has no policy, so the number is allocated here — the next one after the
 * highest that exists, counting retired ones, because a version number must
 * never be reused. A run pinned to v4 has to mean one thing for ever.
 *
 * The draft is left exactly where it is. Compiling is taking a copy, not
 * moving it: the author carries on editing, and what they were working on is
 * not silently different from what they just sent for review.
 *
 * Returns null when there is no draft, so the caller says so rather than
 * creating an empty version nobody can run.
 */
export async function compileDraft(
  db: Queryable,
  args: { graphKey: string; orgId: string | null; by?: string | null },
): Promise<{ version: number; checksum: string } | null> {
  const { rows: draft } = await db.query<{
    graph_id: string;
    definition: unknown;
    checksum: string;
  }>(
    `SELECT d.graph_id::text AS graph_id, d.definition, d.checksum
       FROM authoring.graph_drafts d
       JOIN authoring.graphs g ON g.id = d.graph_id
      WHERE g.graph_key = $1 AND g.org_id IS NOT DISTINCT FROM $2::uuid`,
    [args.graphKey, args.orgId],
  );
  if (!draft[0]) return null;

  const { userId, label } = await attribution(db, args.by);

  const { rows } = await db.query<{ version: number }>(
    `INSERT INTO authoring.graph_versions
       (graph_id, org_id, version, definition, checksum, status,
        compiled_by, compiled_by_label, compiled_at)
     SELECT $1::uuid, $2::uuid,
            coalesce(max(v.version), 0) + 1,
            $3::jsonb, $4, 'compiled', $5::uuid, $6, now()
       FROM authoring.graph_versions v
      WHERE v.graph_id = $1::uuid
     RETURNING version`,
    [
      draft[0].graph_id,
      args.orgId,
      JSON.stringify(draft[0].definition),
      draft[0].checksum,
      userId,
      label,
    ],
  );

  return { version: Number(rows[0]!.version), checksum: draft[0].checksum };
}
