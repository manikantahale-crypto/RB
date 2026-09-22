/**
 * What three SYNTRA contract nodes call back into: bench alert, duplicate
 * merge, run retry (adapters/syntra/nodes/{bench-alert,duplicate-merge,run-retry}).
 *
 * Ported from the old project's services/internalOrchestration.service.js on
 * 2026-09-18 (ref/SYNTRA_Onboarding.md stage 4). It was missing here, so the
 * three nodes had nothing to reach — syntra.run.retry.workflow is live and has
 * never run. Repointed at core; the `agent_runs` fallback (a table this
 * project never had) is gone: a run is an orch.runs row.
 */
const { pool } = require("../../../config/db");
const log = require("../../../utils/logger");
const { runForResume } = require("../matching/funnel");
const reviewRepo = require("../repositories/recruiterReview.repository");
const outboxRepo = require("../../../repositories/outbox.repository");

async function resolveCurrentResumeId(candidateId, body) {
  if (body.candidate_profile_id || body.resumeId || body.document_id) {
    return body.candidate_profile_id || body.resumeId || body.document_id;
  }
  const { rows } = await pool.query(
    `SELECT r.id::text AS resume_id
       FROM core.resumes r
       LEFT JOIN core.processing_jobs p
         ON p.subject_type = 'resume' AND p.subject_id = r.id AND p.stage = 'extract'
      WHERE r.person_id = $1::uuid
        AND COALESCE(r.is_current, true) = true
      ORDER BY p.finished_at DESC NULLS LAST, r.created_at DESC
      LIMIT 1`,
    [candidateId],
  );
  return rows[0]?.resume_id ?? null;
}

/** profile.prepared → bench alert: rank open jobs for this candidate's resume. */
async function benchAlert(candidateId, body = {}, signal) {
  const resumeId = await resolveCurrentResumeId(candidateId, body);
  if (!resumeId) {
    const err = new Error(`no current resume for candidate ${candidateId}`);
    err.statusCode = 404;
    throw err;
  }

  const result = await runForResume(resumeId, { signal });
  const best = result.created?.[0];
  log.info(
    `[internal] bench-alert candidate=${candidateId} resume=${resumeId} matches=${result.created?.length ?? 0}`,
  );

  return {
    status: "ok",
    candidateId,
    resumeId,
    jobId: best?.jobId ?? null,
    requirement_id: best?.jobId ?? null,
    matchId: best?.matchId ?? null,
    result_count: result.created?.length ?? 0,
    top_score: best?.skillMatchScore ?? null,
  };
}

function isApprovedDecision(decision) {
  const d = String(decision ?? "").toUpperCase();
  return d === "APPROVED" || d === "YES" || d === "TRUE";
}

/** duplicate.review human gate → merge or keep separate. */
async function duplicateMerge(approvalId, body = {}) {
  await reviewRepo.ensureSchema();

  const candidateA = body.candidate_a ?? body.candidateA;
  const candidateB = body.candidate_b ?? body.candidateB;
  const approved = isApprovedDecision(body.decision);

  const bySource = await pool.query(
    `SELECT id::text FROM syntra.review_queue
      WHERE source_event_id = $1::uuid OR id = $1::uuid
      LIMIT 1`,
    [approvalId],
  );
  const reviewId = bySource.rows[0]?.id ?? null;

  if (approved && candidateA && candidateB) {
    const keepId = candidateA;
    const mergeId = candidateB;
    await pool.query(
      `UPDATE core.people
          SET status = 'Inactive'
        WHERE id = $1::uuid AND id <> $2::uuid`,
      [mergeId, keepId],
    );
    log.info(`[internal] duplicate-merge approval=${approvalId} merged ${mergeId} → ${keepId}`);
  } else {
    log.info(`[internal] duplicate-merge approval=${approvalId} kept separate decision=${body.decision ?? "unknown"}`);
  }

  if (reviewId) {
    await reviewRepo.markDecided(reviewId, {
      userId: null,
      status: approved ? "approved" : "rejected",
      note: "orchestrator duplicate.merge",
    });
  }

  return {
    status: approved ? "merged" : "kept_separate",
    approval_id: approvalId,
    candidate_a: candidateA ?? null,
    candidate_b: candidateB ?? null,
    decision: body.decision ?? null,
  };
}

/** agent_run.failed → re-emit the original trigger event (new event_id, same correlation). */
async function agentRunRetry(agentRunId, body = {}) {
  const { rows: runs } = await pool.query(
    `SELECT trigger_event_id::text AS trigger_event_id, status
       FROM orch.runs WHERE id = $1::uuid LIMIT 1`,
    [agentRunId],
  );
  const runRow = runs[0];
  if (!runRow?.trigger_event_id) {
    const err = new Error(`run ${agentRunId} has no trigger_event_id`);
    err.statusCode = 404;
    throw err;
  }

  const { rows: events } = await pool.query(
    `SELECT event_id::text, event_type, organization_id::text, correlation_id::text,
            aggregate_type, aggregate_id::text, payload_ref
       FROM orch.event_outbox
      WHERE event_id = $1::uuid
      LIMIT 1`,
    [runRow.trigger_event_id],
  );
  const original = events[0];
  if (!original) {
    const err = new Error(`trigger event ${runRow.trigger_event_id} not found in orch.event_outbox`);
    err.statusCode = 404;
    throw err;
  }

  const newRow = await outboxRepo.insertEvent(null, {
    eventType: original.event_type,
    organizationId: original.organization_id,
    aggregateType: original.aggregate_type,
    aggregateId: original.aggregate_id,
    correlationId: original.correlation_id,
    causationId: agentRunId,
    producer: "syntra.node-api",
    payload:
      typeof original.payload_ref === "object" && original.payload_ref
        ? original.payload_ref
        : {},
  });

  log.info(
    `[internal] run retry run=${agentRunId} re-emitted ${original.event_type} ` +
      `new_event=${newRow.event_id} correlation=${original.correlation_id}`,
  );

  return {
    status: "retry_enqueued",
    agent_run_id: agentRunId,
    trigger_event_id: runRow.trigger_event_id,
    new_event_id: newRow.event_id,
    event_type: original.event_type,
    correlation_id: original.correlation_id,
    prior_run_status: runRow.status ?? null,
    error_code: body.error_code ?? null,
    failed_node: body.failed_node ?? null,
  };
}

module.exports = {
  benchAlert,
  duplicateMerge,
  agentRunRetry,
};
