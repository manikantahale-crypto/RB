const activityRepo = require("../repositories/activity.repository");
const { withTransaction } = require("../config/db");
const env = require("../config/env");
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

    const orgId =
      env.ORCH_ORGANIZATION_ID ||
      req.body?.organization_id ||
      req.user?.organizationId ||
      req.headers["x-organization-id"] ||
      req.userId ||
      undefined;

    const { activity, outboxEvent } = await withTransaction(async (client) => {
      const created = await activityRepo.createActivity(
        {
          candidateId,
          activityType: "NOTE",
          actorType: "USER",
          actorId: req.userId || null,
          summary,
          payload: payload || {},
        },
        client,
      );

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
