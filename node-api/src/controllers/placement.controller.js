const placementRepo = require("../repositories/placement.repository");
const lifecycleRepo = require("../repositories/lifecycle.repository");
const activityRepo = require("../repositories/activity.repository");
const { calculateTotalProfitTillToday } = require("../utils/profitability");
const { withTransaction } = require("../config/db");
const env = require("../config/env");
const {
  emitAndMaybePublish,
  publishToOrchFailOpen,
} = require("../services/orbit/orbitOutbox");

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

    const orgId =
      env.ORCH_ORGANIZATION_ID ||
      req.body?.organization_id ||
      req.user?.organizationId ||
      req.headers["x-organization-id"] ||
      req.userId ||
      undefined;

    const { placement, outboxEvent } = await withTransaction(async (client) => {
      const created = await placementRepo.createPlacement(
        {
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
        },
        client
      );

      // Record lifecycle state transition to PLACED
      await lifecycleRepo.recordTransition(
        {
          candidateId: candidate_id,
          organizationId: orgId,
          toState: "PLACED",
          fromState: "BENCH",
          note: `Placed at ${client_name}`,
          context: { placement_id: created.id },
          transitionedBy: req.userId || null,
        },
        client
      );

      // Log activity
      await activityRepo.createActivity(
        {
          candidateId: candidate_id,
          activityType: "PLACEMENT_CONFIRMED",
          actorType: "USER",
          actorId: req.userId || null,
          summary: `Placed at ${client_name} — Bill: $${billRate}/hr, Pay: $${payRate}/hr`,
          payload: {
            placement_id: created.id,
            client_name,
            confirmed_bill_rate: billRate,
            confirmed_pay_rate: payRate,
          },
        },
        client
      );

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

    const billRate = parseFloat(placement.confirmed_bill_rate);
    const payRate = parseFloat(placement.confirmed_pay_rate);
    const spread = billRate - payRate;
    const numericValue = parseFloat(value);

    let calculatedAmount = 0;
    let calculationNote = "";

    switch (arrangement_type) {
      case "MARKUP":
        calculatedAmount = payRate * (numericValue / 100);
        calculationNote = `${numericValue}% markup on pay rate $${payRate}/hr = $${calculatedAmount.toFixed(2)}/hr`;
        break;
      case "MARGIN":
        calculatedAmount = billRate * (numericValue / 100);
        calculationNote = `${numericValue}% margin on bill rate $${billRate}/hr = $${calculatedAmount.toFixed(2)}/hr`;
        break;
      case "FLAT_FEE":
        calculatedAmount = numericValue;
        calculationNote = `Flat fee arrangement: $${numericValue}`;
        break;
      case "SPREAD":
        calculatedAmount = spread;
        calculationNote = `Full spread: $${billRate}/hr - $${payRate}/hr = $${spread.toFixed(2)}/hr`;
        break;
      case "CUSTOM":
        calculatedAmount = numericValue;
        calculationNote = custom_formula || `Custom arrangement: $${numericValue}`;
        break;
      default: {
        const err = new Error(`Invalid arrangement_type: ${arrangement_type}`);
        err.statusCode = 400;
        throw err;
      }
    }

    // Monthly estimate (160 hours/month standard for hourly)
    const monthlyRevenue = arrangement_type !== "FLAT_FEE"
      ? calculatedAmount * 160
      : calculatedAmount;

    const orgId =
      env.ORCH_ORGANIZATION_ID ||
      req.body?.organization_id ||
      placement.organization_id ||
      req.user?.organizationId ||
      req.headers["x-organization-id"] ||
      req.userId ||
      undefined;

    const { result, outboxEvent } = await withTransaction(async (client) => {
      const arrangement = await placementRepo.createRevenueArrangement(
        {
          placementId,
          organizationId: orgId,
          arrangementType: arrangement_type,
          value: numericValue,
          calculatedHourlyAmount: arrangement_type !== "FLAT_FEE" ? calculatedAmount : null,
          calculatedMonthlyAmount: monthlyRevenue,
          calculationNote,
          notes: notes || null,
          customFormula: custom_formula || null,
          createdBy: req.userId || null,
        },
        client
      );

      await activityRepo.createActivity(
        {
          candidateId: placement.candidate_id,
          activityType: "REVENUE_UPDATED",
          actorType: "USER",
          actorId: req.userId || null,
          summary: `Revenue arrangement set — ${arrangement_type}: ${calculationNote}`,
          payload: {
            placement_id: placementId,
            arrangement_type,
            value: numericValue,
            calculated: calculatedAmount,
          },
        },
        client
      );

      const outboxEvent = await emitAndMaybePublish(client, {
        eventType: "orbit.revenue.arranged",
        aggregateType: "placement",
        aggregateId: placementId,
        producer: "sao.orbit.revenue",
        organizationId: orgId,
        payload: {
          placement_id: placementId,
          arrangement_type,
          value: numericValue,
        },
      });

      return { result: arrangement, outboxEvent };
    });

    publishToOrchFailOpen(outboxEvent);

    res.status(201).json({
      arrangement: result,
      summary: {
        bill_rate: billRate,
        pay_rate: payRate,
        spread,
        calculated_hourly: calculatedAmount,
        calculated_monthly: monthlyRevenue,
        calculation_note: calculationNote,
      },
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
