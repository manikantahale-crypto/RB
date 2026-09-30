const { pool } = require("../config/db");

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
           u.created_at
      FROM platform.users u
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
           u.created_at
      FROM platform.users u
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
