import { sql } from '../db';

export interface RegisteredCandidate {
  id: string;
  name: string;
  email: string;
}

let cache: { map: Map<string, RegisteredCandidate>; loadedAt: number } | null = null;
const TTL = 5 * 60 * 1000;

export async function loadRegisteredCandidateMap(): Promise<Map<string, RegisteredCandidate>> {
  if (cache && Date.now() - cache.loadedAt < TTL) return cache.map;

  const map = new Map<string, RegisteredCandidate>();
  try {
    const rows = await sql<{ id: string; name: string; email: string | null }[]>`
      SELECT id::text AS id, full_name AS name, email::text AS email
        FROM core.people
       WHERE email IS NOT NULL AND TRIM(email::text) <> '' AND deleted_at IS NULL
    `;
    for (const row of rows) {
      const email = (row.email || '').trim().toLowerCase();
      if (email) map.set(email, { id: row.id, name: row.name, email });
    }
  } catch (e) {
    console.error('candidateRegistry load failed:', e);
  }

  cache = { map, loadedAt: Date.now() };
  return map;
}

export async function findRegisteredCandidateByEmail(fromEmail: string): Promise<RegisteredCandidate | null> {
  const map = await loadRegisteredCandidateMap();
  return map.get(fromEmail.trim().toLowerCase()) || null;
}

export async function findRegisteredCandidateById(candidateId: string): Promise<RegisteredCandidate | null> {
  try {
    const rows = await sql<{ id: string; name: string; email: string | null }[]>`
      SELECT id::text AS id, full_name AS name, email::text AS email
        FROM core.people
       WHERE id = ${candidateId}::uuid
       LIMIT 1
    `;
    const row = rows[0];
    if (!row?.email) return null;
    return { id: row.id, name: row.name, email: row.email };
  } catch (e) {
    console.error('findRegisteredCandidateById failed:', e);
    return null;
  }
}
