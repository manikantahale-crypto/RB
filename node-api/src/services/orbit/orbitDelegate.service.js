const env = require("../../config/env");
const log = require("../../utils/logger");
const { withTransaction } = require("../../config/db");
const lifecycleRepo = require("../../repositories/lifecycle.repository");
const {
  emitAndMaybePublish,
  publishToOrchFailOpen,
} = require("./orbitOutbox");

const ORBIT_AGENT_ID = "01900000-0000-7000-8000-000000000505";

/** Route ORBIT UI/API actions through orchestrator graphs (module.orbit.bench). */
function shouldDelegateOrbit() {
  return Boolean(env.PLATFORM_EVENTS_ENABLED && env.ORCH_DELEGATE_ORBIT);
}

function resolveOrgId(req, body = {}) {
  return (
    env.ORCH_ORGANIZATION_ID ||
    body.organization_id ||
    req.user?.organizationId ||
    req.headers["x-organization-id"] ||
    req.userId ||
    undefined
  );
}

async function queueOrbitRequest(fields) {
  const envelope = await withTransaction(async (client) =>
    emitAndMaybePublish(client, {
      ...fields,
      organizationId: fields.organizationId || env.ORCH_ORGANIZATION_ID,
    }),
  );

  if (envelope) {
    log.info(
      `[ORBIT] queued ${fields.eventType} aggregate=${fields.aggregateType}:${fields.aggregateId} → orchestrator`,
    );
    publishToOrchFailOpen(envelope);
  }

  return envelope;
}

async function queueLifecycleTransitionRequested(req, candidateId, body) {
  const { to_state, note, context } = body || {};
  const orgId = resolveOrgId(req, body);
  const current = await lifecycleRepo.getLatestLifecycleState(candidateId);
  const fromState = current?.state || "AVAILABLE";

  return queueOrbitRequest({
    eventType: "orbit.lifecycle.transition_requested",
    aggregateType: "candidate",
    aggregateId: candidateId,
    producer: "syntra.orbit.ui",
    organizationId: orgId,
    payload: {
      candidate_id: candidateId,
      from_state: fromState,
      to_state,
      ...(note ? { note } : {}),
      ...(context ? { context } : {}),
      requested_by: req.userId || null,
    },
  });
}

async function queueActivityNoteRequested(req, candidateId, body) {
  const { summary, payload } = body || {};
  const orgId = resolveOrgId(req, body);

  return queueOrbitRequest({
    eventType: "orbit.activity.note_requested",
    aggregateType: "candidate",
    aggregateId: candidateId,
    producer: "syntra.orbit.ui",
    organizationId: orgId,
    payload: {
      candidate_id: candidateId,
      summary,
      payload: payload || {},
      requested_by: req.userId || null,
    },
  });
}

async function queuePlacementConfirmRequested(req, body) {
  const orgId = resolveOrgId(req, body);
  const candidateId = body.candidate_id;

  return queueOrbitRequest({
    eventType: "orbit.placement.confirm_requested",
    aggregateType: "candidate",
    aggregateId: candidateId,
    producer: "syntra.orbit.ui",
    organizationId: orgId,
    payload: { ...body, candidate_id: candidateId },
  });
}

async function queueRevenueArrangeRequested(req, placementId, body) {
  const orgId = resolveOrgId(req, body);

  return queueOrbitRequest({
    eventType: "orbit.revenue.arrange_requested",
    aggregateType: "placement",
    aggregateId: placementId,
    producer: "syntra.orbit.ui",
    organizationId: orgId,
    payload: {
      placement_id: placementId,
      ...body,
    },
  });
}

module.exports = {
  ORBIT_AGENT_ID,
  shouldDelegateOrbit,
  resolveOrgId,
  queueOrbitRequest,
  queueLifecycleTransitionRequested,
  queueActivityNoteRequested,
  queuePlacementConfirmRequested,
  queueRevenueArrangeRequested,
};
