const prismRepo = require("../repositories/prism.repository");
const workflowService = require("../services/prism.workflow.service");
const env = require("../../../config/env");
const log = require("../../../utils/logger");

async function handleConsentAutoResend() {
  if (!env.CONSENT_AUTO_RESEND_ENABLED) {
    return { processed: 0, skipped: true };
  }

  const cooldownMinutes = env.CONSENT_RESEND_COOLDOWN_MINUTES || 60;
  const maxResends = env.CONSENT_MAX_RESENDS || 3;

  const eligibleSubmissions = await prismRepo.findEligibleAutoResendSubmissions(null, {
    cooldownMinutes,
    maxResends,
  });

  if (!eligibleSubmissions || eligibleSubmissions.length === 0) {
    return { processed: 0, successCount: 0, failCount: 0 };
  }

  log.worker(`auto-resend check found eligible=${eligibleSubmissions.length}`);

  let successCount = 0;
  let failCount = 0;

  for (const sub of eligibleSubmissions) {
    try {
      await workflowService.requestCandidateConsent(sub.id, sub.created_by, {
        channel: "AUTO",
        notes: "Automated candidate consent reminder",
      });
      successCount++;
      log.relay(`auto-resend reminder sent submission=${sub.id} resendCount=${Number(sub.consent_resend_count) + 1}`);
    } catch (err) {
      failCount++;
      log.warn(`[RELAY] auto-resend reminder failed submission=${sub.id} reason="${err.message}"`);
    }
  }

  log.worker(`auto-resend sweeper completed succeeded=${successCount} failed=${failCount}`);
  return { processed: eligibleSubmissions.length, successCount, failCount };
}

async function registerConsentAutoResendWorker(boss) {
  await boss.work("prism.consent.autoresend", async () => {
    await handleConsentAutoResend();
  });

  if (env.CONSENT_AUTO_RESEND_ENABLED) {
    // Run sweeper every 15 minutes by default
    const cron = "*/15 * * * *";
    log.info(`[consentAutoResend] Scheduling auto-resend worker: every 15m (${cron})`);
    try {
      await boss.schedule("prism.consent.autoresend", cron, {});
    } catch (err) {
      log.warn(`[consentAutoResend] Failed to schedule worker: ${err.message}`);
    }
  } else {
    log.info("[consentAutoResend] Unscheduling auto-resend worker (disabled).");
    try {
      await boss.unschedule("prism.consent.autoresend");
    } catch (err) {
      log.warn(`[consentAutoResend] Failed to unschedule worker: ${err.message}`);
    }
  }
}

module.exports = {
  handleConsentAutoResend,
  registerConsentAutoResendWorker,
};
