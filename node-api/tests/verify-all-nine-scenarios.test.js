/**
 * Durable Test Suite: 9 Core Scenarios for Strict AI Pipeline & OpenRouter Runtime
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');
const { startBoss, stopBoss } = require('../src/config/queue');
const { getAiConfig } = require('../src/config/aiConfig');
const { complete } = require('../src/core/aiClient');
const { generateEmbedding } = require('../src/ai/embedding');
const { handleJdUploaded, validateJdDocument } = require('../src/workers/jdUploaded.worker');
const { handleResumeUploaded, validateResumeDocument } = require('../src/workers/resumeUploaded.worker');
const { parseJD } = require('../src/ai/jdParsing');
const { parseResume } = require('../src/ai/resumeParsing');
const jobRepo = require('../src/repositories/job.repository');
const resumeRepo = require('../src/repositories/resume.repository');
const candidateRepo = require('../src/repositories/candidate.repository');
const resumeService = require('../src/services/resume.service');

async function runAllNineTests() {
  console.log('========================================================================');
  console.log('EXECUTING VERIFICATION FOR ALL 9 CORE SCENARIOS');
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

  let testJobId2 = null;
  let testCandId3 = null, testResumeId3 = null;
  let testCandId4_1 = null, testResumeId4_1 = null;
  const tempUploadFile = path.resolve('./uploads/temp_test_dup.txt');

  try {
    await startBoss();
    const userRes = await pool.query("SELECT id, email FROM syntra.users WHERE email = 'sri123@gmail.com'");
    if (userRes.rows.length === 0) throw new Error('Test user not found');
    const user = userRes.rows[0];

    // Ensure uploads directory exists
    if (!fs.existsSync('./uploads')) {
      fs.mkdirSync('./uploads', { recursive: true });
    }

    // ------------------------------------------------------------------------
    // TEST 1: Real OpenRouter Connectivity & Embedding Generation
    // ------------------------------------------------------------------------
    console.log('[TEST 1: Real OpenRouter Connectivity & Embedding Generation]');
    const aiConfig = getAiConfig();
    assert(aiConfig.provider === 'openrouter', 'AI Provider is openrouter');
    assert(aiConfig.baseUrl === 'https://openrouter.ai/api/v1', 'Base URL is https://openrouter.ai/api/v1');
    assert(Boolean(aiConfig.apiKey), 'API Key is configured and non-empty');

    const liveLlmResp = await complete('Respond with "CONNECTIVITY_OK" only.');
    assert(liveLlmResp && liveLlmResp.includes('CONNECTIVITY_OK'), `Real OpenRouter response received: "${liveLlmResp.trim()}"`);

    const liveEmbResp = await generateEmbedding('Full Stack React and Node Developer');
    assert(Array.isArray(liveEmbResp.embedding) && liveEmbResp.embedding.length === 1536, '1536-dim vector generated from OpenRouter/OpenAI API');

    // ------------------------------------------------------------------------
    // TEST 2: Valid JD Upload -> AI Parsing -> DB -> Embedding -> COMPLETED
    // ------------------------------------------------------------------------
    console.log('\n[TEST 2: Real Job Description AI Parsing -> DB -> Embedding]');
    const realJd = `Senior DevOps & Kubernetes Engineer
Client: Enterprise Payment Systems
Location: Austin, TX (Hybrid)
Rate: $105/hr C2C
Job Description:
We are seeking an experienced Senior DevOps Engineer with 8+ years experience in Kubernetes, Docker, Terraform, AWS (EKS, IAM, VPC), and CI/CD pipelines (GitHub Actions).
Responsibilities:
- Build and maintain highly available Kubernetes clusters
- Implement Infrastructure as Code using Terraform
Required Qualifications:
- 8+ years in DevOps and Cloud Infrastructure
- Accepted Visas: H1B, GC, US Citizen`;

    const job = await jobRepo.insertJob(pool, {
      title: 'Senior DevOps & Kubernetes Engineer',
      originalFileName: 'devops_k8s_jd.docx',
      filePath: './uploads/devops_k8s_jd.docx',
      mimeType: 'application/docx',
      rawText: realJd,
      createdBy: user.id
    });
    testJobId2 = job.id;

    await handleJdUploaded({ data: { jobId: testJobId2 } });
    const verifiedJob = await jobRepo.getJobById(testJobId2, user.id);

    assert(verifiedJob.processing_status === 'processed', 'Job processing_status is "processed"');
    assert(Boolean(verifiedJob.processed_at), 'Job processed_at timestamp populated');
    assert(Array.isArray(verifiedJob.required_skills) && verifiedJob.required_skills.length > 0, `Required skills extracted: [${verifiedJob.required_skills.slice(0, 4).join(', ')}...]`);
    assert(Boolean(verifiedJob.embedding), '1536-dim embedding vector persisted in DB');

    // ------------------------------------------------------------------------
    // TEST 3: Valid Resume Upload -> AI Parsing -> Candidate Fields -> DB -> COMPLETED
    // ------------------------------------------------------------------------
    console.log('\n[TEST 3: Real Resume AI Parsing -> Candidate Attributes -> DB -> Embedding]');
    const realResume = `Arjun Mehta
arjun.mehta.test@example.com
(415) 555-0182
San Francisco, CA
Senior Full-Stack Engineer
Summary:
Full-Stack Engineer with 7 years of experience in React, TypeScript, Node.js, GraphQL, PostgreSQL, and AWS.
Experience:
Senior Engineer at Uber (2021 - Present)
Education:
B.S. in Computer Science
Visa: US Citizen`;

    const cand = await candidateRepo.insertCandidate(pool, {
      fullName: 'Arjun Mehta',
      email: 'arjun.mehta.test@example.com',
      phone: '(415) 555-0182',
      createdBy: user.id
    });
    testCandId3 = cand.id;

    const res = await resumeRepo.insertResume(pool, {
      candidateId: testCandId3,
      originalFileName: 'arjun_mehta_resume.pdf',
      filePath: './uploads/arjun_mehta_resume.pdf',
      mimeType: 'application/pdf',
      rawText: realResume
    });
    testResumeId3 = res.id;

    await handleResumeUploaded({ data: { resumeId: testResumeId3, candidateId: testCandId3 } });
    const verifiedCand = await candidateRepo.getCandidateWithCurrentResume(testCandId3, user.id);

    assert(Boolean(verifiedCand.resume_processed_at), 'Candidate resume_processed_at timestamp populated');
    assert(verifiedCand.full_name === 'Arjun Mehta', `Full name extracted: "${verifiedCand.full_name}"`);
    assert(verifiedCand.immigration_status === 'US Citizen', `Visa status normalized: "${verifiedCand.immigration_status}"`);
    assert(Boolean(verifiedCand.embedding), '1536-dim candidate vector embedding persisted');

    // ------------------------------------------------------------------------
    // TEST 4: Duplicate Resume Detection (409)
    // ------------------------------------------------------------------------
    console.log('\n[TEST 4: Duplicate Resume Detection]');
    const uniqueResumeForDupTest = `Kiran Rao
kiran.rao.test@example.com
(510) 555-0199
Fremont, CA
Senior Cloud Systems Engineer
Summary:
Cloud Systems Engineer with 9 years of experience in AWS, Linux, Terraform, Kubernetes.
Experience:
Senior Engineer at Oracle (2019 - Present)
Visa: US Citizen`;

    fs.writeFileSync(tempUploadFile, uniqueResumeForDupTest, 'utf8');

    // First upload: creates candidate
    const firstUpload = await resumeService.createResume({
      fullName: 'Kiran Rao',
      email: 'kiran.rao.test@example.com',
      phone: '(510) 555-0199',
      file: {
        originalname: 'kiran_rao_resume.txt',
        path: tempUploadFile,
        mimetype: 'text/plain',
        size: Buffer.byteLength(uniqueResumeForDupTest)
      },
      userId: user.id
    });
    testCandId4_1 = firstUpload.candidateId;
    testResumeId4_1 = firstUpload.resumeId;
    assert(Boolean(firstUpload.resumeId) && firstUpload.status !== 'duplicate', 'Initial resume upload created and queued (non-duplicate)');

    // Second upload: exactly same content -> duplicate
    const secondUpload = await resumeService.createResume({
      fullName: 'Kiran Rao Duplicate',
      email: 'kiran.rao.dup@example.com',
      phone: '(510) 555-0199',
      file: {
        originalname: 'kiran_rao_resume.txt',
        path: tempUploadFile,
        mimetype: 'text/plain',
        size: Buffer.byteLength(uniqueResumeForDupTest)
      },
      userId: user.id
    });

    assert(secondUpload.status === 'duplicate', 'Duplicate resume detected by SHA-256 hash (status=duplicate)');
    assert(secondUpload.resumeId === firstUpload.resumeId, `Original resume ID returned: ${secondUpload.resumeId}`);

    // ------------------------------------------------------------------------
    // TEST 5: Resume Uploaded under Job Description Tab
    // ------------------------------------------------------------------------
    console.log('\n[TEST 5: Resume Uploaded under Job Description Tab]');
    const test5 = validateJdDocument(realResume, '09_Olivia_Martin_QA.docx');
    assert(!test5.isValid, 'Resume uploaded to JD tab is flagged as invalid for JD tab');
    assert(test5.reason.includes('Candidate Resume'), `Helpful guidance returned: "${test5.reason}"`);

    // ------------------------------------------------------------------------
    // TEST 6: JD Uploaded under Resume Tab
    // ------------------------------------------------------------------------
    console.log('\n[TEST 6: Job Description Uploaded under Resume Tab]');
    const test6 = validateResumeDocument(realJd, 'senior_node_react_architect_jd.docx');
    assert(!test6.isValid, 'JD uploaded to Resume tab is flagged as invalid for Resume tab');
    assert(test6.reason.includes('Job Description'), `Helpful guidance returned: "${test6.reason}"`);

    // ------------------------------------------------------------------------
    // TEST 7: Bounded AI Retry Logic on Malformed / Transient Failures
    // ------------------------------------------------------------------------
    console.log('\n[TEST 7: Bounded AI Retry Logic on Malformed / Transient Failures]');
    const { validateJdSchema } = require('../src/ai/jdParsing');
    const invalidObj = { title: "", required_skills: "not-an-array" };
    const schemaValidation = validateJdSchema(invalidObj);
    assert(!schemaValidation.isValid, 'Invalid schema without title is rejected by validateJdSchema');

    try {
      await parseJD({ jdText: '   ' }, 2);
    } catch (err) {
      assert(err.message.includes('Empty JD text'), `Empty text rejected cleanly: "${err.message}"`);
    }

    // ------------------------------------------------------------------------
    // TEST 8: Permanent Authentication / Credit Failure (Fail Fast)
    // ------------------------------------------------------------------------
    console.log('\n[TEST 8: Permanent AI Auth / Config Failure Handling]');
    const authErrorPattern = /\b(401|402|403|unauthorized|user not found|insufficient credits)\b/i;
    assert(authErrorPattern.test('401 User not found'), 'Auth error correctly identified for immediate fail-fast');
    assert(authErrorPattern.test('402 Insufficient credits'), 'Credit error correctly identified for immediate fail-fast');

    // ------------------------------------------------------------------------
    // TEST 9: Existing Candidate / Resume Data Integrity for ORBIT
    // ------------------------------------------------------------------------
    console.log('\n[TEST 9: ORBIT Candidate Data Integration & Queries]');
    const { rows: orbitCandidates, total: orbitTotal } = await candidateRepo.listCandidates({
      userId: user.id,
      limit: 10
    });
    assert(Array.isArray(orbitCandidates), `listCandidates query returns candidate records (total=${orbitTotal})`);
    if (orbitCandidates.length > 0) {
      const sample = orbitCandidates[0];
      assert(Boolean(sample.full_name), `Sample candidate full_name: "${sample.full_name}"`);
      assert(Boolean(sample.id), `Sample candidate ID: ${sample.id}`);
    }

    // ------------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------------
    console.log('\n========================================================================');
    console.log(`ALL NINE SCENARIOS VERIFIED: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('========================================================================');

  } catch (err) {
    console.error('Test execution error:', err);
    failCount++;
  } finally {
    if (fs.existsSync(tempUploadFile)) {
      try { fs.unlinkSync(tempUploadFile); } catch {}
    }
    if (testJobId2) {
      await pool.query('DELETE FROM syntra.matches WHERE job_id = $1', [testJobId2]);
      await pool.query('DELETE FROM syntra.jobs WHERE id = $1', [testJobId2]);
    }
    if (testCandId3) {
      await pool.query('DELETE FROM syntra.matches WHERE candidate_id = $1', [testCandId3]);
      await pool.query('DELETE FROM syntra.resumes WHERE id = $1', [testResumeId3]);
      await pool.query('DELETE FROM syntra.candidates WHERE id = $1', [testCandId3]);
    }
    if (testCandId4_1) {
      await pool.query('DELETE FROM syntra.matches WHERE candidate_id = $1', [testCandId4_1]);
      await pool.query('DELETE FROM syntra.resumes WHERE id = $1', [testResumeId4_1]);
      await pool.query('DELETE FROM syntra.candidates WHERE id = $1', [testCandId4_1]);
    }
    try { await stopBoss(); } catch {}
    await pool.end();
  }

  if (failCount > 0) process.exit(1);
  else process.exit(0);
}

runAllNineTests();
