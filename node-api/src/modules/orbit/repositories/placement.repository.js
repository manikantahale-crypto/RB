/**
 * orbit.placements and orbit.revenue_arrangements — where a consultant is
 * placed and what it earns. Moved from repositories/placement.repository.js
 * on 2026-09-18 and repointed from public.orbit_* (V20260909.67): person_id
 * and org_id in the tables, candidate_id / organization_id to callers;
 * vendor_id → core.vendors (was vendor_party_id → parties, never set);
 * org_id derived by trigger.
 */
const { pool } = require("../../../config/db");

/**
 * Insert a confirmed candidate placement.
 */
async function createPlacement({
  candidateId,
  // Derived from the person by trigger when not given (V20260909.67).
  organizationId = null,
  requirementId = null,
  vendorId = null,
  clientName,
  startDate,
  endDate = null,
  confirmedBillRate,
  confirmedPayRate,
  employmentModel = "C2C",
  workMode = "ONSITE",
  location = null,
  notes = null,
  createdBy = null,
}, client = null) {
  const dbClient = client || pool;
  const sql = `
    INSERT INTO orbit.placements (
      org_id, person_id, requirement_id, vendor_id, client_name, start_date, end_date,
      confirmed_bill_rate, confirmed_pay_rate, employment_model, work_mode,
      location, status, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ACTIVE', $13, $14)
    RETURNING *, org_id AS organization_id, person_id AS candidate_id;
  `;
  const values = [
    organizationId,
    candidateId,
    requirementId,
    vendorId,
    clientName,
    startDate,
    endDate,
    confirmedBillRate,
    confirmedPayRate,
    employmentModel,
    workMode,
    location,
    notes,
    createdBy,
  ];
  const { rows } = await dbClient.query(sql, values);
  return rows[0];
}

/**
 * Fetch all placements for a candidate with active revenue arrangement.
 */
async function getPlacementsForCandidate(candidateId) {
  const sql = `
    SELECT p.*, p.org_id AS organization_id, p.person_id AS candidate_id,
           ra.id AS arrangement_id,
           ra.arrangement_type,
           ra.value AS arrangement_value,
           ra.calculated_hourly_amount,
           ra.calculated_monthly_amount,
           ra.calculation_note
      FROM orbit.placements p
      LEFT JOIN orbit.revenue_arrangements ra
        ON ra.placement_id = p.id AND ra.is_current = true
     WHERE p.person_id = $1
     ORDER BY p.created_at DESC;
  `;
  const { rows } = await pool.query(sql, [candidateId]);
  return rows;
}

/**
 * Fetch single placement by ID.
 */
async function getPlacementById(placementId) {
  const sql = `
    SELECT *, org_id AS organization_id, person_id AS candidate_id FROM orbit.placements WHERE id = $1;
  `;
  const { rows } = await pool.query(sql, [placementId]);
  return rows[0] || null;
}

/**
 * Update placement fields (status, end_date, notes).
 */
async function updatePlacement(placementId, { status, endDate, notes } = {}) {
  const updates = [];
  const values = [placementId];
  let idx = 2;

  if (status !== undefined) {
    updates.push(`status = $${idx++}`);
    values.push(status);
  }
  if (endDate !== undefined) {
    updates.push(`end_date = $${idx++}`);
    values.push(endDate);
  }
  if (notes !== undefined) {
    updates.push(`notes = $${idx++}`);
    values.push(notes);
  }

  updates.push(`updated_at = now()`);

  const sql = `
    UPDATE orbit.placements
       SET ${updates.join(", ")}
     WHERE id = $1
     RETURNING *, org_id AS organization_id, person_id AS candidate_id;
  `;
  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

/**
 * Save a revenue arrangement for a placement.
 * Deactivates existing active arrangements for the placement.
 */
async function createRevenueArrangement({
  placementId,
  // Derived from the placement by trigger when not given (V20260909.67).
  organizationId = null,
  arrangementType,
  value,
  calculatedHourlyAmount = null,
  calculatedMonthlyAmount = null,
  calculationNote = null,
  notes = null,
  customFormula = null,
  createdBy = null,
}, client = null) {
  const dbClient = client || pool;

  // Mark prior arrangements not current
  await dbClient.query(
    `UPDATE orbit.revenue_arrangements SET is_current = false WHERE placement_id = $1`,
    [placementId]
  );

  const sql = `
    INSERT INTO orbit.revenue_arrangements (
      org_id, placement_id, arrangement_type, value, calculated_hourly_amount,
      calculated_monthly_amount, calculation_note, notes, custom_formula,
      is_current, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)
    RETURNING *, org_id AS organization_id;
  `;
  const values = [
    organizationId,
    placementId,
    arrangementType,
    value,
    calculatedHourlyAmount,
    calculatedMonthlyAmount,
    calculationNote,
    notes,
    customFormula,
    createdBy,
  ];
  const { rows } = await dbClient.query(sql, values);
  return rows[0];
}

/**
 * Fetch full revenue arrangement history for a placement.
 */
async function getRevenueHistory(placementId) {
  const sql = `
    SELECT *
      FROM orbit.revenue_arrangements
     WHERE placement_id = $1
     ORDER BY created_at DESC;
  `;
  const { rows } = await pool.query(sql, [placementId]);
  return rows;
}

module.exports = {
  createPlacement,
  getPlacementsForCandidate,
  getPlacementById,
  updatePlacement,
  createRevenueArrangement,
  getRevenueHistory,
};
