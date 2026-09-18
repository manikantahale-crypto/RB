const imaps = require("imap-simple");
const { simpleParser } = require("mailparser");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const env = require("../../../config/env");
const emailAdapter = require("./adapters/email.adapter");
const userRepo = require("../../../repositories/user.repository");
const log = require("../../../utils/logger");

let isPolling = false;

/**
 * Parses attachment buffer if PDF, DOCX, Word, or Text.
 * Handles failures gracefully to avoid halting the email processing.
 *
 * @param {Object} attachment mailparser attachment object
 * @returns {Promise<string|null>} Extracted text or null
 */
async function extractAttachmentText(attachment) {
  const filename = attachment.filename || "attachment";
  const lastDotIdx = filename.lastIndexOf(".");
  const ext = lastDotIdx !== -1 ? filename.slice(lastDotIdx).toLowerCase() : "";

  try {
    if (ext === ".pdf") {
      log.info(`[IMAP Poller] Extracting text from PDF: ${filename}`);
      const pdfResult = await pdfParse(attachment.content);
      return (pdfResult && pdfResult.text) ? pdfResult.text.trim() : null;
    }

    if (ext === ".docx") {
      log.info(`[IMAP Poller] Extracting text from DOCX: ${filename}`);
      const docxResult = await mammoth.extractRawText({ buffer: attachment.content });
      return (docxResult && docxResult.value) ? docxResult.value.trim() : null;
    }

    if (ext === ".txt") {
      log.info(`[IMAP Poller] Extracting text from TXT: ${filename}`);
      return attachment.content.toString("utf8").trim() || null;
    }

    if (ext === ".doc") {
      // Legacy .doc isn't supported by mammoth. We will read it as raw text as a fallback.
      log.info(`[IMAP Poller] Extracting text from legacy DOC (fallback text): ${filename}`);
      return attachment.content.toString("utf8").trim() || null;
    }
  } catch (err) {
    log.error(`[IMAP Poller] Failed parsing attachment ${filename}: ${err.message}`);
  }

  return null;
}

/**
 * Connects to IMAP, polls for UNSEEN emails, parses them, extracts attachments,
 * and pushes them into ASTRA's ingestion pipeline.
 *
 * @param {Object} [options] Custom execution options
 * @param {number} [options.limit] Maximum number of emails to process in this cycle (default 10)
 * @returns {Promise<Object>} Execution statistics
 */
