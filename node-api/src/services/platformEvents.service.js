const outboxRepo = require("../repositories/outbox.repository");
const env = require("../config/env");
const log = require("../utils/logger");
const PLATFORM = require("../constants/platformEvents");

function enabled() {
  return env.PLATFORM_EVENTS_ENABLED;
}

async function publish(eventType, {
  aggregateType,
  aggregateId,
  payload,
  correlationId,
  causationId,
  client,
}) {
  if (!enabled()) {
    log.info(`[platformEvents] skipped (PLATFORM_EVENTS_ENABLED=0) ${eventType}`);
    return null;
  }

  try {
    const row = await outboxRepo.insertEvent(client, {
      eventType,
      aggregateType,
      aggregateId,
      correlationId,
      causationId,
      producer: PLATFORM.PRODUCER,
      payload,
    });
    log.info(
      `[platformEvents] EMIT ${eventType} producer=${PLATFORM.PRODUCER} ` +
        `aggregate=${aggregateType}:${aggregateId} event_id=${row.event_id} ` +
        `correlation=${row.correlation_id}`,
    );
    return row;
  } catch (err) {
    log.error(
      `[platformEvents] failed ${eventType} aggregate=${aggregateId}: ${err.message}`,
    );
    if (env.PLATFORM_EVENTS_STRICT) throw err;
    return null;
  }
}

async function publishJdReceived({ jobId, title, rawText, correlationId, client }) {
  if (!env.ORCH_EMIT_JD_RECEIVED) return null;
  return publish(PLATFORM.JD_RECEIVED, {
    aggregateType: "job",
    aggregateId: jobId,
    correlationId,
    client,
    payload: {
      jobId,
      title: title || undefined,
      raw_text: rawText || undefined,
      channel_type: "UPLOAD",
      priority: "NORMAL",
    },
  });
}

async function publishJdParsed({ jobId, correlationId, causationId, client }) {
  return publish(PLATFORM.JD_PARSED, {
    aggregateType: "job",
    aggregateId: jobId,
    correlationId,
    causationId,
    client,
    payload: { jobId },
  });
}

async function publishResumeReceived({
  resumeId,
  candidateId,
  rawText,
  correlationId,
  client,
}) {
  return publish(PLATFORM.RESUME_RECEIVED, {
    aggregateType: "resume",
    aggregateId: resumeId,
    correlationId,
    client,
    payload: {
      resumeId,
      candidateId,
      raw_text: rawText || undefined,
      source: "UPLOAD",
    },
  });
}

async function publishProfilePrepared({
  resumeId,
  candidateId,
  correlationId,
  causationId,
  client,
}) {
  return publish(PLATFORM.PROFILE_PREPARED, {
    aggregateType: "resume",
    aggregateId: resumeId,
    correlationId,
    causationId,
    client,
    payload: { resumeId, candidateId },
  });
}

async function publishMatchRequested({
  jobId,
  resumeId,
  candidateId,
  skillMatchScore,
  matchId,
  correlationId,
  causationId,
  client,
}) {
  if (!matchId) {
    throw new Error(
      "publishMatchRequested requires matchId (event_outbox.aggregate_id is uuid)",
    );
  }
  return publish(PLATFORM.MATCH_REQUESTED, {
    aggregateType: "match",
    aggregateId: matchId,
    correlationId,
    causationId,
    client,
    payload: {
      jobId,
      resumeId,
      candidateId,
      skillMatchScore,
      matchId,
    },
  });
}

/**
 * Enqueue match scoring — platform event for orch, optional internal pg-boss worker.
 */
async function requestMatchScoring({
  jobId,
  candidateId,
  resumeId,
  skillMatchScore,
  matchId,
  correlationId,
  causationId,
}) {
  let aggregateId = matchId;
  if (!aggregateId) {
    const matchRepo = require("../repositories/match.repository");
    aggregateId = await matchRepo.findMatchIdByJobResume(jobId, resumeId);
  }
  if (!aggregateId) {
    throw new Error(
      `requestMatchScoring missing matchId for job=${jobId} resume=${resumeId}`,
    );
  }

  const outbox = await publishMatchRequested({
    jobId,
    resumeId,
    candidateId,
    skillMatchScore,
    matchId: aggregateId,
    correlationId,
    causationId,
  });

  if (env.ORCH_DELEGATE_MATCH) {
    log.info(
      `[platformEvents] DELEGATE syntra.match.requested → orchestrator ` +
        `job=${jobId} resume=${resumeId} candidate=${candidateId} ` +
        `(binding must be active in graph_event_bindings)`,
    );
    return { delegated: true, outbox };
  }

  log.info(
    `[platformEvents] ENQUEUE internal match.requested worker ` +
      `job=${jobId} resume=${resumeId} (ORCH_DELEGATE_MATCH=0)`,
  );
  const { getBoss } = require("../config/queue");
  await getBoss().send("match.requested", {
    jobId,
    candidateId,
    resumeId,
    skillMatchScore,
  });
  return { delegated: false, outbox };
}

async function publishDuplicateReviewRequired({
  duplicateReviewId,
  candidateA,
  candidateB,
  signals,
  correlationId,
  client,
}) {
  return publish("syntra.duplicate.review_required", {
    aggregateType: "duplicate_review",
    aggregateId: duplicateReviewId,
    correlationId,
    client,
    payload: {
      duplicate_review_id: duplicateReviewId,
      candidate_a: candidateA,
      candidate_b: candidateB,
      signals: signals || {},
    },
  });
}

module.exports = {
  publishJdReceived,
  publishJdParsed,
  publishResumeReceived,
  publishProfilePrepared,
  publishMatchRequested,
  publishDuplicateReviewRequired,
  requestMatchScoring,
};
