const lifecycleRepo = require("../repositories/lifecycle.repository");
const { withTransaction } = require("../../../config/db");
const {
  shouldDelegateOrbit,
  resolveOrgId,
  queueLifecycleTransitionRequested,
} = require("../services/orbitDelegate.service");
const { executeLifecycleTransition } = require("../services/orbitExecute.service");
const {
  emitAndMaybePublish,
  publishToOrchFailOpen,
} = require("../services/orbitOutbox");

async function getLifecycle(req, res, next) {
  try {
    const { candidateId } = req.params;
    const history = await lifecycleRepo.getLifecycleHistory(candidateId);
    const currentState = history[0]?.state || "AVAILABLE";
    const validTransitions = lifecycleRepo.CANONICAL_STATUSES.filter(
      (s) => s !== currentState,
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
        `Invalid status: ${to_state}. Must be one of: ${lifecycleRepo.CANONICAL_STATUSES.join(", ")}`,
      );
      err.statusCode = 400;
      throw err;
    }

    if (shouldDelegateOrbit()) {
      const envelope = await queueLifecycleTransitionRequested(req, candidateId, {
        to_state,
        note,
        context,
      });
      return res.status(202).json({
        status: "orchestration_accepted",
        event_id: envelope?.event_id ?? null,
        correlation_id: envelope?.correlation_id ?? null,
        message:
          "Lifecycle transition queued — ORBIT graph will run via module.orbit.bench",
        requested_state: to_state,
      });
    }

    const orgId = resolveOrgId(req, req.body);
    const { result, outboxEvents } = await withTransaction(async (client) => {
      const exec = await executeLifecycleTransition(client, {
        candidateId,
        toState: to_state,
        note: note || null,
        context: context || null,
        organizationId: orgId,
        transitionedBy: req.userId || null,
      });

      const events = [];
      const transitioned = await emitAndMaybePublish(client, {
        eventType: "orbit.lifecycle.transitioned",
        aggregateType: "candidate",
        aggregateId: candidateId,
        producer: "sao.orbit.lifecycle",
        organizationId: orgId,
        payload: {
          candidate_id: candidateId,
          from_state: exec.fromState,
          to_state,
          ...(note ? { note } : {}),
        },
      });
      if (transitioned) events.push(transitioned);

      if (to_state === "HOLD" || to_state === "IGNORE") {
        const hold = await emitAndMaybePublish(client, {
          eventType: "orbit.bench.hold",
          aggregateType: "candidate",
          aggregateId: candidateId,
          producer: "sao.orbit.lifecycle",
          organizationId: orgId,
          correlationId: transitioned?.correlation_id,
          payload: {
            candidate_id: candidateId,
            to_state,
            ...(note ? { reason: note } : {}),
          },
        });
        if (hold) events.push(hold);
      }

      return { result: exec.state, outboxEvents: events };
    });

    for (const ev of outboxEvents) {
      publishToOrchFailOpen(ev);
    }

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
