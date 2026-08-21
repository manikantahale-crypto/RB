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
  if (!enabled()) return null;

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
      `[platformEvents] ${eventType} aggregate=${aggregateType}:${aggregateId} event_id=${row.event_id}`,
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
  correlationId,
  causationId,
  client,
}) {
  return publish(PLATFORM.MATCH_REQUESTED, {
    aggregateType: "match",
    aggregateId: `${jobId}:${resumeId}`,
    correlationId,
    causationId,
    client,
    payload: {
      jobId,
      resumeId,
      candidateId,
      skillMatchScore,
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
  correlationId,
  causationId,
}) {
  const outbox = await publishMatchRequested({
    jobId,
    resumeId,
    candidateId,
    skillMatchScore,
    correlationId,
    causationId,
  });

  if (env.ORCH_DELEGATE_MATCH) {
    log.info(
      `[platformEvents] match delegated to orchestrator job=${jobId} resume=${resumeId}`,
    );
    return { delegated: true, outbox };
  }

  const { getBoss } = require("../config/queue");
  await getBoss().send("match.requested", {
    jobId,
    candidateId,
    resumeId,
    skillMatchScore,
  });
  return { delegated: false, outbox };
}

module.exports = {
  publishJdReceived,
  publishJdParsed,
  publishResumeReceived,
  publishProfilePrepared,
  publishMatchRequested,
  requestMatchScoring,
};
