/**
 * Who can sign in, and which customer they are acting for.
 *
 * Reads `platform.users` and `platform.org_members`, not `syntra.users`.
 *
 * WHY THE MOVE
 *
 * There were two user tables holding different halves of one person:
 * `syntra.users` had the passwords and no organisation, `public.users` had the
 * organisation and no passwords. Login read the first, so a signed-in session
 * could not say which customer it belonged to — which is why `org_id` had to
 * be derived from `created_by` on every write instead of coming from the
 * session, and why row-level security had nothing to read.
 *
 * `platform.users` is one table with both halves (V20260909.14 moved the
 * hashes across; nothing was re-hashed). `platform.org_members` carries the
 * role, because a role belongs to a membership rather than to a person —
 * somebody may be an author for one agency and a viewer for another.
 */
const { pool } = require("../config/db");

/**
 * The membership a session acts under.
 *
 * One row per user today, so `LIMIT 1` is exact. When somebody belongs to two
 * organisations this becomes a choice the caller has to make — the ordering
 * below keeps it deterministic rather than arbitrary in the meantime.
 */
const MEMBERSHIP = `
  LEFT JOIN LATERAL (
    SELECT m.org_id, m.role
      FROM platform.org_members m
     WHERE m.user_id = u.id
       AND m.status = 'active'
     ORDER BY m.created_at, m.org_id
     LIMIT 1
  ) m ON true
`;

async function createUser({ fullName, email, passwordHash, role = "operator" }) {
  // A signup creates the person. It does NOT create a membership: which
  // customer somebody joins is an invitation or an admin action, not something
  // a signup form decides. Until they have one their token carries no orgId,
  // and writes fall back to the insert trigger.
  const sql = `
    INSERT INTO platform.users (id, full_name, email, password_hash, status)
    VALUES (gen_random_uuid(), $1, $2, $3, 'active')
    RETURNING id, full_name, email, created_at
  `;
  const { rows } = await pool.query(sql, [
    fullName,
    email.toLowerCase().trim(),
    passwordHash,
  ]);
  return { ...rows[0], role, organization_id: null };
}

async function findUserByEmail(email) {
  const sql = `
    SELECT u.id,
           u.full_name,
           u.email::text AS email,
           u.password_hash,
           m.role,
           m.org_id AS organization_id,
           u.created_at
      FROM platform.users u
      ${MEMBERSHIP}
     WHERE lower(u.email::text) = lower($1)
       AND u.deleted_at IS NULL
       AND u.status <> 'disabled'
  `;
  const { rows } = await pool.query(sql, [email.toLowerCase().trim()]);
  return rows[0] || null;
}

async function findUserById(id) {
  const sql = `
    SELECT u.id,
           u.full_name,
           u.email::text AS email,
           m.role,
           m.org_id AS organization_id,
           u.created_at
      FROM platform.users u
      ${MEMBERSHIP}
     WHERE u.id = $1
       AND u.deleted_at IS NULL
  `;
  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
};
