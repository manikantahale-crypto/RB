const { pool } = require("../config/db");

async function createUser({ fullName, email, passwordHash, role = "Recruiter" }) {
  const sql = `
    INSERT INTO syntra.users (full_name, email, password_hash, role)
    VALUES ($1, $2, $3, $4)
    RETURNING id, full_name, email, role, created_at
  `;
  const { rows } = await pool.query(sql, [
    fullName,
    email.toLowerCase().trim(),
    passwordHash,
    role,
  ]);
  return rows[0];
}

async function findUserByEmail(email) {
  const sql = `
    SELECT id, full_name, email, password_hash, role, created_at
      FROM syntra.users
     WHERE lower(email) = lower($1)
  `;
  const { rows } = await pool.query(sql, [email.toLowerCase().trim()]);
  return rows[0] || null;
}

async function findUserById(id) {
  const sql = `
    SELECT id, full_name, email, role, created_at
      FROM syntra.users
     WHERE id = $1
  `;
  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
};
