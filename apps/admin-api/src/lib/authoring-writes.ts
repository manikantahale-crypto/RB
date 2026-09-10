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
