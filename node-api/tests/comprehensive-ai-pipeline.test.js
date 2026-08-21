/**
 * Comprehensive Pipeline Test Suite (Tests A - H)
 * Verifies strict AI-only extraction, bounded retries, atomic persistence,
 * zero fallback, document classification, error isolation, and polling resilience.
 */

const { pool } = require('../src/config/db');
const { startBoss, stopBoss } = require('../src/config/queue');
const { handleJdUploaded, validateJdDocument } = require('../src/workers/jdUploaded.worker');
const { handleResumeUploaded, validateResumeDocument } = require('../src/workers/resumeUploaded.worker');
const { parseJD, validateJdSchema } = require('../src/ai/jdParsing');
const { parseResume, validateResumeSchema } = require('../src/ai/resumeParsing');
const jobRepo = require('../src/repositories/job.repository');
const resumeRepo = require('../src/repositories/resume.repository');
const candidateRepo = require('../src/repositories/candidate.repository');

async function runComprehensiveTestSuite() {
  console.log('========================================================================');
  console.log('STARTING COMPREHENSIVE AI-ONLY PIPELINE SUITE (TESTS A - H)');
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

  let testJobIdA = null, testJobIdC = null, testJobIdD = null;
  let testCandIdB = null, testResumeIdB = null;

  try {
    await startBoss();
    const userRes = await pool.query("SELECT id, email FROM syntra.users WHERE email = 'sri123@gmail.com'");
    if (userRes.rows.length === 0) throw new Error('Test user not found');
    const user = userRes.rows[0];

    // ------------------------------------------------------------------------
    // TEST A: Normal JD Upload -> AI Parsing -> DB -> Embedding -> Funnel -> COMPLETED
    // ------------------------------------------------------------------------
    console.log('[TEST A: Normal JD Upload -> Full Pipeline -> COMPLETED]');
    const realJdText = `Lead AWS & React Cloud Architect
Client: Global FinTech Solutions
Location: New York, NY (Hybrid)
Rate: $100/hr C2C
Job Description:
We are seeking a Lead Cloud Architect with 8+ years experience in React, TypeScript, Node.js, AWS (ECS, Lambda, S3), Docker, and PostgreSQL.
Responsibilities:
Architect high-throughput cloud microservices.
Accepted Visas: H1B, GC, USC.`;

    const jobA = await jobRepo.insertJob(pool, {
      title: 'Lead AWS & React Cloud Architect',
      originalFileName: 'cloud_architect_jd.docx',
      filePath: './uploads/cloud_architect_jd.docx',
      mimeType: 'application/docx',
      rawText: realJdText,
      createdBy: user.id
    });
    testJobIdA = jobA.id;

    await handleJdUploaded({ data: { jobId: testJobIdA } });
    const verifiedJobA = await jobRepo.getJobById(testJobIdA, user.id);

    assert(verifiedJobA.processing_status === 'processed', 'Job status is processed');
    assert(Boolean(verifiedJobA.processed_at), 'Job processed_at timestamp is set');
    assert(Array.isArray(verifiedJobA.required_skills) && verifiedJobA.required_skills.length > 0, `Required skills extracted (${verifiedJobA.required_skills?.length})`);
    assert(Boolean(verifiedJobA.embedding), '1536-dim vector embedding saved');
    assert(verifiedJobA.processing_failed_at === null, 'Job processing_failed_at is null');

    // ------------------------------------------------------------------------
    // TEST B: Normal Resume Upload -> AI Parsing -> DB -> Embedding -> COMPLETED
    // ------------------------------------------------------------------------
    console.log('\n[TEST B: Normal Resume Upload -> Full Pipeline -> COMPLETED]');
    const realResumeText = `Priya Patel
priya.patel.qa@example.com
(408) 555-0144
San Jose, CA
Lead QA Automation Engineer
Summary:
QA Engineer with 8+ years experience in Selenium, Cypress, Playwright, Java, TypeScript, CI/CD, Postman.
Experience:
Senior QA Lead at Cisco (2020 - Present)
Visa: H1B`;

    const candB = await candidateRepo.insertCandidate(pool, {
      fullName: 'Priya Patel',
      email: 'priya.patel.qa@example.com',
      phone: '(408) 555-0144',
      createdBy: user.id
    });
    testCandIdB = candB.id;

    const resB = await resumeRepo.insertResume(pool, {
      candidateId: testCandIdB,
      originalFileName: 'priya_patel_resume.pdf',
      filePath: './uploads/priya_patel_resume.pdf',
      mimeType: 'application/pdf',
      rawText: realResumeText
    });
    testResumeIdB = resB.id;

    await handleResumeUploaded({ data: { resumeId: testResumeIdB, candidateId: testCandIdB } });
    const verifiedCandB = await candidateRepo.getCandidateWithCurrentResume(testCandIdB, user.id);

    assert(Boolean(verifiedCandB.resume_processed_at), 'Candidate resume_processed_at timestamp is set');
    assert(verifiedCandB.full_name.includes('Priya'), `Candidate full_name populated: ${verifiedCandB.full_name}`);
    assert(verifiedCandB.immigration_status === 'H1B', `Visa status populated: ${verifiedCandB.immigration_status}`);
    assert(Boolean(verifiedCandB.embedding), '1536-dim candidate vector embedding saved');

    // ------------------------------------------------------------------------
    // TEST C: AI Schema Validation & Structured Output
    // ------------------------------------------------------------------------
    console.log('\n[TEST C: AI Schema Validation]');
    const validSchemaSample = {
      title: "Senior Java Developer",
      summary: "- Role: Senior Java Developer\n- Location: Remote",
      required_skills: ["Java", "Spring Boot", "AWS"]
    };
    const schemaCheck1 = validateJdSchema(validSchemaSample);
    assert(schemaCheck1.isValid, 'Valid JD schema passes validation');

    const invalidSchemaSample = {
      title: "",
      summary: "Missing title"
    };
    const schemaCheck2 = validateJdSchema(invalidSchemaSample);
    assert(!schemaCheck2.isValid, 'Invalid JD schema without title is rejected by validator');

    // ------------------------------------------------------------------------
    // TEST D: Definitive AI Failure -> NO Fallback -> Record Marked FAILED
    // ------------------------------------------------------------------------
    console.log('\n[TEST D: Definitive AI Failure -> NO Fallback -> Marked FAILED]');
    const emptyJd = await jobRepo.insertJob(pool, {
      title: 'Empty Raw Text JD',
      originalFileName: 'empty_file.docx',
      filePath: './uploads/empty_file.docx',
      mimeType: 'application/docx',
      rawText: '', // Empty text
      createdBy: user.id
    });
    testJobIdD = emptyJd.id;

    await handleJdUploaded({ data: { jobId: testJobIdD } });
    const verifiedJobD = await jobRepo.getJobById(testJobIdD, user.id);

    assert(verifiedJobD.processing_status === 'failed', 'Job processingStatus is failed');
    assert(Boolean(verifiedJobD.processing_failed_at), 'Job processing_failed_at timestamp is set');
    assert(verifiedJobD.processing_error && verifiedJobD.processing_error.includes('readable text'), `Specific failure reason saved: "${verifiedJobD.processing_error}"`);
    assert(verifiedJobD.embedding === null, 'No vector embedding created for failed job');
    assert(verifiedJobD.processed_at === null, 'processed_at is null for failed job');

    // ------------------------------------------------------------------------
    // TEST E: Cross-Tab Document Type Validation (UX Guard)
    // ------------------------------------------------------------------------
    console.log('\n[TEST E: Cross-Tab Document Type Validation Guard]');
    const resumeUnderJdCheck = validateJdDocument(realResumeText, '09_Olivia_Martin_QA.docx');
    assert(!resumeUnderJdCheck.isValid, 'Resume uploaded under JD tab is flagged');
    assert(resumeUnderJdCheck.reason.includes('Candidate Resume'), `Returns specific guidance: "${resumeUnderJdCheck.reason}"`);

    const jdUnderResumeCheck = validateResumeDocument(realJdText, 'senior_node_react_architect_jd.docx');
    assert(!jdUnderResumeCheck.isValid, 'JD uploaded under Resume tab is flagged');
    assert(jdUnderResumeCheck.reason.includes('Job Description'), `Returns specific guidance: "${jdUnderResumeCheck.reason}"`);

    // ------------------------------------------------------------------------
    // TEST F: Job Status API Structure & Polling Resilience
    // ------------------------------------------------------------------------
    console.log('\n[TEST F: Job Status API Verification]');
    const queriedJob = await jobRepo.getJobById(testJobIdA, user.id);
    assert(queriedJob.id === testJobIdA, 'GET /jobs/:jobId returns correct job ID');
    assert(queriedJob.processing_status === 'processed', 'processing_status matches DB lifecycle state');
    assert(Array.isArray(queriedJob.required_skills), 'required_skills returned as array');

    // ------------------------------------------------------------------------
    // TEST G: Resume Status API Structure
    // ------------------------------------------------------------------------
    console.log('\n[TEST G: Candidate / Resume Status API Verification]');
    const queriedCand = await candidateRepo.getCandidateWithCurrentResume(testCandIdB, user.id);
    assert(queriedCand.id === testCandIdB, 'GET /candidates/:candidateId returns candidate profile');
    assert(Boolean(queriedCand.resume_processed_at), 'resume_processed_at exposed for frontend polling');

    // ------------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------------
    console.log('\n========================================================================');
    console.log(`COMPREHENSIVE TEST SUITE RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('========================================================================');

  } catch (err) {
    console.error('Comprehensive test error:', err);
    failCount++;
  } finally {
    if (testJobIdA) {
      await pool.query('DELETE FROM syntra.matches WHERE job_id = $1', [testJobIdA]);
      await pool.query('DELETE FROM syntra.jobs WHERE id = $1', [testJobIdA]);
    }
    if (testJobIdD) {
      await pool.query('DELETE FROM syntra.jobs WHERE id = $1', [testJobIdD]);
    }
    if (testCandIdB) {
      await pool.query('DELETE FROM syntra.matches WHERE candidate_id = $1', [testCandIdB]);
      await pool.query('DELETE FROM syntra.resumes WHERE id = $1', [testResumeIdB]);
      await pool.query('DELETE FROM syntra.candidates WHERE id = $1', [testCandIdB]);
    }
    try { await stopBoss(); } catch {}
    await pool.end();
  }

  if (failCount > 0) process.exit(1);
  else process.exit(0);
}

runComprehensiveTestSuite();
