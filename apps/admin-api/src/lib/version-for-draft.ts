/**
 * The version that IS the working copy, compiling only if it has moved.
 *
 * WHY THIS IS SHARED RATHER THAN WRITTEN TWICE.
 *
 * Two paths need a numbered version for what is on screen: testing pins a run
 * to one, and sending for approval asks somebody to review one. Both must
 * answer with the SAME version when nothing has changed between them —
 * otherwise you test v1, send v2, and the approver reviews something nobody
 * ran.
 *
 * `compileDraft` always inserts, so calling it on every send mints a version
 * per press. Withdraw and send again and you get v2, v3, v4 of an identical
 * definition, and the screen that said "v1" sent v2.
 *
 * The checksum is what makes reuse decidable: `graph_drafts` and
 * `graph_versions` both carry one, and a version whose checksum equals the
 * draft's IS the draft.
 */

export type Queryable = {
  query: (
    sql: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type DraftVersion =
  | { ok: true; version: number; checksum: string; compiled: boolean }
  | { ok: false; reason: "nothing_to_compile"; message: string };

export async function versionForDraft(
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
): Promise<DraftVersion> {
  const draft = await db.query(
    `SELECT d.checksum
       FROM authoring.graph_drafts d
       JOIN authoring.graphs g ON g.id = d.graph_id
      WHERE g.graph_key = $1 AND g.org_id IS NOT DISTINCT FROM $2::uuid`,
    [args.graphKey, args.orgId],
  );

  /**
   * No working copy: nothing has been edited since the last version, so the
   * newest one already is what is on screen.
   */
  if (!draft.rows[0]) {
    const newest = await db.query(
      `SELECT v.version, v.checksum
         FROM authoring.graph_versions v
         JOIN authoring.graphs g ON g.id = v.graph_id
        WHERE g.graph_key = $1 AND g.org_id IS NOT DISTINCT FROM $2::uuid
        ORDER BY v.version DESC
        LIMIT 1`,
      [args.graphKey, args.orgId],
    );
    const row = newest.rows[0];
    if (!row) {
      return {
        ok: false,
        reason: "nothing_to_compile",
        message: `${args.graphKey} has no version and no working copy.`,
      };
    }
    return {
      ok: true,
      compiled: false,
      version: Number(row.version),
      checksum: String(row.checksum),
    };
  }

  const draftChecksum = String(draft.rows[0].checksum);

  // Already frozen, unchanged since. Reuse rather than minting a twin.
  const same = await db.query(
    `SELECT v.version
       FROM authoring.graph_versions v
       JOIN authoring.graphs g ON g.id = v.graph_id
      WHERE g.graph_key = $1 AND g.org_id IS NOT DISTINCT FROM $2::uuid
        AND v.checksum = $3
      ORDER BY v.version DESC
      LIMIT 1`,
    [args.graphKey, args.orgId, draftChecksum],
  );
  if (same.rows[0]) {
    return {
      ok: true,
      compiled: false,
      version: Number(same.rows[0].version),
      checksum: draftChecksum,
    };
  }

  const built = await args.compileDraft({
    graphKey: args.graphKey,
    orgId: args.orgId,
    by: args.by,
  });
  if (!built) {
    return {
      ok: false,
      reason: "nothing_to_compile",
      message: `${args.graphKey} has nothing to compile.`,
    };
  }
  return { ok: true, compiled: true, version: built.version, checksum: built.checksum };
}
