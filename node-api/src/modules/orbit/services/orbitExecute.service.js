const lifecycleRepo = require("../repositories/lifecycle.repository");
const activityRepo = require("../../../repositories/activity.repository");
const placementRepo = require("../repositories/placement.repository");
const { calculateTotalProfitTillToday } = require("../utils/profitability");
const log = require("../../../utils/logger");

/** Apply lifecycle transition — DB only (outcomes emitted by orchestrator graph). */
async function executeLifecycleTransition(
  client,
  {
    candidateId,
    toState,
    note = null,
    context = null,
    organizationId,
    transitionedBy = null,
  },
) {
  const current = await lifecycleRepo.getLatestLifecycleState(candidateId);
  const fromState = current?.state || "AVAILABLE";

  const newState = await lifecycleRepo.recordTransition(
    {
      candidateId,
      organizationId,
      toState,
      fromState,
      note,
      context,
      transitionedBy,
    },
    client,
  );

  await activityRepo.createActivity(
    {
      candidateId,
      activityType: "LIFECYCLE_CHANGED",
      actorType: transitionedBy ? "USER" : "SYSTEM",
      actorId: transitionedBy,
      summary: `Status updated: ${fromState} → ${toState}${note ? ` — ${note}` : ""}`,
      payload: { from_state: fromState, to_state: toState, note, context },
    },
    client,
  );

  log.info(
    `[orbit.execute] lifecycle ${candidateId} ${fromState}→${toState}`,
  );

  return {
    state: { ...newState, previous_state: fromState },
    fromState,
    toState,
  };
}

/** Persist recruiter note — DB only. */
async function executeActivityNote(
  client,
  { candidateId, summary, payload = {}, actorId = null },
) {
  const activity = await activityRepo.createActivity(
    {
      candidateId,
      activityType: "NOTE",
      actorType: actorId ? "USER" : "SYSTEM",
      actorId,
      summary,
      payload,
    },
    client,
  );

  log.info(`[orbit.execute] note candidate=${candidateId}`);
  return activity;
}

/** Create placement + lifecycle PLACED — DB only. */
async function executeCreatePlacement(client, fields) {
  const {
    candidateId,
    organizationId,
    requirementId = null,
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
  } = fields;

  const placement = await placementRepo.createPlacement(
    {
      candidateId,
      organizationId,
      requirementId,
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
    },
    client,
  );

  await lifecycleRepo.recordTransition(
    {
      candidateId,
      organizationId,
      toState: "PLACED",
      fromState: "BENCH",
      note: `Placed at ${clientName}`,
      context: { placement_id: placement.id },
      transitionedBy: createdBy,
    },
    client,
  );

  await activityRepo.createActivity(
    {
      candidateId,
      activityType: "PLACEMENT_CONFIRMED",
      actorType: createdBy ? "USER" : "SYSTEM",
      actorId: createdBy,
      summary: `Placed at ${clientName} — Bill: $${confirmedBillRate}/hr, Pay: $${confirmedPayRate}/hr`,
      payload: {
        placement_id: placement.id,
        client_name: clientName,
        confirmed_bill_rate: confirmedBillRate,
        confirmed_pay_rate: confirmedPayRate,
      },
    },
    client,
  );

  log.info(`[orbit.execute] placement ${placement.id} candidate=${candidateId}`);
  return placement;
}

/** Revenue arrangement — DB only. */
async function executeRevenueArrangement(client, fields) {
  const {
    placementId,
    organizationId,
    arrangementType,
    value,
    notes = null,
    customFormula = null,
    createdBy = null,
  } = fields;

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

  switch (arrangementType) {
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
      calculationNote = customFormula || `Custom arrangement: $${numericValue}`;
      break;
    default: {
      const err = new Error(`Invalid arrangement_type: ${arrangementType}`);
      err.statusCode = 400;
      throw err;
    }
  }

  const monthlyRevenue =
    arrangementType !== "FLAT_FEE" ? calculatedAmount * 160 : calculatedAmount;

  const arrangement = await placementRepo.createRevenueArrangement(
    {
      placementId,
      organizationId,
      arrangementType,
      value: numericValue,
      calculatedHourlyAmount: arrangementType !== "FLAT_FEE" ? calculatedAmount : null,
      calculatedMonthlyAmount: monthlyRevenue,
      calculationNote,
      notes,
      customFormula,
      createdBy,
    },
    client,
  );

  await activityRepo.createActivity(
    {
      candidateId: placement.candidate_id,
      activityType: "REVENUE_UPDATED",
      actorType: createdBy ? "USER" : "SYSTEM",
      actorId: createdBy,
      summary: `Revenue arrangement set — ${arrangementType}: ${calculationNote}`,
      payload: {
        placement_id: placementId,
        arrangement_type: arrangementType,
        value: numericValue,
        calculated: calculatedAmount,
      },
    },
    client,
  );

  log.info(`[orbit.execute] revenue placement=${placementId} type=${arrangementType}`);
  return {
    arrangement,
    summary: {
      bill_rate: billRate,
      pay_rate: payRate,
      spread,
      calculated_hourly: calculatedAmount,
      calculated_monthly: monthlyRevenue,
      calculation_note: calculationNote,
      total_profit_till_today: calculateTotalProfitTillToday(
        placement.start_date,
        monthlyRevenue,
      ),
    },
  };
}

module.exports = {
  executeLifecycleTransition,
  executeActivityNote,
  executeCreatePlacement,
  executeRevenueArrangement,
};
