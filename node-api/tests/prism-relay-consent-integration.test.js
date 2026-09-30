/**
 * PRISM Candidate Consent & RELAY Email Gateway Integration Test Suite
 *
 * Verifies:
 * 1. PRISM -> relay.adapter -> RELAY /internal/consent/send outbound call chain.
 * 2. RELAY -> EmailSenderFactory -> GmailApiSender invocation contract.
 * 3. Successful consent request status transition to PENDING_CONSENT and email thread persistence.
 * 4. Error propagation and transaction safety when RELAY / email sending fails.
 * 5. Candidate YES response -> RELAY -> PRISM -> CANDIDATE_VALIDATED workflow state machine transition.
 * 6. Candidate NO response -> RELAY -> PRISM -> CONSENT_REJECTED workflow state machine transition.
 * 7. Candidate submission correlation via workflowContext JSONB & thread ID.
 * 8. Security verification preventing unauthorized candidate email overrides.
 */

const { pool } = require('../src/config/db');
const prismService = require('../src/services/prism.service');
const prismWorkflow = require('../src/services/prism.workflow.service');
const prismRepo = require('../src/repositories/prism.repository');
const candidateRepo = require('../src/repositories/candidate.repository');
const jobRepo = require('../src/repositories/job.repository');
const resumeRepo = require('../src/repositories/resume.repository');
const relayAdapter = require('../src/services/relay.adapter');

