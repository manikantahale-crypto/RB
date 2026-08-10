import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

/** Minimal query surface shared by Pool and PoolClient. */
export type DbQueryable = {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<T>>;
};

const ORG_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` inside a transaction with `app.org_id` set (design §9.2 / §11).
 * `SET LOCAL` via set_config(..., is_local=true) so pooled connections
 * cannot leak tenant context to the next borrower.
 */
export async function withOrgConnection<T>(
  pool: Pool,
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!ORG_ID_RE.test(orgId)) {
    throw new Error(`withOrgConnection: invalid orgId "${orgId}"`);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
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
