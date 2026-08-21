const lifecycleRepo = require("../repositories/lifecycle.repository");
const activityRepo = require("../repositories/activity.repository");
const { withTransaction } = require("../config/db");

async function getLifecycle(req, res, next) {
  try {
    const { candidateId } = req.params;
    const history = await lifecycleRepo.getLifecycleHistory(candidateId);
    const currentState = history[0]?.state || "AVAILABLE";
    const validTransitions = lifecycleRepo.CANONICAL_STATUSES.filter(
      (s) => s !== currentState
    );

    res.json({
      current_state: currentState,
      history,
      valid_transitions: validTransitions,
      all_statuses: lifecycleRepo.CANONICAL_STATUSES,
    });
  } catch (err) {
    next(err);
  }
}

async function transitionLifecycle(req, res, next) {
  try {
    const { candidateId } = req.params;
    const { to_state, note, context } = req.body || {};

    if (!to_state) {
      const err = new Error("to_state is required");
      err.statusCode = 400;
      throw err;
    }

    if (!lifecycleRepo.CANONICAL_STATUSES.includes(to_state)) {
      const err = new Error(
        `Invalid status: ${to_state}. Must be one of: ${lifecycleRepo.CANONICAL_STATUSES.join(", ")}`
      );
      err.statusCode = 400;
      throw err;
    }

    const orgId = req.body?.organization_id || req.user?.organizationId || req.headers["x-organization-id"] || req.userId || undefined;

    const result = await withTransaction(async (client) => {
      const current = await lifecycleRepo.getLatestLifecycleState(candidateId);
      const fromState = current?.state || "AVAILABLE";

      const newState = await lifecycleRepo.recordTransition(
        {
          candidateId,
          organizationId: orgId,
          toState: to_state,
          fromState,
          note: note || null,
          context: context || null,
          transitionedBy: req.userId || null,
        },
        client
      );

      await activityRepo.createActivity(
        {
          candidateId,
          activityType: "LIFECYCLE_CHANGED",
          actorType: "USER",
          actorId: req.userId || null,
          summary: `Status updated: ${fromState} → ${to_state}${note ? ` — ${note}` : ""}`,
          payload: { from_state: fromState, to_state, note, context },
        },
        client
      );

      return newState;
    });

    res.json({
      state: result,
      valid_transitions: lifecycleRepo.CANONICAL_STATUSES.filter((s) => s !== to_state),
      all_statuses: lifecycleRepo.CANONICAL_STATUSES,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getLifecycle,
  transitionLifecycle,
};
