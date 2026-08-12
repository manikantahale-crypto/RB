import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

export type DbQueryable = {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<T>>;
};

const ORG_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` under a transaction with `app.org_id` set (design Appendix A.7).
 * Empty / null orgId clears the GUC so global rows (org_id IS NULL) are visible
 * and writable under authoring RLS.
 */
export async function withOrgScope<T>(
  pool: Pool,
  orgId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (orgId !== null && !ORG_ID_RE.test(orgId)) {
    throw new Error(`withOrgScope: invalid orgId "${orgId}"`);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.org_id', $1, true)`, [
      orgId ?? "",
    ]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    client.release();
  }
}
