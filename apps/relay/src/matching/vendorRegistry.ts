import { sql } from '../db';

export interface RegisteredVendor {
  id: string;
  name: string;
  email: string;
}

let cached: { map: Map<string, RegisteredVendor>; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Registered vendor contacts from the application (core.vendors). */
export async function loadRegisteredVendorMap(): Promise<Map<string, RegisteredVendor>> {
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.map;
  }

  const orgId = process.env.ORCH_ORGANIZATION_ID;
  const map = new Map<string, RegisteredVendor>();

  const add = (row: { id: string; name: string; email: string }) => {
    const email = (row.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    map.set(email, { id: row.id, name: row.name || email, email });
  };

  // `parties` was the old project's first vendor list; it is not on this
  // project (ref/Data_Migration_Plan.md §2.4). core.vendors is the one source.
  try {
    const vendorRows = await sql<{ id: string; name: string; email: string | null }[]>`
      SELECT id::text AS id, COALESCE(name, 'Vendor') AS name, email
        FROM core.vendors
       WHERE email IS NOT NULL AND TRIM(email) <> ''
    `;
    for (const row of vendorRows) {
      if (row.email) add({ id: row.id, name: row.name, email: row.email });
    }
  } catch {
    // core.vendors unreachable — the registry is simply empty this round
  }

  cached = { map, loadedAt: Date.now() };
  return map;
}

/** Bust in-process vendor cache after DB updates (e.g. new registered vendors). */
export function clearRegisteredVendorCache(): void {
  cached = null;
}
