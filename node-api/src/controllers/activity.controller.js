const activityRepo = require("../repositories/activity.repository");
const { withTransaction } = require("../config/db");
const {
  shouldDelegateOrbit,
  resolveOrgId,
  queueActivityNoteRequested,
} = require("../services/orbit/orbitDelegate.service");
const { executeActivityNote } = require("../services/orbit/orbitExecute.service");
const {
  emitAndMaybePublish,
  publishToOrchFailOpen,
} = require("../services/orbit/orbitOutbox");

async function getActivities(req, res, next) {
  try {
    const { candidateId } = req.params;
    const { limit, before } = req.query;

    const activities = await activityRepo.getActivitiesForCandidate(candidateId, {
      limit,
      before,
    });

    res.json({ data: activities });
  } catch (err) {
    next(err);
  }
}

async function createNote(req, res, next) {
  try {
    const candidateId = req.params.candidateId || req.body?.candidate_id;
    const { summary, payload } = req.body || {};

    if (!candidateId || !summary) {
      const err = new Error("candidateId and summary are required");
      err.statusCode = 400;
      throw err;
    }

    if (shouldDelegateOrbit()) {
      const envelope = await queueActivityNoteRequested(req, candidateId, {
        summary,
        payload,
      });
      return res.status(202).json({
        status: "orchestration_accepted",
        event_id: envelope?.event_id ?? null,
        correlation_id: envelope?.correlation_id ?? null,
        message:
          "Note queued — ORBIT activity graph will run via module.orbit.bench",
      });
    }

    const orgId = resolveOrgId(req, req.body);
    const { activity, outboxEvent } = await withTransaction(async (client) => {
      const created = await executeActivityNote(client, {
        candidateId,
        summary,
        payload: payload || {},
        actorId: req.userId || null,
      });

      const outboxEvent = await emitAndMaybePublish(client, {
        eventType: "orbit.activity.noted",
        aggregateType: "candidate",
        aggregateId: candidateId,
        producer: "sao.orbit.activity",
        organizationId: orgId,
        payload: {
          candidate_id: candidateId,
          summary,
        },
      });

      return { activity: created, outboxEvent };
    });

    publishToOrchFailOpen(outboxEvent);
    res.status(201).json(activity);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getActivities,
  createNote,
};
