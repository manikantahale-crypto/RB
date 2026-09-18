const astraService = require("../astra.service");

/**
 * Removes forwarded/reply headers, thread histories, and bounce headers from email bodies.
 *
 * @param {string} rawBody
 * @returns {string}
 */
function cleanEmailBody(rawBody) {
  if (!rawBody || typeof rawBody !== "string") return "";
  const body = rawBody;

  const markers = [
    "-----original message-----",
    "---------- forwarded message ---------",
    "---------------- forwarded message ----------------",
    "mail delivery subsystem",
    "mailer-daemon",
    "delivery status notification",
    "on mon,",
    "on tue,",
    "on wed,",
    "on thu,",
    "on fri,",
    "on sat,",
    "on sun,",
    "wrote:",
  ];

  const bodyLower = body.toLowerCase();
  let earliestIdx = body.length;

  for (const marker of markers) {
    const idx = bodyLower.indexOf(marker);
    if (idx !== -1 && idx < earliestIdx) {
      earliestIdx = idx;
    }
  }

  // Also check for generic 'On <date> wrote:' pattern using regex
  const onDateRegex = /\r?\n\s*on\s+[a-z0-9,:\s+-]+wrote:\s*/i;
  const onDateMatch = onDateRegex.exec(body);
  if (onDateMatch && onDateMatch.index < earliestIdx) {
    earliestIdx = onDateMatch.index;
  }

  const extracted = body.slice(0, earliestIdx).trim();
  return extracted || body.trim();
}

/**
 * Derives a clean requirement title from explicit title, subject line, or body opening line.
 *
 * @param {Object} params
 * @param {string} [params.title]
 * @param {string} [params.subject]
 * @param {string} [params.body]
 * @returns {string}
 */
function extractTitleFromEmail({ title, subject, body }) {
  // 1. Explicit title takes highest precedence
  if (title && typeof title === "string" && title.trim().length > 0) {
    return title.trim();
  }

  // 2. Clean subject line
  if (subject && typeof subject === "string" && subject.trim().length > 0) {
    let cleanSubj = subject.trim();
    // Remove common email prefixes
    cleanSubj = cleanSubj.replace(/^(re|fwd|fw|urgent requirement|urgent|hot requirement|requirement for|requirement|job opening|opening for|hotlist|immediate requirement)\s*:\s*/i, "").trim();
    if (cleanSubj.length > 0) {
      return cleanSubj;
    }
  }

  // 3. Fallback to first non-empty line of body (truncated to 100 chars)
  if (body && typeof body === "string") {
    const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      const firstLine = lines[0].replace(/^(re|fwd|fw|subject|title|job title)\s*:\s*/i, "").trim();
      if (firstLine.length > 0) {
        return firstLine.slice(0, 100);
      }
    }
  }

  return "Untitled Role";
}

/**
 * Resolves sender email from common transport/webhook aliases.
 *
 * @param {Object} payload
 * @returns {string|null}
 */
function resolveSenderEmail(payload = {}) {
  const raw =
    payload.from ||
    payload.from_email ||
    payload.sender ||
    payload.sender_email ||
    payload.sourceEmail ||
    payload.source_email ||
    "";
  return astraService.normalizeEmail(raw);
}

/**
 * Resolves Message-ID from common transport/webhook aliases.
 *
 * @param {Object} payload
 * @returns {string|null}
 */
function resolveMessageId(payload = {}) {
  const raw =
    payload.messageId ||
    payload.message_id ||
    payload.message_ID ||
    payload.MessageID ||
    payload.Message_Id ||
    "";
  return astraService.normalizeMessageId(raw);
}

/**
 * Adapts an incoming raw email payload into the source-agnostic Canonical Requirement Payload.
 *
 * @param {Object} payload Raw email intake payload
 * @returns {Object} Canonical Requirement Payload
 */
function adaptEmailToRequirement(payload = {}) {
  if (!payload || typeof payload !== "object") {
    const err = new Error("Email intake payload must be an object");
    err.statusCode = 400;
    throw err;
  }

  const rawSubject =
    payload.subject ||
    payload.sourceSubject ||
    payload.source_subject ||
    payload.Subject ||
    "";

  const rawBody =
    payload.body ||
    payload.emailText ||
    payload.content ||
    payload.text ||
    payload.rawText ||
    payload.raw_text ||
    "";

  const explicitTitle =
    payload.title ||
    payload.job_title ||
    payload.jobTitle ||
    "";

  const cleanedBody = cleanEmailBody(rawBody);
  const derivedTitle = extractTitleFromEmail({
    title: explicitTitle,
    subject: rawSubject,
    body: cleanedBody,
  });

  const sourceEmail = resolveSenderEmail(payload);
  const messageId = resolveMessageId(payload);

  const companyName =
    payload.companyName ||
    payload.company_name ||
    payload.clientName ||
    payload.client_name ||
    payload.company ||
    null;

  const location = payload.location || null;
  const skills =
    payload.skills ||
    payload.requiredSkills ||
    payload.required_skills ||
    null;

  let minExperience = null;
  if (payload.minExperience != null) {
    minExperience = Number(payload.minExperience);
  } else if (payload.min_experience != null) {
    minExperience = Number(payload.min_experience);
  }

  let maxExperience = null;
  if (payload.maxExperience != null) {
    maxExperience = Number(payload.maxExperience);
  } else if (payload.max_experience != null) {
    maxExperience = Number(payload.max_experience);
  }

  const visaRequirement =
    payload.visaRequirement ||
    payload.visa_requirement ||
    payload.visa ||
    null;

  const employmentType =
    payload.employmentType ||
    payload.employment_type ||
    payload.jobType ||
    payload.job_type ||
    null;

  const remotePolicy =
    payload.remotePolicy ||
    payload.remote_policy ||
    payload.remoteOption ||
    payload.remote_option ||
    null;

  return {
    title: derivedTitle,
    companyName: companyName ? String(companyName).trim() : null,
    location: location ? String(location).trim() : null,
    skills: skills || null,
    rawText: cleanedBody || "",

    sourceEmail: sourceEmail || null,
    sourceSubject: rawSubject ? String(rawSubject).trim() : null,
    messageId: messageId || null,
    relayThreadId:
      payload.relay_thread_id ||
      payload.relayThreadId ||
      payload.thread_id ||
      payload.threadId ||
      null,

    minExperience: Number.isFinite(minExperience) ? minExperience : null,
    maxExperience: Number.isFinite(maxExperience) ? maxExperience : null,
    visaRequirement: visaRequirement ? String(visaRequirement).trim() : null,
    employmentType: employmentType ? String(employmentType).trim() : null,
    remotePolicy: remotePolicy ? String(remotePolicy).trim() : null,

    originalFileName: payload.originalFileName || payload.original_file_name || null,
    filePath: payload.filePath || payload.file_path || null,
    mimeType: payload.mimeType || payload.mime_type || null,
    createdBy: payload.createdBy || payload.created_by || payload.userId || null,

    sourceType: "email",
    sourceName: "email",
  };
}

/**
 * Top-level Email Ingestion Boundary:
 * Adapts email payload to canonical format and delegates to ASTRA core service.
 *
 * @param {Object} payload Raw email intake payload
 * @returns {Promise<Object>} Standardized ASTRA ingestion result
 */
async function ingestEmail(payload = {}) {
  const canonicalPayload = adaptEmailToRequirement(payload);
  return astraService.ingestRequirement(canonicalPayload);
}

module.exports = {
  adaptEmailToRequirement,
  ingestEmail,
  cleanEmailBody,
  extractTitleFromEmail,
  resolveSenderEmail,
  resolveMessageId,
};
