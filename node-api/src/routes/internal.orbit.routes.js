const express = require("express");
const { withTransaction } = require("../config/db");
const log = require("../utils/logger");
const lifecycleRepo = require("../repositories/lifecycle.repository");
const {
  executeLifecycleTransition,
  executeActivityNote,
  executeCreatePlacement,
  executeRevenueArrangement,
} = require("../services/orbit/orbitExecute.service");

const router = express.Router();

/** Orchestrator callback — apply lifecycle transition (no outbox; graph emits outcomes). */
router.post("/internal/orbit/candidates/:candidateId/lifecycle/transition", async (req, res) => {
  const { candidateId } = req.params;
  const { to_state, note, context, organization_id, transitioned_by } = req.body || {};

  try {
    if (!to_state) {
      return res.status(400).json({ error: "to_state is required" });
    }
    if (!lifecycleRepo.CANONICAL_STATUSES.includes(to_state)) {
      return res.status(400).json({
        error: `Invalid status: ${to_state}`,
      });
    }

    const result = await withTransaction((client) =>
      executeLifecycleTransition(client, {
        candidateId,
        toState: to_state,
        note: note || null,
        context: context || null,
        organizationId: organization_id,
        transitionedBy: transitioned_by || null,
      }),
    );

    res.json({
      state: result.state,
      valid_transitions: lifecycleRepo.CANONICAL_STATUSES.filter((s) => s !== to_state),
      all_statuses: lifecycleRepo.CANONICAL_STATUSES,
    });
  } catch (err) {
    log.error(`[internal/orbit] lifecycle ${candidateId}: ${err.message}`);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post("/internal/orbit/candidates/:candidateId/activities", async (req, res) => {
  const { candidateId } = req.params;
  const { summary, payload, actor_id } = req.body || {};

  try {
    if (!summary) {
      return res.status(400).json({ error: "summary is required" });
    }

    const activity = await withTransaction((client) =>
      executeActivityNote(client, {
        candidateId,
        summary,
        payload: payload || {},
        actorId: actor_id || null,
      }),
    );

    res.status(201).json(activity);
  } catch (err) {
    log.error(`[internal/orbit] note ${candidateId}: ${err.message}`);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post("/internal/orbit/placements", async (req, res) => {
  const body = req.body || {};

  try {
    const {
      candidate_id,
      client_name,
      start_date,
      confirmed_bill_rate,
      confirmed_pay_rate,
    } = body;

    if (!candidate_id || !client_name || !start_date || !confirmed_bill_rate || !confirmed_pay_rate) {
      return res.status(400).json({
        error:
          "Required: candidate_id, client_name, start_date, confirmed_bill_rate, confirmed_pay_rate",
      });
    }

    const billRate = parseFloat(confirmed_bill_rate);
    const payRate = parseFloat(confirmed_pay_rate);
    if (isNaN(billRate) || billRate <= 0 || isNaN(payRate) || payRate <= 0) {
      return res.status(400).json({ error: "Bill rate and Pay rate must be positive numbers" });
    }

    const placement = await withTransaction((client) =>
      executeCreatePlacement(client, {
        candidateId: candidate_id,
        organizationId: body.organization_id,
        requirementId: body.requirement_id || null,
        clientName: client_name,
        startDate: start_date,
        endDate: body.end_date || null,
        confirmedBillRate: billRate,
        confirmedPayRate: payRate,
        employmentModel: body.employment_model || "C2C",
        workMode: body.work_mode || "ONSITE",
        location: body.location || null,
        notes: body.notes || null,
        createdBy: body.created_by || null,
      }),
    );

    res.status(201).json({ placement });
  } catch (err) {
    log.error(`[internal/orbit] placement: ${err.message}`);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post("/internal/orbit/placements/:placementId/revenue", async (req, res) => {
  const { placementId } = req.params;
  const body = req.body || {};

  try {
    const { arrangement_type, value } = body;
    if (!arrangement_type || value === undefined) {
      return res.status(400).json({ error: "Required: arrangement_type, value" });
    }

    const { arrangement, summary } = await withTransaction((client) =>
      executeRevenueArrangement(client, {
        placementId,
        organizationId: body.organization_id,
        arrangementType: arrangement_type,
        value,
        notes: body.notes || null,
        customFormula: body.custom_formula || null,
        createdBy: body.created_by || null,
      }),
    );

    res.status(201).json({ arrangement, summary });
  } catch (err) {
    log.error(`[internal/orbit] revenue ${placementId}: ${err.message}`);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

module.exports = router;
