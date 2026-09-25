const env = require("../../../config/env");
const log = require("../../../utils/logger");
const reviewRepo = require("../repositories/recruiterReview.repository");

async function syncInbox(userId) {
  await reviewRepo.ensureSchema();
  const orgId = env.ORCH_ORGANIZATION_ID || null;
  const fromOutbox = await reviewRepo.syncHumanEventsFromOutbox(orgId);
  const fromRuns = await reviewRepo.syncParkedRuns(orgId);
  if (fromOutbox + fromRuns > 0) {
    log.info(
      `[recruiterReview] synced inbox user=${userId} outbox=${fromOutbox} parked=${fromRuns}`,
    );
  }
  return { fromOutbox, fromRuns };
}

async function listPending(userId) {
  await syncInbox(userId);
  const orgId = env.ORCH_ORGANIZATION_ID || null;
  const rows = await reviewRepo.listPendingForUser({ userId, organizationId: orgId });
  return rows.map(mapRow);
}

function mapRow(row) {
  return {
    id: row.id,
    actionType: row.action_type,
    status: row.status,
    title: row.title,
    message: row.message,
    payload: row.payload,
    sourceEventType: row.source_event_type,
    sourceEventId: row.source_event_id,
    createdAt: row.created_at,
  };
}

async function decide({ itemId, userId, approved, note }) {
  const item = await reviewRepo.getByIdForUser(itemId, userId);
  if (!item) {
    const err = new Error("Review item not found");
    err.statusCode = 404;
    throw err;
  }

  const payload =
    typeof item.payload === "object" && item.payload ? item.payload : {};
  const status = approved ? "approved" : "rejected";

  if (
    item.action_type === "workflow_parked" ||
    item.action_type === "approval"
  ) {
    const threadId = payload.thread_id;
    const graphKey = payload.graph_key;
    const orgId = item.organization_id || env.ORCH_ORGANIZATION_ID;
    if (threadId && graphKey && orgId) {
      const orchUrl = env.ORCH_API_URL.replace(/\/$/, "");
      log.info(
        `[recruiterReview] resume thread=${threadId} graph=${graphKey} approved=${approved}`,
      );
      const res = await fetch(`${orchUrl}/v1/threads/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId,
          graph_key: graphKey,
          organization_id: orgId,
          decision: { approved, note: note || null },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        log.warn(`[recruiterReview] orch resume failed: ${res.status} ${text}`);
      }
    }
  }

  const ok = await reviewRepo.markDecided(itemId, {
    userId,
    status,
    note,
  });
  if (!ok) {
    const err = new Error("Review item already decided");
    err.statusCode = 409;
    throw err;
  }

  log.info(
    `[recruiterReview] decided id=${itemId} type=${item.action_type} status=${status} user=${userId}`,
  );
  return { id: itemId, status };
}

async function createDuplicateReview({
  userId,
  organizationId,
  candidateA,
  candidateB,
  signals,
  duplicateReviewId,
}) {
  await reviewRepo.ensureSchema();
  const id = await reviewRepo.insertItem({
    userId,
    organizationId,
    actionType: "duplicate_review",
    title: "Duplicate candidate review needed",
    message:
      "Two candidate profiles look like the same person. Review and confirm merge or keep separate.",
    payload: {
      duplicate_review_id: duplicateReviewId,
      candidate_a: candidateA,
      candidate_b: candidateB,
      signals: signals || {},
    },
    sourceEventType: "syntra.duplicate.review_required",
    sourceEventId: duplicateReviewId,
  });
  log.info(
    `[recruiterReview] created duplicate review id=${id} candidates=${candidateA}/${candidateB}`,
  );
  return id;
}

module.exports = {
  listPending,
  decide,
  syncInbox,
  createDuplicateReview,
};
