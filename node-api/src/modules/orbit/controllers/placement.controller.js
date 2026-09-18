const placementRepo = require("../repositories/placement.repository");
const { calculateTotalProfitTillToday } = require("../utils/profitability");
const { withTransaction } = require("../../../config/db");
const {
  shouldDelegateOrbit,
  resolveOrgId,
  queuePlacementConfirmRequested,
  queueRevenueArrangeRequested,
} = require("../services/orbitDelegate.service");
const {
  executeCreatePlacement,
  executeRevenueArrangement,
} = require("../services/orbitExecute.service");
const {
  emitAndMaybePublish,
  publishToOrchFailOpen,
} = require("../services/orbitOutbox");

async function createPlacement(req, res, next) {
  try {
    const {
      candidate_id,
      requirement_id,
      client_name,
      start_date,
      end_date,
      confirmed_bill_rate,
      confirmed_pay_rate,
      employment_model = "C2C",
      work_mode = "ONSITE",
      location,
      notes,
    } = req.body || {};

    if (!candidate_id || !client_name || !start_date || !confirmed_bill_rate || !confirmed_pay_rate) {
      const err = new Error(
        "Required: candidate_id, client_name, start_date, confirmed_bill_rate, confirmed_pay_rate"
      );
      err.statusCode = 400;
      throw err;
    }

    const billRate = parseFloat(confirmed_bill_rate);
    const payRate = parseFloat(confirmed_pay_rate);

    if (isNaN(billRate) || billRate <= 0 || isNaN(payRate) || payRate <= 0) {
      const err = new Error("Bill rate and Pay rate must be positive numbers");
      err.statusCode = 400;
      throw err;
    }

    if (shouldDelegateOrbit()) {
      const envelope = await queuePlacementConfirmRequested(req, req.body);
      return res.status(202).json({
        status: "orchestration_accepted",
        event_id: envelope?.event_id ?? null,
        correlation_id: envelope?.correlation_id ?? null,
        message:
          "Placement queued — ORBIT placement graph will run via module.orbit.bench",
      });
    }

    const orgId = resolveOrgId(req, req.body);

    const { placement, outboxEvent } = await withTransaction(async (client) => {
      const created = await executeCreatePlacement(client, {
        candidateId: candidate_id,
        organizationId: orgId,
        requirementId: requirement_id || null,
        clientName: client_name,
        startDate: start_date,
        endDate: end_date || null,
        confirmedBillRate: billRate,
        confirmedPayRate: payRate,
        employmentModel: employment_model,
        workMode: work_mode,
        location: location || null,
        notes: notes || null,
        createdBy: req.userId || null,
      });

      const outboxEvent = await emitAndMaybePublish(client, {
        eventType: "orbit.placement.confirmed",
        aggregateType: "placement",
        aggregateId: created.id,
        producer: "sao.orbit.placement",
        organizationId: orgId,
        payload: {
          candidate_id,
          placement_id: created.id,
          client_name,
        },
      });

      return { placement: created, outboxEvent };
    });

    publishToOrchFailOpen(outboxEvent);

    res.status(201).json({ placement });
  } catch (err) {
    next(err);
  }
}

async function getPlacements(req, res, next) {
  try {
    const { candidateId } = req.params;
    const placements = await placementRepo.getPlacementsForCandidate(candidateId);

    const augmented = placements.map((p) => {
      let totalProfit = 0;
      if (p.calculated_monthly_amount && p.start_date) {
        totalProfit = calculateTotalProfitTillToday(p.start_date, p.calculated_monthly_amount);
      }
      return {
        ...p,
        total_profit_till_today: totalProfit,
      };
    });

    res.json({ data: augmented });
  } catch (err) {
    next(err);
  }
}

async function updatePlacement(req, res, next) {
  try {
    const { placementId } = req.params;
    const { status, end_date, notes } = req.body || {};

    const updated = await placementRepo.updatePlacement(placementId, {
      status,
      endDate: end_date,
      notes,
    });

    if (!updated) {
      const err = new Error(`Placement not found: ${placementId}`);
      err.statusCode = 404;
      throw err;
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

async function createRevenueArrangement(req, res, next) {
  try {
    const { placementId } = req.params;
    const {
      arrangement_type,
      value,
      notes,
      custom_formula,
    } = req.body || {};

    if (!arrangement_type || value === undefined) {
      const err = new Error("Required: arrangement_type, value");
      err.statusCode = 400;
      throw err;
    }

    const placement = await placementRepo.getPlacementById(placementId);
    if (!placement) {
      const err = new Error(`Placement not found: ${placementId}`);
      err.statusCode = 404;
      throw err;
    }

    if (shouldDelegateOrbit()) {
      const envelope = await queueRevenueArrangeRequested(req, placementId, req.body);
      return res.status(202).json({
        status: "orchestration_accepted",
        event_id: envelope?.event_id ?? null,
        correlation_id: envelope?.correlation_id ?? null,
        message:
          "Revenue arrangement queued — ORBIT revenue graph will run via module.orbit.bench",
      });
    }

    const orgId = resolveOrgId(req, req.body);

    const { result, outboxEvent } = await withTransaction(async (client) => {
      const exec = await executeRevenueArrangement(client, {
        placementId,
        organizationId: orgId,
        arrangementType: arrangement_type,
        value,
        notes: notes || null,
        customFormula: custom_formula || null,
        createdBy: req.userId || null,
      });

      const outboxEvent = await emitAndMaybePublish(client, {
        eventType: "orbit.revenue.arranged",
        aggregateType: "placement",
        aggregateId: placementId,
        producer: "sao.orbit.revenue",
        organizationId: orgId,
        payload: {
          placement_id: placementId,
          arrangement_type,
          value: parseFloat(value),
        },
      });

      return { result: exec, outboxEvent };
    });

    publishToOrchFailOpen(outboxEvent);

    res.status(201).json({
      arrangement: result.arrangement,
      summary: result.summary,
    });
  } catch (err) {
    next(err);
  }
}

async function getRevenueArrangements(req, res, next) {
  try {
    const { placementId } = req.params;
    const history = await placementRepo.getRevenueHistory(placementId);
    res.json({ data: history });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createPlacement,
  getPlacements,
  updatePlacement,
  createRevenueArrangement,
  getRevenueArrangements,
};
