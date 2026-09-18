import { sql } from '../db';

export async function findCandidateForEmail(
  fromEmail: string,
  subject: string,
  body: string,
): Promise<{ id: string; name: string; email: string | null } | null> {
  const combinedText = `${subject} ${body}`.toLowerCase();
  const from = String(fromEmail || '').trim().toLowerCase();

  try {
    if (from && from.includes('@')) {
      const byEmail = await sql<{ id: string; name: string; email: string | null }[]>`
        SELECT id::text AS id, full_name AS name, email::text AS email
          FROM core.people
         WHERE lower(trim(email::text)) = ${from} AND deleted_at IS NULL
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 5
      `;
      if (byEmail.length === 1) {
        return byEmail[0];
      }
      if (byEmail.length > 1) {
        const named = byEmail.find((c) => {
          const fullName = (c.name || '').toLowerCase();
          const firstName = fullName.split(' ')[0];
          return (firstName.length > 2 && combinedText.includes(firstName)) || (fullName && combinedText.includes(fullName));
        });
        if (named) return named;
      }
    }

    const rows = await sql`
      SELECT id::text AS id, full_name AS name, email::text AS email
        FROM core.people
       WHERE deleted_at IS NULL
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 500
    `;

    for (const c of rows) {
      const firstName = (c.name || '').split(' ')[0].toLowerCase();
      const fullName = (c.name || '').toLowerCase();

      if (firstName.length > 2 && (combinedText.includes(firstName) || combinedText.includes(fullName))) {
        return { id: c.id, name: c.name, email: c.email };
      }
    }
  } catch (error) {
    console.error('Error finding candidate in core.people:', error);
  }

  return null;
}
