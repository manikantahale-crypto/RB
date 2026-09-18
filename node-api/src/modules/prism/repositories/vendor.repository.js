/**
 * core.vendors — created and edited by PRISM, read by everyone.
 *
 * Ported from the old project's repositories/vendor.repository.js on
 * 2026-09-18; the only change is public.vendors → core.vendors (V20260909.63).
 * Reads scope by created_by, as before; the shared-read policy on the table is
 * what lets other modules see a vendor they did not create.
 */
const { pool } = require("../../../config/db");

async function insertVendor(client, data) {
  const sql = `
    INSERT INTO core.vendors (
      name, vendor_type, status, website, email, phone, linkedin, location,
      timezone, payment_terms, preferred_technologies, preferred_immigration_types, created_by
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
    )
    RETURNING *
  `;
  const values = [
    data.name,
    data.vendorType || null,
    data.status || "PENDING",
    data.website || null,
    data.email || null,
    data.phone || null,
    data.linkedin || null,
    data.location || null,
    data.timezone || null,
    data.paymentTerms || null,
    data.preferredTechnologies || null,
    data.preferredImmigrationTypes || null,
    data.createdBy,
  ];
  const { rows } = await client.query(sql, values);
  return rows[0];
}

async function listVendors(userId, filters = {}, client = pool) {
  let sql = `SELECT * FROM core.vendors WHERE created_by = $1`;
  const params = [userId];
  let paramCount = 2;

  if (filters.status) {
    sql += ` AND status = $${paramCount++}`;
    params.push(filters.status);
  }

  if (filters.vendorType) {
    sql += ` AND vendor_type = $${paramCount++}`;
    params.push(filters.vendorType);
  }

  if (filters.search) {
    sql += ` AND (name ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
    params.push(`%${filters.search}%`);
    paramCount++;
  }

  sql += ` ORDER BY created_at DESC`;

  const { rows } = await client.query(sql, params);
  return rows;
}

async function getVendorById(clientOrVendorId, vendorIdOrUserId = null, userIdOrClient = null) {
  let dbClient = pool;
  let vendorId = clientOrVendorId;
  let userId = vendorIdOrUserId;

  if (clientOrVendorId && typeof clientOrVendorId.query === "function") {
    dbClient = clientOrVendorId;
    vendorId = vendorIdOrUserId;
    userId = userIdOrClient;
  } else if (userIdOrClient && typeof userIdOrClient.query === "function") {
    dbClient = userIdOrClient;
  }

  const sql = `SELECT * FROM core.vendors WHERE id = $1 AND created_by = $2`;
  const { rows } = await dbClient.query(sql, [vendorId, userId]);
  return rows[0] || null;
}

async function findVendorByName(name, userId, client = pool) {
  // Case-insensitive duplicate check for a specific user
  const sql = `SELECT * FROM core.vendors WHERE lower(name) = lower($1) AND created_by = $2`;
  const { rows } = await client.query(sql, [name, userId]);
  return rows[0] || null;
}

async function updateVendor(client, vendorId, userId, data) {
  // Extract only the allowed fields to update
  const updates = [];
  const params = [vendorId, userId];
  let paramCount = 3;

  const allowedFields = [
    { key: "name", dbCol: "name" },
    { key: "vendorType", dbCol: "vendor_type" },
    { key: "website", dbCol: "website" },
    { key: "email", dbCol: "email" },
    { key: "phone", dbCol: "phone" },
    { key: "linkedin", dbCol: "linkedin" },
    { key: "location", dbCol: "location" },
    { key: "timezone", dbCol: "timezone" },
    { key: "paymentTerms", dbCol: "payment_terms" },
    { key: "preferredTechnologies", dbCol: "preferred_technologies" },
    { key: "preferredImmigrationTypes", dbCol: "preferred_immigration_types" },
  ];

  for (const field of allowedFields) {
    if (data[field.key] !== undefined) {
      updates.push(`${field.dbCol} = $${paramCount++}`);
      params.push(data[field.key]);
    }
  }

  if (updates.length === 0) {
    return null; // Nothing to update
  }

  updates.push(`updated_at = now()`);

  const sql = `
    UPDATE core.vendors
    SET ${updates.join(", ")}
    WHERE id = $1 AND created_by = $2
    RETURNING *
  `;

  const { rows } = await client.query(sql, params);
  return rows[0] || null;
}

async function updateVendorStatus(client, vendorId, userId, status) {
  const sql = `
    UPDATE core.vendors
    SET status = $3, updated_at = now()
    WHERE id = $1 AND created_by = $2
    RETURNING *
  `;
  const { rows } = await client.query(sql, [vendorId, userId, status]);
  return rows[0] || null;
}

module.exports = {
  insertVendor,
  listVendors,
  getVendorById,
  findVendorByName,
  updateVendor,
  updateVendorStatus,
};