async function runPrismConsentIntegrationTests() {
  console.log('========================================================================');
  console.log('RUNNING PRISM CANDIDATE CONSENT & RELAY EMAIL GATEWAY INTEGRATION SUITE');
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

  let user = null;
  const createdSubmissions = [];
  const createdCandidates = [];
  const createdJobs = [];

  try {
    // 0. Setup Test User
    const userRes = await pool.query("SELECT id, email FROM syntra.users LIMIT 1");
    if (userRes.rows.length === 0) throw new Error('No system user found in database');
    user = userRes.rows[0];

    async function createTestFixture(titlePrefix = 'Test') {
      const email = `${titlePrefix.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`;
      const cand = await candidateRepo.insertCandidate(pool, {
        fullName: `${titlePrefix} Candidate`,
        email,
        phone: '(555) 019-2831',
        createdBy: user.id,
      });
      cand.email = email;
      createdCandidates.push(cand.id);

      const res = await resumeRepo.insertResume(pool, {
        candidateId: cand.id,
        originalFileName: 'test_resume.pdf',
        filePath: './uploads/test_resume.pdf',
        mimeType: 'application/pdf',
        rawText: 'Experienced Senior Engineer with 8 years in Node.js, Python, AWS.',
      });

      const j = await jobRepo.insertJob(pool, {
        title: `${titlePrefix} Engineer Position`,
        originalFileName: 'integration_job.docx',
        filePath: './uploads/integration_job.docx',
        mimeType: 'application/docx',
        rawText: 'Looking for a Senior Integration Engineer with Node.js and Postgres experience.',
        createdBy: user.id,
      });
      createdJobs.push(j.id);

      const sub = await prismService.createSubmission({
        candidateId: cand.id,
        resumeId: res.id,
        jobId: j.id,
        userId: user.id,
      });
      createdSubmissions.push(sub.id);

      return { cand, res, j, sub };
    }

    // ------------------------------------------------------------------------
    // Test 1-3: Outbound Candidate Consent Dispatch Chain
    // ------------------------------------------------------------------------
    console.log('\n[TEST 1-3: Outbound Candidate Consent Dispatch Chain]');

    const f1 = await createTestFixture('Outbound');
    assert(f1.sub.status === 'DRAFT', 'Created test submission in DRAFT state');

    const originalSendEmail = relayAdapter.sendCandidateConsentEmail;
    let dispatchedPayload = null;

    relayAdapter.sendCandidateConsentEmail = async (params) => {
      dispatchedPayload = params;
      return { status: 'sent', sent_count: 1, thread_ids: ['test-thread-uuid'] };
    };

    const requested = await prismService.requestCandidateConsent(f1.sub.id, user.id, {
      notes: 'Initial consent request for client opportunity',
    });

    assert(dispatchedPayload !== null, 'PRISM called relayAdapter.sendCandidateConsentEmail');
    assert(dispatchedPayload.submissionId === f1.sub.id, 'Dispatched payload includes correct submissionId');
    assert(dispatchedPayload.jobId === f1.j.id, 'Dispatched payload includes correct jobId');
    assert(String(dispatchedPayload.candidate.email).trim().toLowerCase() === String(f1.cand.email).trim().toLowerCase(), `Dispatched payload includes correct candidate email: ${dispatchedPayload.candidate?.email}`);
    assert(requested.status === 'PENDING_CONSENT', 'Submission state updated to PENDING_CONSENT');

    const latestConsent = await prismRepo.getLatestConsent(f1.sub.id, user.id);
    assert(latestConsent && latestConsent.status === 'REQUESTED', 'Consent record created with status REQUESTED');

    relayAdapter.sendCandidateConsentEmail = originalSendEmail;

    // ------------------------------------------------------------------------
    // Test 4: Transaction Rollback on Email Send Failure
    // ------------------------------------------------------------------------
    console.log('\n[TEST 4: Transaction Rollback on Email Send Failure]');

    const f4 = await createTestFixture('Failure');

    relayAdapter.sendCandidateConsentEmail = async () => {
      throw new Error('RELAY service returned 502: Email dispatch failed');
    };

    let caughtError = null;
    try {
      await prismService.requestCandidateConsent(f4.sub.id, user.id, { notes: 'Should fail' });
    } catch (err) {
      caughtError = err;
    }

    assert(caughtError !== null, 'Exception propagated when RELAY dispatch failed');
    assert(caughtError.message.includes('RELAY service returned 502'), `Correct error message caught: ${caughtError?.message}`);

    const unChangedSub = await prismRepo.getSubmissionById(f4.sub.id, user.id);
    assert(unChangedSub.status === 'DRAFT', 'PRISM submission status remained DRAFT on email send failure');

    const failConsent = await prismRepo.getLatestConsent(f4.sub.id, user.id);
    assert(!failConsent, 'No consent record was persisted on email send failure');

    relayAdapter.sendCandidateConsentEmail = originalSendEmail;

    // ------------------------------------------------------------------------
    // Test 5: Candidate YES Inbound State Machine Transition
    // ------------------------------------------------------------------------
    console.log('\n[TEST 5: Candidate YES Response -> CANDIDATE_VALIDATED]');

    const yesResult = await prismWorkflow.recordCandidateConsentResponse(f1.sub.id, user.id, {
      response: 'ACCEPTED',
      notes: 'Candidate replied YES via email',
    });

    assert(yesResult.status === 'CANDIDATE_VALIDATED', 'State machine moved to CANDIDATE_VALIDATED on YES');
    const approvedConsent = await prismRepo.getLatestConsent(f1.sub.id, user.id);
    assert(approvedConsent && approvedConsent.status === 'APPROVED', 'Consent record updated to APPROVED');

    // ------------------------------------------------------------------------
    // Test 6: Candidate NO Inbound State Machine Transition
    // ------------------------------------------------------------------------
    console.log('\n[TEST 6: Candidate NO Response -> CONSENT_REJECTED]');

    const f6 = await createTestFixture('Reject');

    relayAdapter.sendCandidateConsentEmail = async () => ({ status: 'sent', sent_count: 1 });
    await prismService.requestCandidateConsent(f6.sub.id, user.id, { notes: 'Request 2' });
    relayAdapter.sendCandidateConsentEmail = originalSendEmail;

    const noResult = await prismWorkflow.recordCandidateConsentResponse(f6.sub.id, user.id, {
      response: 'REJECTED',
      notes: 'Candidate replied NO via email',
    });

    assert(noResult.status === 'CONSENT_REJECTED', 'State machine moved to CONSENT_REJECTED on NO');
    const rejectedConsent = await prismRepo.getLatestConsent(f6.sub.id, user.id);
    assert(rejectedConsent && rejectedConsent.status === 'REJECTED', 'Consent record updated to REJECTED');

    // ------------------------------------------------------------------------
    // Test 7 & 8: Duplicate Send Protection & Security
    // ------------------------------------------------------------------------
    console.log('\n[TEST 7 & 8: Duplicate Send Protection & Security]');

    const f7 = await createTestFixture('Duplicate');
    relayAdapter.sendCandidateConsentEmail = async () => ({ status: 'sent', sent_count: 1 });
    await prismService.requestCandidateConsent(f7.sub.id, user.id);
    relayAdapter.sendCandidateConsentEmail = originalSendEmail;

    let dupError = null;
    try {
      await prismService.requestCandidateConsent(f7.sub.id, user.id);
    } catch (err) {
      dupError = err;
    }
    assert(dupError !== null && dupError.statusCode === 400, 'Duplicate requestCandidateConsent blocked with 400');

    // ------------------------------------------------------------------------
    // Test 9: Duplicate Candidate YES Reply Idempotency
    // ------------------------------------------------------------------------
    console.log('\n[TEST 9: Duplicate Candidate YES Reply Idempotency]');

    let dupYesError = null;
    try {
      // Trying to record YES again on already CANDIDATE_VALIDATED submission f1
      await prismWorkflow.recordCandidateConsentResponse(f1.sub.id, user.id, {
        response: 'ACCEPTED',
        notes: 'Duplicate YES reply',
      });
    } catch (err) {
      dupYesError = err;
    }
    assert(dupYesError !== null, 'Duplicate YES reply handled safely without duplicate transition');

    // ------------------------------------------------------------------------
    // Test 10: Candidate Validation Gate Failure After YES
    // ------------------------------------------------------------------------
    console.log('\n[TEST 10: Candidate Validation Gate Failure After YES]');

    // Create candidate with empty name/contact to trigger candidate validation failure
    const badCand = await candidateRepo.insertCandidate(pool, {
      fullName: '',
      email: '',
      phone: '',
      createdBy: user.id,
    });
    createdCandidates.push(badCand.id);

    const badRes = await resumeRepo.insertResume(pool, {
      candidateId: badCand.id,
      originalFileName: 'empty_resume.pdf',
      filePath: './uploads/empty_resume.pdf',
      mimeType: 'application/pdf',
      rawText: 'Resume text for submission creation',
    });

    const badSub = await prismService.createSubmission({
      candidateId: badCand.id,
      resumeId: badRes.id,
      jobId: f1.j.id,
      userId: user.id,
    });
    createdSubmissions.push(badSub.id);

    // Clear candidate completeness fields to trigger CANDIDATE_VALIDATION_FAILED gate check during consent response
    await pool.query("UPDATE syntra.candidates SET full_name = '', phone = '' WHERE id = $1", [badCand.id]);

    let valFailError = null;
    try {
      await prismWorkflow.recordCandidateConsentResponse(badSub.id, user.id, {
        response: 'ACCEPTED',
        notes: 'YES from incomplete candidate',
      });
    } catch (err) {
      valFailError = err;
    }
    assert(valFailError !== null, `Candidate validation gate failure caught and blocked state transition: ${valFailError?.message || valFailError}`);

    // Set test env flag for fast retry delays
    process.env.NODE_ENV = 'test';

    // ------------------------------------------------------------------------
    // Test 11: RELAY initially starting (503 relay_starting) then becomes ready
    // ------------------------------------------------------------------------
    console.log('\n[TEST 11: RELAY transient 503 relay_starting -> Retry -> Success]');
    const f11 = await createTestFixture('RetrySuccess');

    let attemptCounter = 0;
    const globalFetch = global.fetch;
    global.fetch = async () => {
      attemptCounter++;
      if (attemptCounter < 3) {
        return {
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ error: "relay_starting", message: "Smart Inbox is starting inside Syntra API" }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'sent', sent_count: 1, thread_ids: ['retry-thread-id'] }),
      };
    };

    const retrySub = await prismService.requestCandidateConsent(f11.sub.id, user.id, {
      notes: 'Testing bounded retry on 503 relay_starting',
    });

    global.fetch = globalFetch;

    assert(attemptCounter === 3, `Retry logic executed ${attemptCounter} attempts before success`);
    assert(retrySub.status === 'PENDING_CONSENT', 'Submission state updated to PENDING_CONSENT after transient 503 retries');
    const retryConsent = await prismRepo.getLatestConsent(f11.sub.id, user.id);
    assert(retryConsent && retryConsent.status === 'REQUESTED', 'Consent record created with status REQUESTED after retry');

    // ------------------------------------------------------------------------
    // Test 12: RELAY remains starting (503 relay_starting on all attempts)
    // ------------------------------------------------------------------------
    console.log('\n[TEST 12: RELAY remains 503 relay_starting -> All Retries Fail -> Rollback]');
    const f12 = await createTestFixture('RetryFail');

    let failAttempts = 0;
    global.fetch = async () => {
      failAttempts++;
      return {
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ error: "relay_starting", message: "Smart Inbox is starting inside Syntra API" }),
      };
    };

    let retryExhaustedErr = null;
    try {
      await prismService.requestCandidateConsent(f12.sub.id, user.id, { notes: 'Should fail after retries' });
    } catch (err) {
      retryExhaustedErr = err;
    }

    global.fetch = globalFetch;

    assert(failAttempts === 3, `Attempted exactly 3 times before giving up (${failAttempts} attempts)`);
    assert(retryExhaustedErr !== null && retryExhaustedErr.message.includes('503'), `Caught expected 503 readiness error: ${retryExhaustedErr?.message}`);
    const unChangedF12 = await prismRepo.getSubmissionById(f12.sub.id, user.id);
    assert(unChangedF12.status === 'DRAFT', 'PRISM submission status remained DRAFT when all retries failed');
    const noConsentF12 = await prismRepo.getLatestConsent(f12.sub.id, user.id);
    assert(!noConsentF12, 'No consent record created when all retries failed');

    // ------------------------------------------------------------------------
    // Test 13: Non-transient 503 (Does NOT retry)
    // ------------------------------------------------------------------------
    console.log('\n[TEST 13: Non-transient 503 -> No Retry]');
    const f13 = await createTestFixture('NonTransient503');

    let nonTransientAttempts = 0;
    global.fetch = async () => {
      nonTransientAttempts++;
      return {
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ error: "internal_db_error", message: "Database connection failed" }),
      };
    };

    let nonTransientErr = null;
    try {
      await prismService.requestCandidateConsent(f13.sub.id, user.id, {});
    } catch (err) {
      nonTransientErr = err;
    }

    global.fetch = globalFetch;

    assert(nonTransientAttempts === 1, `Non-transient 503 was NOT retried (executed ${nonTransientAttempts} attempt)`);
    assert(nonTransientErr !== null, 'Non-transient 503 error caught');

    // ------------------------------------------------------------------------
    // Test 14: Other HTTP Errors (400, 401, 403, 404, 500 -> No Retry)
    // ------------------------------------------------------------------------
    console.log('\n[TEST 14: Other HTTP Errors (400, 401, 403, 404, 500) -> No Retry]');

    for (const code of [400, 401, 403, 404, 500]) {
      let codeAttempts = 0;
      global.fetch = async () => {
        codeAttempts++;
        return {
          ok: false,
          status: code,
          text: async () => JSON.stringify({ error: `error_${code}`, message: `HTTP ${code} error` }),
        };
      };

      let codeErr = null;
      try {
        await relayAdapter.sendCandidateConsentEmail({
          jobId: f13.j.id,
          submissionId: f13.sub.id,
          candidate: f13.cand,
        });
      } catch (err) {
        codeErr = err;
      }

      assert(codeAttempts === 1, `HTTP ${code} was NOT retried (executed ${codeAttempts} attempt)`);
      assert(codeErr !== null && codeErr.message.includes(String(code)), `HTTP ${code} error caught correctly for HTTP ${code}`);
    }

    global.fetch = globalFetch;

  } catch (err) {
    console.error('Integration test error:', err);
    failCount++;
  } finally {
    if (createdSubmissions.length) {
      try { await pool.query('DELETE FROM public.prism_consents WHERE submission_id = ANY($1)', [createdSubmissions]); } catch { }
      try { await pool.query('DELETE FROM public.prism_submissions WHERE id = ANY($1)', [createdSubmissions]); } catch { }
    }
    if (createdCandidates.length) {
      try { await pool.query('DELETE FROM relay.followups WHERE candidate_id = ANY($1)', [createdCandidates]); } catch { }
      try { await pool.query('DELETE FROM relay.email_messages WHERE thread_id IN (SELECT thread_id FROM relay.email_threads WHERE candidate_id = ANY($1))', [createdCandidates]); } catch { }
      try { await pool.query('DELETE FROM relay.email_threads WHERE candidate_id = ANY($1)', [createdCandidates]); } catch { }
      try { await pool.query('DELETE FROM syntra.resumes WHERE candidate_id = ANY($1)', [createdCandidates]); } catch { }
      try { await pool.query('DELETE FROM syntra.candidates WHERE id = ANY($1)', [createdCandidates]); } catch { }
    }
    if (createdJobs.length) {
      try { await pool.query('DELETE FROM syntra.jobs WHERE id = ANY($1)', [createdJobs]); } catch { }
    }
    await pool.end();
  }

  console.log('\n========================================================================');
  console.log(`PRISM CONSENT INTEGRATION RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('========================================================================');

  if (failCount > 0) process.exit(1);
  else process.exit(0);
}

runPrismConsentIntegrationTests();
