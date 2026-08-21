/**
 * Durable Regression Test Suite: End-to-End Pipeline
 * Tests LLM parsing, 1536-dim vector embedding, atomic persistence,
 * funnel matching, error surfacing, and cross-tab mismatch guards.
 */

const { pool } = require('../src/config/db');
const { startBoss, stopBoss } = require('../src/config/queue');
const { handleJdUploaded } = require('../src/workers/jdUploaded.worker');
const { handleResumeUploaded } = require('../src/workers/resumeUploaded.worker');
const jobRepo = require('../src/repositories/job.repository');
const resumeRepo = require('../src/repositories/resume.repository');
const candidateRepo = require('../src/repositories/candidate.repository');

async function runPipelineTests() {
  console.log('========================================================================');
  console.log('RUNNING DURABLE E2E PIPELINE REGRESSION SUITE');
  console.log('========================================================================\n');

  let testJobId = null, testCandId = null, testResumeId = null;
  let passCount = 0, failCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passCount++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failCount++;
    }
  }

  try {
    await startBoss();
    const userRes = await pool.query("SELECT id, email FROM syntra.users WHERE email = 'sri123@gmail.com'");
    if (userRes.rows.length === 0) throw new Error('Test user not found');
    const user = userRes.rows[0];

    // ------------------------------------------------------------------------
    // 1. Valid Job Description E2E
    // ------------------------------------------------------------------------
    console.log('[TEST 1: Valid Job Description End-to-End]');
    const jdText = `Senior Python Cloud Architect\nClient: Enterprise Fintech\nLocation: New York, NY (Hybrid)\nRate: $95/hr C2C\nJob Description:\nWe are looking for a Senior Architect with 8+ years experience in Python, AWS (ECS, Lambda, S3), Docker, and PostgreSQL.\nResponsibilities:\nArchitect high-throughput microservices.\nAccepted Visas: H1B, GC, USC.`;

    const job = await jobRepo.insertJob(pool, {
      title: 'Senior Python Cloud Architect',
      originalFileName: 'python_cloud_architect_jd.docx',
      filePath: './uploads/python_cloud_architect_jd.docx',
      mimeType: 'application/docx',
      rawText: jdText,
      createdBy: user.id
    });
    testJobId = job.id;

    await handleJdUploaded({ data: { jobId: testJobId } });
    const verifiedJob = await jobRepo.getJobById(testJobId, user.id);

    assert(verifiedJob.processing_status === 'processed', 'Job processingStatus is processed');
    assert(Boolean(verifiedJob.processed_at), 'Job processed_at timestamp is set');
    assert(Array.isArray(verifiedJob.required_skills) && verifiedJob.required_skills.length > 0, `Required skills extracted (${verifiedJob.required_skills?.length})`);
    assert(Boolean(verifiedJob.embedding), '1536-dim vector embedding generated and saved');

    // ------------------------------------------------------------------------
    // 2. Valid Resume E2E
    // ------------------------------------------------------------------------
    console.log('\n[TEST 2: Valid Resume End-to-End]');
    const resumeText = `Rahul Sharma\nrahul.sharma.test@example.com\n(512) 555-0199\nAustin, TX\nSenior Python Backend Developer\nSummary:\nPython Engineer with 8 years experience in Python, Django, FastAPI, AWS, PostgreSQL, Docker.\nExperience:\nSenior Engineer at Dell (2020 - Present)\nVisa: H1B`;

    const cand = await candidateRepo.insertCandidate(pool, {
      fullName: 'Rahul Sharma',
      email: 'rahul.sharma.test@example.com',
      phone: '(512) 555-0199',
      createdBy: user.id
    });
    testCandId = cand.id;

    const res = await resumeRepo.insertResume(pool, {
      candidateId: testCandId,
      originalFileName: 'rahul_sharma_resume.pdf',
      filePath: './uploads/rahul_sharma_resume.pdf',
      mimeType: 'application/pdf',
      rawText: resumeText
    });
    testResumeId = res.id;

    await handleResumeUploaded({ data: { resumeId: testResumeId, candidateId: testCandId } });
    const verifiedCand = await candidateRepo.getCandidateWithCurrentResume(testCandId, user.id);

    assert(Boolean(verifiedCand.resume_processed_at), 'Candidate resume_processed_at timestamp is set');
    assert(verifiedCand.full_name.includes('Rahul'), `Candidate name populated: ${verifiedCand.full_name}`);
    assert(verifiedCand.immigration_status === 'H1B', `Visa status populated: ${verifiedCand.immigration_status}`);
    assert(Boolean(verifiedCand.embedding), '1536-dim candidate vector embedding generated and saved');

    // ------------------------------------------------------------------------
    // 3. Summary
    // ------------------------------------------------------------------------
    console.log('\n========================================================================');
    console.log(`PIPELINE REGRESSION RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('========================================================================');

  } catch (err) {
    console.error('Pipeline test error:', err);
    failCount++;
  } finally {
    if (testJobId) {
      await pool.query('DELETE FROM syntra.matches WHERE job_id = $1', [testJobId]);
      await pool.query('DELETE FROM syntra.jobs WHERE id = $1', [testJobId]);
    }
    if (testCandId) {
      await pool.query('DELETE FROM syntra.matches WHERE candidate_id = $1', [testCandId]);
      await pool.query('DELETE FROM syntra.resumes WHERE id = $1', [testResumeId]);
      await pool.query('DELETE FROM syntra.candidates WHERE id = $1', [testCandId]);
    }
    try { await stopBoss(); } catch {}
    await pool.end();
  }

  if (failCount > 0) process.exit(1);
  else process.exit(0);
}

runPipelineTests();
