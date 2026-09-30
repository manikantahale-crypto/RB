/**
 * PRISM Controlled Candidate Consent Resend & Reminder Test Suite
 */

const { pool } = require('../src/config/db');
const prismService = require('../src/services/prism.service');
const prismWorkflow = require('../src/services/prism.workflow.service');
const prismRepo = require('../src/repositories/prism.repository');
const candidateRepo = require('../src/repositories/candidate.repository');
const jobRepo = require('../src/repositories/job.repository');
const resumeRepo = require('../src/repositories/resume.repository');
const relayAdapter = require('../src/services/relay.adapter');
const { handleConsentAutoResend } = require('../src/workers/consentAutoResend.worker');
const env = require('../src/config/env');

async function runPrismConsentResendTests() {
  console.log('========================================================================');
  console.log('RUNNING PRISM CONTROLLED CANDIDATE CONSENT RESEND TEST SUITE');
  console.log('========================================================================\n');

  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passCount++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failCount++;
    }
  }

  // Backup original relay send function
  const originalSend = relayAdapter.sendCandidateConsentEmail;

  let user = null;
  let otherUser = null;

  try {
    // 0. Setup Test Users
    const userRes = await pool.query("SELECT id, email FROM syntra.users LIMIT 2");
    if (userRes.rows.length === 0) throw new Error('No system user found in database');
    user = userRes.rows[0];
    otherUser = userRes.rows[1] || { id: '00000000-0000-0000-0000-000000000099' };

    // Helper fixture generator
    async function createFixture(prefix = 'ResendTest', ownerId = user.id) {
      const email = `${prefix.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`;
      const cand = await candidateRepo.insertCandidate(pool, {
        fullName: `${prefix} Candidate`,
        email,
        phone: '(555) 019-2831',
        createdBy: ownerId,
      });
      cand.email = email;

      const res = await resumeRepo.insertResume(pool, {
        candidateId: cand.id,
        originalFileName: 'test_resume.pdf',
        filePath: './uploads/test_resume.pdf',
        mimeType: 'application/pdf',
        rawText: `Experienced ${prefix} professional with technical skills.`,
      });

      const job = await jobRepo.insertJob(pool, {
        title: `${prefix} Engineer Position`,
        originalFileName: 'test_job.docx',
        filePath: './uploads/test_job.docx',
        mimeType: 'application/docx',
        rawText: `Looking for a ${prefix} Engineer.`,
        createdBy: ownerId,
      });

      const sub = await prismService.createSubmission({
        candidateId: cand.id,
        resumeId: res.id,
        jobId: job.id,
        userId: ownerId,
      });

      return { cand, res, job, sub };
    }

    // Mock relay send for testing
    let sendCalls = [];
    relayAdapter.sendCandidateConsentEmail = async (params) => {
      sendCalls.push(params);
      return { success: true, threadId: `thread-${Date.now()}` };
    };

    // -------------------------------------------------------------------------
    // TEST 1 — Initial send
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Initial Consent Send ---');
    const f1 = await createFixture('T1Initial');
    sendCalls = [];

    const initSub = await prismWorkflow.requestCandidateConsent(f1.sub.id, user.id);
    assert(initSub.status === 'PENDING_CONSENT', 'Status transitioned to PENDING_CONSENT');
    assert(Number(initSub.consentResendCount) === 0, 'Initial send consentResendCount is 0');
    assert(initSub.lastConsentSentAt !== null, 'lastConsentSentAt is populated on initial send');
    assert(sendCalls.length === 1, 'RELAY sendCandidateConsentEmail invoked once on initial send');

    const initConsents = await prismRepo.getConsentBySubmissionId(f1.sub.id, user.id);
    assert(initConsents.length === 1, 'Exactly one prism_consents record created');
    assert(initConsents[0].status === 'REQUESTED', 'Consent status set to REQUESTED');

    // -------------------------------------------------------------------------
    // TEST 2 — Manual resend after cooldown
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Manual Resend After Cooldown ---');
    const f2 = await createFixture('T2Resend');
    await prismWorkflow.requestCandidateConsent(f2.sub.id, user.id);

    // Simulate elapsed cooldown by setting last_consent_sent_at into past (e.g. 2 hours ago)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await pool.query('UPDATE public.prism_submissions SET last_consent_sent_at = $1 WHERE id = $2', [twoHoursAgo, f2.sub.id]);

    sendCalls = [];
    const resentSub = await prismWorkflow.requestCandidateConsent(f2.sub.id, user.id);
    assert(resentSub.status === 'PENDING_CONSENT', 'Status remains PENDING_CONSENT after resend');
    assert(Number(resentSub.consentResendCount) === 1, 'consentResendCount incremented to 1');
    assert(new Date(resentSub.lastConsentSentAt).getTime() > twoHoursAgo.getTime(), 'lastConsentSentAt updated to current timestamp');
    assert(sendCalls.length === 1, 'RELAY sendCandidateConsentEmail invoked on resend');

    // -------------------------------------------------------------------------
    // TEST 3 — Manual resend before cooldown
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Manual Resend Before Cooldown ---');
    const f3 = await createFixture('T3Cooldown');
    await prismWorkflow.requestCandidateConsent(f3.sub.id, user.id);

    // Set last_consent_sent_at to just 1 minute ago (cooldown default is 60m)
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    await pool.query('UPDATE public.prism_submissions SET last_consent_sent_at = $1 WHERE id = $2', [oneMinAgo, f3.sub.id]);

    sendCalls = [];
    let cooldownError = null;
    try {
      await prismWorkflow.requestCandidateConsent(f3.sub.id, user.id);
    } catch (err) {
      cooldownError = err;
    }
    assert(cooldownError !== null, 'Error thrown when attempting resend before cooldown');
    assert(cooldownError?.code === 'CONSENT_RESEND_COOLDOWN', 'Error code is CONSENT_RESEND_COOLDOWN');
    assert(sendCalls.length === 0, 'No RELAY send email invoked during active cooldown');

    // -------------------------------------------------------------------------
    // TEST 4 — Maximum resend limit
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Maximum Resend Limit ---');
    const f4 = await createFixture('T4MaxResend');
    await prismWorkflow.requestCandidateConsent(f4.sub.id, user.id);

    // Set consent_resend_count = 3 (max) and past timestamp
    await pool.query(
      'UPDATE public.prism_submissions SET consent_resend_count = 3, last_consent_sent_at = $1 WHERE id = $2',
      [twoHoursAgo, f4.sub.id]
    );

    sendCalls = [];
    let limitError = null;
    try {
      await prismWorkflow.requestCandidateConsent(f4.sub.id, user.id);
    } catch (err) {
      limitError = err;
    }
    assert(limitError !== null, 'Error thrown when max resend limit reached');
    assert(limitError?.code === 'CONSENT_RESEND_LIMIT_REACHED', 'Error code is CONSENT_RESEND_LIMIT_REACHED');
    assert(sendCalls.length === 0, 'No RELAY send email invoked when limit reached');

    // -------------------------------------------------------------------------
    // TEST 5 — Automatic resend worker
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: Automatic Resend Worker ---');
    const f5 = await createFixture('T5AutoResend');
    await prismWorkflow.requestCandidateConsent(f5.sub.id, user.id);

    // Make eligible for auto-resend (past cooldown, resend_count = 0)
    await pool.query('UPDATE public.prism_submissions SET last_consent_sent_at = $1 WHERE id = $2', [twoHoursAgo, f5.sub.id]);

    sendCalls = [];
    const autoResult = await handleConsentAutoResend();
    assert(autoResult.successCount >= 1, 'Auto-resend worker successfully processed eligible submission');

    const f5SubAfter = await prismRepo.getSubmissionById(f5.sub.id, user.id);
    assert(Number(f5SubAfter.consentResendCount) === 1, 'Auto-resend worker incremented consentResendCount to 1');

    // -------------------------------------------------------------------------
    // TEST 6 — Auto resend stops after candidate YES
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: Auto Resend Stops After Candidate YES ---');
    const f6 = await createFixture('T6YesStop');
    await prismWorkflow.requestCandidateConsent(f6.sub.id, user.id);
    await prismWorkflow.recordCandidateConsentResponse(f6.sub.id, user.id, { response: 'YES' });

    await pool.query('UPDATE public.prism_submissions SET last_consent_sent_at = $1 WHERE id = $2', [twoHoursAgo, f6.sub.id]);

    sendCalls = [];
    await handleConsentAutoResend();
    assert(sendCalls.length === 0 || !sendCalls.some(c => c.submissionId === f6.sub.id), 'Auto-resend worker skipped submission after candidate YES');

    // -------------------------------------------------------------------------
    // TEST 7 — Auto resend stops after candidate NO
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: Auto Resend Stops After Candidate NO ---');
    const f7 = await createFixture('T7NoStop');
    await prismWorkflow.requestCandidateConsent(f7.sub.id, user.id);
    await prismWorkflow.recordCandidateConsentResponse(f7.sub.id, user.id, { response: 'NO' });

    await pool.query('UPDATE public.prism_submissions SET last_consent_sent_at = $1 WHERE id = $2', [twoHoursAgo, f7.sub.id]);

    sendCalls = [];
    await handleConsentAutoResend();
    assert(sendCalls.length === 0 || !sendCalls.some(c => c.submissionId === f7.sub.id), 'Auto-resend worker skipped submission after candidate NO');

    // -------------------------------------------------------------------------
    // TEST 8 — Failed send handling
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 8: Failed Send Handling ---');
    const f8 = await createFixture('T8FailSend');
    await prismWorkflow.requestCandidateConsent(f8.sub.id, user.id);
    await pool.query('UPDATE public.prism_submissions SET last_consent_sent_at = $1 WHERE id = $2', [twoHoursAgo, f8.sub.id]);

    // Mock RELAY send failure
    relayAdapter.sendCandidateConsentEmail = async () => {
      throw new Error('RELAY 503 relay_starting');
    };

    let sendFailError = null;
    try {
      await prismWorkflow.requestCandidateConsent(f8.sub.id, user.id);
    } catch (err) {
      sendFailError = err;
    }
    assert(sendFailError !== null, 'Send failure error bubbled up');

    const f8SubAfter = await prismRepo.getSubmissionById(f8.sub.id, user.id);
    assert(Number(f8SubAfter.consentResendCount) === 0, 'consentResendCount remains 0 after failed send');
    assert(new Date(f8SubAfter.lastConsentSentAt).getTime() === twoHoursAgo.getTime(), 'lastConsentSentAt unchanged after failed send');

    // Restore mock relay send
    relayAdapter.sendCandidateConsentEmail = async (params) => {
      sendCalls.push(params);
      return { success: true, threadId: `thread-${Date.now()}` };
    };

    // -------------------------------------------------------------------------
    // TEST 9 — Concurrency / Double-Click protection
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 9: Concurrency / Double-Click Protection ---');
    const f9 = await createFixture('T9Concurrent');
    await prismWorkflow.requestCandidateConsent(f9.sub.id, user.id);
    await pool.query('UPDATE public.prism_submissions SET last_consent_sent_at = $1 WHERE id = $2', [twoHoursAgo, f9.sub.id]);

    sendCalls = [];
    const results = await Promise.allSettled([
      prismWorkflow.requestCandidateConsent(f9.sub.id, user.id),
      prismWorkflow.requestCandidateConsent(f9.sub.id, user.id),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    assert(fulfilled.length === 1, 'Exactly one concurrent request succeeded');
    assert(rejected.length === 1, 'Second concurrent request was blocked by cooldown/lock');

    // -------------------------------------------------------------------------
    // TEST 10 — Ownership isolation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 10: Ownership Isolation ---');
    const f10 = await createFixture('T10Ownership', user.id);

    let ownerError = null;
    try {
      await prismWorkflow.requestCandidateConsent(f10.sub.id, otherUser.id);
    } catch (err) {
      ownerError = err;
    }
    assert(ownerError !== null, 'Unauthorized user resend rejected with error');
    assert(ownerError?.statusCode === 404, 'Returned 404 for unauthorized user access');

    // -------------------------------------------------------------------------
    // TEST 11 — Single consent record preservation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 11: Single Consent Record Preservation ---');
    const f11 = await createFixture('T11SingleConsent');
    await prismWorkflow.requestCandidateConsent(f11.sub.id, user.id);
    await pool.query('UPDATE public.prism_submissions SET last_consent_sent_at = $1 WHERE id = $2', [twoHoursAgo, f11.sub.id]);
    await prismWorkflow.requestCandidateConsent(f11.sub.id, user.id);

    const f11Consents = await prismRepo.getConsentBySubmissionId(f11.sub.id, user.id);
    assert(f11Consents.length === 1, 'Still exactly one prism_consents record after resend');

    // -------------------------------------------------------------------------
    // TEST 12 — Audit log creation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 12: Audit Log Creation ---');
    const auditLogs = await prismRepo.getAuditHistory(f11.sub.id, user.id);
    const resendAudit = auditLogs.find(a => a.new_status === 'CONSENT_RESENT');
    assert(resendAudit !== undefined, 'CONSENT_RESENT audit log recorded');

    // -------------------------------------------------------------------------
    // TEST 13 — Existing RELAY integration verified
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 13: Existing RELAY Integration Verification ---');
    const f13 = await createFixture('T13RelayGateway');
    sendCalls = [];
    await prismWorkflow.requestCandidateConsent(f13.sub.id, user.id);
    assert(sendCalls.length === 1, 'Resend invoked relayAdapter.sendCandidateConsentEmail');
    assert(sendCalls[0].submissionId === f13.sub.id, 'Resend passed correct submissionId to RELAY gateway');

  } catch (err) {
    console.error('\nFATAL SUITE ERROR:', err);
    failCount++;
  } finally {
    relayAdapter.sendCandidateConsentEmail = originalSend;
    console.log('\n========================================================================');
    console.log(`SUITE COMPLETE: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('========================================================================\n');
  }
}

if (require.main === module) {
  runPrismConsentResendTests().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runPrismConsentResendTests };
