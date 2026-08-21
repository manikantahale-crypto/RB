const platformEvents = require("./platformEvents.service");

/** Shared match enqueue — writes platform event + optional internal worker. */
async function enqueueMatchRequest({
  jobId,
  candidateId,
  resumeId,
  skillMatchScore,
  correlationId,
  causationId,
}) {
  return platformEvents.requestMatchScoring({
    jobId,
    candidateId,
    resumeId,
    skillMatchScore,
    correlationId,
    causationId,
  });
}

module.exports = { enqueueMatchRequest };