async function pollEmails(options = {}) {
  if (isPolling) {
    log.info("[IMAP Poller] A poll cycle is already in progress. Skipping.");
    return { status: "skipped", reason: "already_running" };
  }

  isPolling = true;

  const limit = options.limit || 10;
  let connection = null;

  const stats = {
    processed: 0,
    created: 0,
    duplicate: 0,
    failed: 0,
  };

  try {
    const imapConfig = {
      imap: {
        user: env.IMAP_USERNAME,
        password: env.IMAP_PASSWORD,
        host: env.IMAP_HOST,
        port: env.IMAP_PORT,
        tls: true,
        tlsOptions: { rejectUnauthorized: env.IMAP_TLS_REJECT_UNAUTHORIZED },
        authTimeout: 5000,
      },
    };

    if (!imapConfig.imap.user || !imapConfig.imap.password) {
      log.warn("[IMAP Poller] IMAP credentials not configured. Skipping poll.");
      return { status: "skipped", reason: "not_configured" };
    }

    log.info(`[IMAP Poller] Connecting to IMAP server ${imapConfig.imap.host}:${imapConfig.imap.port}...`);
    connection = await imaps.connect(imapConfig);
    await connection.openBox("INBOX");

    log.info("[IMAP Poller] Searching for UNSEEN emails...");
    // Retrieve unseen message headers and full body structure
    const searchCriteria = ["UNSEEN"];
    const fetchOptions = {
      bodies: [""],
      markSeen: false, // Keep unread until processed successfully
    };

    const searchResults = await connection.search(searchCriteria, fetchOptions);
    log.info(`[IMAP Poller] Found ${searchResults.length} UNSEEN emails.`);

    // Resolve configured IMAP mailbox to an existing system user
    let defaultUserId = null;
    if (env.IMAP_USERNAME) {
      try {
        const defaultUser = await userRepo.findUserByEmail(env.IMAP_USERNAME);
        if (defaultUser && defaultUser.id) {
          defaultUserId = defaultUser.id;
          log.info(`[IMAP Poller] Resolved IMAP mailbox ${env.IMAP_USERNAME} to user ID: ${defaultUserId}`);
        } else {
          log.warn(`[IMAP Poller] IMAP username ${env.IMAP_USERNAME} does not map to a system user; email JD will have no created_by.`);
        }
      } catch (userErr) {
        log.warn(`[IMAP Poller] Error resolving user for IMAP username ${env.IMAP_USERNAME}: ${userErr.message}; email JD will have no created_by.`);
      }
    }

    // Process oldest first (search results are returned in ascending order of index)
    const emailsToProcess = searchResults.slice(0, limit);

    for (const message of emailsToProcess) {
      const uid = message.attributes.uid;
      const allPart = message.parts.find((part) => part.which === "");
      if (!allPart) {
        log.warn(`[IMAP Poller] UID ${uid} is missing raw body parts. Skipping.`);
        stats.failed++;
        continue;
      }

      const rawEmail = allPart.body;

      try {
        // Parse raw MIME email using mailparser
        const parsed = await simpleParser(rawEmail);
        stats.processed++;

        let bodyText = parsed.text || "";

        // Handle attachment extraction
        if (parsed.attachments && parsed.attachments.length > 0) {
          for (const attachment of parsed.attachments) {
            const attachmentText = await extractAttachmentText(attachment);
            if (attachmentText) {
              bodyText += `\n\n--- Attachment: ${attachment.filename || "attachment"} ---\n${attachmentText}`;
            }
          }
        }

        // Build Canonical Email Payload mapping to ASTRA email.adapter.js expectations
        const payload = {
          messageId: parsed.messageId || null,
          from: parsed.from ? parsed.from.text : null,
          to: parsed.to ? parsed.to.text : null,
          subject: parsed.subject || "",
          body: bodyText,
          inReplyTo: parsed.inReplyTo || null,
          references: Array.isArray(parsed.references) ? parsed.references.join(" ") : parsed.references || null,
          date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
          createdBy: defaultUserId,
        };

        log.info(`[IMAP Poller] Ingesting email: "${payload.subject}" from: ${payload.from}`);

        // Invoke existing ASTRA email intake boundary directly
        const result = await emailAdapter.ingestEmail(payload);

        if (result.created) {
          log.info(`[IMAP Poller] Ingested successfully. Job ID: ${result.jobId}`);
          stats.created++;
        } else if (result.duplicate) {
          log.info(`[IMAP Poller] Duplicate skipped. Reason: ${result.duplicateReason}`);
          stats.duplicate++;
        }

        // Mark the email as Seen ONLY after successful ingestion or duplicate confirmation
        await connection.addFlags(uid, "\\Seen");
        log.info(`[IMAP Poller] Marked UID ${uid} as Seen.`);
      } catch (err) {
        log.error(`[IMAP Poller] Error processing message UID ${uid}: ${err.message}`);
        stats.failed++;
        // Do NOT mark seen so it can be retried on next poll cycle
      }
    }
  } catch (err) {
    log.error(`[IMAP Poller] Connection/search failure: ${err.message}`);
    throw err;
  } finally {
    if (connection) {
      try {
        await connection.end();
        log.info("[IMAP Poller] Connection closed.");
      } catch (err) {
        log.warn(`[IMAP Poller] Error closing connection: ${err.message}`);
      }
    }
    isPolling = false;
  }

  return {
    status: "completed",
    ...stats,
  };
}

module.exports = {
  pollEmails,
};
