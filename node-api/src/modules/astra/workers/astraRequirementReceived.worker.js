const astraRepo = require("../repositories/astra.repository");
const astraIntelligenceService = require("../services/astraIntelligence.service");
const { getBoss } = require("../../../config/queue");
const { withTransaction } = require("../../../config/db");
const log = require("../../../utils/logger");
const env = require("../../../config/env");

/**
 * Core handler for the 'astra.requirement.received' event.
 *
 * Responsibilities:
 * 1. Validate payload has jobId.
 * 2. Load the persisted requirement from core.requirements.
 * 3. Enforce idempotency: skip execution if job is already processed.
 * 4. Mark job processing status in database.
 * 5. Run unified ASTRA Requirement Intelligence Enrichment (parsing, normalization, quality scoring, summarization).
 * 6. Persist enriched requirement attributes (preserving ASTRA's existing summary_hash content fingerprint).
 * 7. Emit 'astra.requirement.normalized' event for downstream Orchestrator consumption.
 * 8. Surface errors cleanly to allow pg-boss retry handling.
 *
 * @param {Object} job pg-boss job object containing { data: { jobId, sourceType, sourceName } }
 * @returns {Promise<Object>} Processing outcome summary
 */
async function handleAstraRequirementReceived(job) {
  const data = job.data || {};
  const payload = data.payload_ref || {};
  const jobId = payload.requirement_id || payload.jobId || data.jobId;
  const correlationId = data.correlation_id || data.correlationId;
  const eventId = data.event_id || data.eventId;

  const sourceType = payload.channel_type || data.sourceType || "email";
  const sourceName = data.sourceName || "email";

  if (!jobId) {
    throw new Error("[astra.requirement.received] missing jobId in job data");
  }

  /**
   * When the orchestrator's ASTRA workflow owns enrichment, this worker does
   * nothing: it would run the same LLM call and announce the same
   * `astra.requirement.normalized` a second time, which starts everything
   * bound to that event twice. `astra.service.js` stops enqueueing under the
   * same flag; this is the net that catches jobs already on the queue when
   * the flag was flipped.
   */
  if (env.ORCH_DELEGATE_ASTRA && env.PLATFORM_EVENTS_ENABLED) {
    log.info(
      `[astra.requirement.received] ORCH_DELEGATE_ASTRA=1 — enrichment deferred to the ASTRA workflow (job ${jobId})`,
    );
    return { status: "skipped", reason: "delegated_to_orchestrator", jobId };
  }

  // 1. Load persisted requirement record
  const requirement = await astraRepo.getRequirementById(jobId);
  if (!requirement) {
    throw new Error(`[astra.requirement.received] Requirement not found for jobId: ${jobId}`);
  }

  // 2. Idempotency guard: prevent duplicate downstream processing on retried events
  if (requirement.processing_status === "processed" && requirement.processed_at) {
    log.info(`[astra.requirement.received] Job ${jobId} already processed (idempotent skip)`);
    return {
      status: "skipped",
      reason: "already_processed",
      jobId,
      sourceType,
      sourceName,
    };
  }

  const rawText = (requirement.raw_text || "").trim();
  if (!rawText) {
    await astraRepo.markFailed(jobId, "Requirement raw_text is empty — intake failed to provide content");
    throw new Error(`[astra.requirement.received] Job ${jobId} has empty raw_text`);
  }

  // 3. Mark processing started
  await astraRepo.markProcessing(jobId);

  try {
    // 4. Run unified ASTRA Requirement Intelligence Enrichment
    const enriched = await astraIntelligenceService.enrichRequirement(requirement);

    // 5. Persist enriched requirement fields and write platform event to outbox transactionally
    const { platformEventId } = await withTransaction(async (client) => {
      await astraRepo.updateEnrichedRequirement(jobId, enriched, client);

      const outboxRepo = require("../../../repositories/outbox.repository");
      const outboxResult = await outboxRepo.insertEvent(client, {
        eventType: "astra.requirement.normalized",
        organizationId: requirement.org_id,
        aggregateType: "requirement",
        aggregateId: jobId,
        correlationId: correlationId,
        causationId: eventId,
        producer: "astra-intelligence",
        payload: {
          requirement_id: jobId,
          parser_version: "astra-intelligence-v1",
          is_actionable: Boolean(enriched.isActionable),
          confidence_score: Number(enriched.confidenceScore || 0)
        }
      });
      return { platformEventId: outboxResult.event_id };
    });

    log.info(`[astra.requirement.received] Job ${jobId} (source: ${sourceType}/${sourceName}) enriched and platform event written to outbox (correlationId: ${correlationId})`);

    // 6. Emit downstream orchestration event: 'astra.requirement.normalized'
    // Under the new outbox relay architecture, we rely on the outbox relay to publish.
    // We do not directly publish to the queue.
    const eventPublished = true;

    return {
      status: "completed",
      jobId,
      sourceType,
      sourceName,
      isActionable: enriched.isActionable,
      confidenceScore: enriched.confidenceScore,
      eventPublished,
      platformEventId
    };
  } catch (err) {
    await astraRepo.markFailed(jobId, err.message);
    log.error(`[astra.requirement.received] Processing failed for job ${jobId}: ${err.message}`);
    throw err;
  }
}

/**
 * Registers the 'astra.requirement.received' queue worker with pg-boss.
 *
 * @param {import("pg-boss")} boss
 */
function registerAstraRequirementReceivedWorker(boss) {
  return boss.work("module.astra.requirement", async ([job]) => {
    try {
      await handleAstraRequirementReceived(job);
    } catch (err) {
      const data = job?.data || {};
      const payload = data.payload_ref || {};
      const jobId = payload.requirement_id || payload.jobId || data.jobId || "?";
      log.error(
        `[module.astra.requirement] FAILED job=${jobId} pgBossId=${job?.id}: ${err.message}`
      );
      log.error(err.stack || err);
      throw err;
    }
  });
}

module.exports = {
  handleAstraRequirementReceived,
  registerAstraRequirementReceivedWorker,
};
