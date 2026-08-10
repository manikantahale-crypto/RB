import type { Pool } from 'pg';

export interface GraphDefinition {
  id: string;
  org_id: string | null;
  graph_key: string;
  version: number;
  definition: Record<string, any>;
  checksum: string;
  status: string;
}

export class DBRunbookResolver {
  private pool: Pool;
  
  private eventToGraphMap: Record<string, string> = {
    'jd.uploaded': 'syntra.jd.workflow',
    'resume.uploaded': 'syntra.resume.workflow',
    'match.requested': 'syntra.match.workflow'
  };

  constructor(pool: Pool) {
    this.pool = pool;
  }

  public async resolve(eventType: string, orgId?: string): Promise<GraphDefinition> {
    const graphKey = this.eventToGraphMap[eventType];
    if (!graphKey) {
      throw new Error(`No workflow mapping found for event type: ${eventType}`);
    }

    const { rows } = await this.pool.query(
      `SELECT id, org_id, graph_key, version, definition, checksum, status
       FROM graph_definitions
       WHERE graph_key = $1 AND status = 'active'
       ORDER BY org_id NULLS LAST`,
      [graphKey]
    );

    if (rows.length === 0) {
      throw new Error(`No active graph definition found for ${graphKey}`);
    }

    // Filter by orgId if provided, else fallback to global (org_id IS NULL)
    let activeDefs = rows;
    if (orgId) {
      const orgSpecific = rows.filter(r => r.org_id === orgId);
      if (orgSpecific.length > 0) {
        activeDefs = orgSpecific;
      } else {
        activeDefs = rows.filter(r => r.org_id === null);
      }
    } else {
      activeDefs = rows.filter(r => r.org_id === null);
    }

    if (activeDefs.length === 0) {
      throw new Error(`No active graph definition found for ${graphKey} and org ${orgId || 'global'}`);
    }

    if (activeDefs.length > 1) {
      throw new Error(`Multiple active graph definitions found for ${graphKey}. Ambiguous resolution.`);
    }

    return activeDefs[0];
  }
}
