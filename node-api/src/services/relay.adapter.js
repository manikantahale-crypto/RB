/**
 * The HTTP client PRISM and SYNTRA use to hand work to RELAY (the Smart Inbox):
 * consent emails, profile sends, confirmations. Shared, so it lives at the root
 * rather than in either module. Ported from the old project 2026-09-18; only
 * getRelayBaseUrl changed (see below).
 */
const log = require("../utils/logger");
const { internalHeaders } = require("../utils/internalHeaders");
const env = require("../config/env");

/**
 * Where RELAY is.
 *
 * On the old project RELAY ran embedded inside node-api on an ephemeral port
 * that this file discovered at runtime through relay/embedRelay. That shim is
 * not ported (ref/RELAY_Onboarding.md stage 4 is a port of RELAY as its own
 * module); until then RELAY is reached by URL, and a call to a RELAY that is
 * not running fails the way any unreachable service does — loudly, in the
 * caller's error, not silently.
 */
function getRelayBaseUrl() {
  return (
    process.env.RELAY_INTERNAL_URL ||
    process.env.RELAY_SERVICE_URL ||
    process.env.RELAY_API_URL ||
    `http://127.0.0.1:${env.PORT}`
  ).replace(/\/$/, "");
}

/**
 * Helper to determine if an HTTP response represents the transient 'relay_starting' state.
 */
function isRelayStartingError(status, bodyText) {
  if (status !== 503) return false;
  if (!bodyText) return false;
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && (parsed.error === "relay_starting" || parsed.relay === "starting")) {
      return true;
    }
  } catch {
    /* ignore JSON parse error */
  }
  return bodyText.includes("relay_starting") || bodyText.includes("starting inside Syntra API");
}

/**
 * Dispatches a Candidate Consent Email via the RELAY service.
 * This guarantees proper email thread creation and correlation for inbound replies.
 * Handles transient 503 relay_starting initialization race conditions via bounded retry.
 *
 * @param {Object} params
 * @param {string} params.jobId
 * @param {string} params.submissionId
 * @param {Object} params.candidate - { id, email, fullName }
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=3]
 * @param {number[]} [options.retryDelays=[1000, 2000]]
 * @returns {Promise<Object>}
 */
