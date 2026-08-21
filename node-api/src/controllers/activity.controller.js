const activityRepo = require("../repositories/activity.repository");

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

    const activity = await activityRepo.createActivity({
      candidateId,
      activityType: "NOTE",
      actorType: "USER",
      actorId: req.userId || null,
      summary,
      payload: payload || {},
    });

    res.status(201).json(activity);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getActivities,
  createNote,
};
