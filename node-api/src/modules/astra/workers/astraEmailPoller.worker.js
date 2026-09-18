const emailPollerService = require("../services/emailPoller.service");
const log = require("../../../utils/logger");

/**
 * Core handler for the 'astra.email.poll' scheduled job.
 *
 * Responsibilities:
 * 1. Log poll start.
 * 2. Invoke the pollEmails service.
 * 3. Log results/success stats.
 * 4. Surface exceptions to pg-boss so it can manage job failure status.
 *
 * @returns {Promise<Object>} Outcome statistics
 */
async function handleAstraEmailPoll() {
  log.info("[IMAP Worker] Starting scheduled email poll cycle...");

  try {
    const stats = await emailPollerService.pollEmails();
    log.info("[IMAP Worker] Scheduled email poll completed successfully.", stats);
    return stats;
  } catch (err) {
    log.error(`[IMAP Worker] Scheduled email poll FAILED: ${err.message}`);
    throw err; // Rethrow to let pg-boss record failure and manage retry
  }
}

/**
 * Registers the 'astra.email.poll' queue worker with pg-boss.
 *
 * @param {import("pg-boss")} boss
 */
function registerAstraEmailPollerWorker(boss) {
  return boss.work("astra.email.poll", async ([job]) => {
    try {
      await handleAstraEmailPoll();
    } catch (err) {
      log.error(`[IMAP Worker] Error in worker execution for job ID ${job?.id}: ${err.message}`);
      throw err;
    }
  });
}

module.exports = {
  handleAstraEmailPoll,
  registerAstraEmailPollerWorker,
};