async function sendCandidateConsentEmail({ jobId, submissionId, candidate, subject, body, requestId }, options = {}) {
  const isTest = process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;
  const defaultDelays = isTest ? [10, 20] : [1000, 2000];
  const reqId = requestId || "relay-adapter";

  log.debug(
    `[request=${reqId}] [relay.adapter.consent] Preparing candidate consent dispatch submissionId=${submissionId} candidateId=${candidate?.id} jobId=${jobId}`
  );

  const maxAttempts = options.maxAttempts || 3;
  const retryDelays = options.retryDelays || defaultDelays;

  const payload = {
    jobId,
    submissionId,
    subject,
    body,
    top_candidates: [
      {
        id: candidate.id,
        email: candidate.email,
        name: candidate.fullName || "Candidate",
        submissionId: submissionId,
      },
    ],
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const relayBase = getRelayBaseUrl();
    const targetUrl = `${relayBase}/internal/consent/send`;
    const tStart = Date.now();

    try {
      log.debug(`[request=${reqId}] [relay.adapter.consent] POST ${targetUrl} attempt=${attempt}/${maxAttempts}`);
      // Use native fetch (Node 18+)
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          ...internalHeaders(),
          ...(reqId ? { "x-request-id": reqId } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const isStarting = isRelayStartingError(response.status, errorText);

        if (isStarting && attempt < maxAttempts) {
          const delayMs = retryDelays[attempt - 1] !== undefined ? retryDelays[attempt - 1] : 1000;
          log.warn(`[RELAY] service initializing status=503 retry=${attempt}/${maxAttempts} delay=${delayMs}ms`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        if (isStarting) {
          log.error(`[RELAY] service startup timeout after ${maxAttempts} attempts`);
        } else {
          log.error(`[RELAY] consent send failed status=${response.status} reason="${errorText.slice(0, 100)}"`);
        }

        throw new Error(`RELAY service returned ${response.status}`);
      }

      const data = await response.json();

      // Validate RELAY actually sent the email (status: 'sent')
      if (data.status !== "sent" || !data.sent_count) {
        log.error(`[RELAY] consent email dispatch failed status=${data.status}`);
        throw new Error("RELAY service failed to dispatch the email to the provider.");
      }

      log.debug(
        `[request=${reqId}] [relay.adapter.consent] Relay responded status=200 sentCount=${data.sent_count} duration=${Date.now() - tStart}ms`
      );
      log.info(`[RELAY] candidate consent email dispatched candidate=${candidate.email}`);
      return data;
    } catch (error) {
      const relayBase = getRelayBaseUrl();
      log.debug(
        `[request=${reqId}] [relay.adapter.consent] Dispatch error duration=${Date.now() - tStart}ms error=${error.message}`
      );
      log.error(`[RELAY] consent dispatch failed url=${relayBase}/internal/consent/send reason="${error.message}"`);
      throw new Error(`Failed to dispatch consent email via Relay service (${relayBase}). ` + error.message);
    }
  }
}

/**
 * Dispatches a Masked Candidate Profile Email to a Vendor via the RELAY service.
 * Handles transient 503 relay_starting initialization race conditions via bounded retry.
 *
 * @param {Object} params
 * @param {string} params.jobId
 * @param {string} params.submissionId
 * @param {string} params.candidateId
 * @param {string} params.vendorEmail
 * @param {string} [params.vendorName]
 * @param {string} [params.jobTitle]
 * @param {Object} [params.maskedProfile]
 * @param {number} [params.rate]
 * @param {string} [params.rateType]
 * @param {string} [params.availability]
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=3]
 * @param {number[]} [options.retryDelays=[1000, 2000]]
 * @returns {Promise<Object>}
 */
async function sendCandidateProfileToVendor(
  {
    jobId,
    submissionId,
    candidateId,
    vendorEmail,
    vendorName,
    jobTitle,
    maskedProfile,
    rate,
    rateType,
    availability,
  },
  options = {}
) {
  const isTest = process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;
  const defaultDelays = isTest ? [10, 20] : [1000, 2000];

  const maxAttempts = options.maxAttempts || 3;
  const retryDelays = options.retryDelays || defaultDelays;

  const payload = {
    jobId,
    submissionId,
    candidate_id: candidateId,
    vendor_email: vendorEmail,
    vendor_name: vendorName || "Vendor",
    job_title: jobTitle,
    masked_profile: maskedProfile,
    rate,
    rate_type: rateType,
    availability,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const relayBase = getRelayBaseUrl();
    const targetUrl = `${relayBase}/internal/profile/send`;

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: internalHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const isStarting = isRelayStartingError(response.status, errorText);

        if (isStarting && attempt < maxAttempts) {
          const delayMs = retryDelays[attempt - 1] !== undefined ? retryDelays[attempt - 1] : 1000;
          log.warn(
            `[Relay Adapter] RELAY is starting (${targetUrl} returned 503 relay_starting). Retrying attempt ${attempt}/${maxAttempts} after ${delayMs}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        if (isStarting) {
          log.error(
            `[Relay Adapter] RELAY is still starting after ${maxAttempts} attempts. Vendor email dispatch failed.`
          );
        } else {
          log.error(`[Relay Adapter] RELAY at ${targetUrl} returned ${response.status}: ${errorText}`);
        }

        throw new Error(`RELAY service returned ${response.status}: ${errorText}`);
      }

      const data = await response.json();

      if (data.status !== "sent") {
        log.error(`[Relay Adapter] RELAY failed to send vendor email. Response: ${JSON.stringify(data)}`);
        throw new Error("RELAY service failed to dispatch the vendor email to the provider.");
      }

      log.info(`[PRISM] [RELAY] Vendor email dispatched successfully for submission ${submissionId} to ${vendorEmail}`);
      return data;
    } catch (error) {
      const relayBase = getRelayBaseUrl();
      const targetUrl = `${relayBase}/internal/profile/send`;
      const causeDetails = error.cause
        ? ` [cause: ${error.cause.code || error.cause.message || String(error.cause)}]`
        : "";
      log.error(`[Relay Adapter] Failed to send vendor email to ${targetUrl}: ${error.message}${causeDetails}`);
      throw new Error(`Failed to dispatch vendor email via Relay service (${relayBase}). ` + error.message);
    }
  }
}

/**
 * Dispatches a Vendor Submission Email via the RELAY service.
 */
async function sendVendorEmail({ submissionId, vendorEmail, subject, body }, options = {}) {
  const isTest = process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;
  const defaultDelays = isTest ? [10, 20] : [1000, 2000];

  const maxAttempts = options.maxAttempts || 3;
  const retryDelays = options.retryDelays || defaultDelays;

  const payload = {
    submissionId,
    vendor_email: vendorEmail,
    subject,
    body,
    candidate_id: submissionId,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const relayBase = getRelayBaseUrl();
    const targetUrl = `${relayBase}/internal/profile/send`;

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: internalHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const isStarting = isRelayStartingError(response.status, errorText);

        if (isStarting && attempt < maxAttempts) {
          const delayMs = retryDelays[attempt - 1] !== undefined ? retryDelays[attempt - 1] : 1000;
          log.warn(`[RELAY] service initializing status=503 retry=${attempt}/${maxAttempts} delay=${delayMs}ms`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        log.error(`[RELAY] vendor send failed status=${response.status} reason="${errorText.slice(0, 100)}"`);
        throw new Error(`RELAY service returned ${response.status}`);
      }

      const data = await response.json();
      log.info(`[RELAY] vendor submission email dispatched vendor=${vendorEmail}`);
      return data;
    } catch (error) {
      const relayBase = getRelayBaseUrl();
      log.error(`[RELAY] vendor dispatch failed url=${relayBase}/internal/profile/send reason="${error.message}"`);
      throw new Error(`Failed to dispatch vendor email via Relay service (${relayBase}). ` + error.message);
    }
  }
}

/**
 * Dispatches a Consultant Availability & Rate Confirmation Email via RELAY.
 */
async function sendConsultantConfirmationEmail({ submissionId, candidateEmail, subject, body }, options = {}) {
  const isTest = process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;
  const defaultDelays = isTest ? [10, 20] : [1000, 2000];

  const maxAttempts = options.maxAttempts || 3;
  const retryDelays = options.retryDelays || defaultDelays;

  const payload = {
    submissionId,
    subject,
    body,
    top_candidates: [
      {
        id: submissionId,
        email: candidateEmail,
        submissionId,
      },
    ],
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const relayBase = getRelayBaseUrl();
    const targetUrl = `${relayBase}/internal/consent/send`;

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: internalHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const isStarting = isRelayStartingError(response.status, errorText);

        if (isStarting && attempt < maxAttempts) {
          const delayMs = retryDelays[attempt - 1] !== undefined ? retryDelays[attempt - 1] : 1000;
          log.warn(`[RELAY] service initializing status=503 retry=${attempt}/${maxAttempts} delay=${delayMs}ms`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        log.error(`[RELAY] consultant confirmation send failed status=${response.status} reason="${errorText.slice(0, 100)}"`);
        throw new Error(`RELAY service returned ${response.status}`);
      }

      const data = await response.json();
      log.info(`[RELAY] consultant confirmation email dispatched candidate=${candidateEmail}`);
      return data;
    } catch (error) {
      const relayBase = getRelayBaseUrl();
      log.error(`[RELAY] consultant confirmation dispatch failed url=${relayBase}/internal/consent/send reason="${error.message}"`);
      throw new Error(`Failed to dispatch consultant confirmation email via Relay service (${relayBase}). ` + error.message);
    }
  }
}

/**
 * Dispatches a Vendor Availability & Rate Confirmation Email via RELAY.
 */
async function sendVendorConfirmationEmail({ submissionId, vendorEmail, subject, body }, options = {}) {
  return await sendVendorEmail({ submissionId, vendorEmail, subject, body }, options);
}

/**
 * Dispatches an Automatic RTR Email Package (with attachments) via RELAY.
 */
async function sendRTREmail({ submissionId, vendorEmail, subject, body, attachments = [] }, options = {}) {
  const isTest = process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;
  const defaultDelays = isTest ? [10, 20] : [1000, 2000];

  const maxAttempts = options.maxAttempts || 3;
  const retryDelays = options.retryDelays || defaultDelays;

  const payload = {
    submissionId,
    vendor_email: vendorEmail,
    subject,
    body,
    candidate_id: submissionId,
    attachments,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const relayBase = getRelayBaseUrl();
    const targetUrl = `${relayBase}/internal/profile/send`;

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: internalHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const isStarting = isRelayStartingError(response.status, errorText);

        if (isStarting && attempt < maxAttempts) {
          const delayMs = retryDelays[attempt - 1] !== undefined ? retryDelays[attempt - 1] : 1000;
          log.warn(`[RELAY] service initializing status=503 retry=${attempt}/${maxAttempts} delay=${delayMs}ms`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        log.error(`[RELAY] RTR send failed status=${response.status} reason="${errorText.slice(0, 100)}"`);
        throw new Error(`RELAY service returned ${response.status}`);
      }

      const data = await response.json();
      log.info(`[RELAY] RTR email package dispatched vendor=${vendorEmail}`);
      return data;
    } catch (error) {
      const relayBase = getRelayBaseUrl();
      log.error(`[RELAY] RTR dispatch failed url=${relayBase}/internal/profile/send reason="${error.message}"`);
      throw new Error(`Failed to dispatch RTR email package via Relay service (${relayBase}). ` + error.message);
    }
  }
}

module.exports = {
  sendCandidateConsentEmail,
  sendVendorEmail,
  sendCandidateProfileToVendor,
  sendConsultantConfirmationEmail,
  sendVendorConfirmationEmail,
  sendRTREmail,
  getRelayBaseUrl,
  isRelayStartingError,
};



