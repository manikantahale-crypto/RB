/**
 * Durable Regression Test Suite: Document Type Classification (JD vs Resume)
 * Tests cross-tab document mismatch detection and edge-case phrasing.
 */

const { validateJdDocument } = require('../src/workers/jdUploaded.worker');
const { validateResumeDocument } = require('../src/workers/resumeUploaded.worker');

console.log('========================================================================');
console.log('RUNNING REGRESSION SUITE: JD vs RESUME DOCUMENT TYPE CLASSIFICATION');
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

// ------------------------------------------------------------------------
// Test Fixtures
// ------------------------------------------------------------------------

const realResumeOlivia = `Olivia Martin
QA Automation Engineer
Consultant Type: Internal | Experience: 7 years
Current Location: Phoenix, AZ | Work Authorization: US Citizen
Primary Domain: Healthcare
Professional Summary
Olivia Martin is a QA Automation Engineer with 7 years of experience supporting healthcare technology initiatives.
Technical Skills
Selenium, Java, Cypress, Playwright, API Testing, Jenkins, SQL, Postman
Professional Experience
Senior Project - Healthcare
Designed, developed, tested, deployed, and supported enterprise solutions.
Education
Bachelor's degree in Computer Science / Information Technology
Availability & Preferences
Availability: Immediately or within 2 weeks | Preferred Location: Phoenix, AZ | Work Authorization: US Citizen`;

const realJdStandard = `Senior Full-Stack Node & React Architect
Client: Global FinTech Innovations
Location: New York, NY (Hybrid)
Rate: $90/hr C2C
Job Description:
We are seeking a Senior Full-Stack Architect with 8+ years of experience in Node.js, TypeScript, React, PostgreSQL, Docker, Kubernetes, and AWS microservices.
Key Responsibilities:
- Lead the architecture and implementation of scalable backend services
- Design high-performance React user interfaces
- Build CI/CD pipelines and Kubernetes deployment manifests
Required Qualifications:
- 8+ years with Node.js and TypeScript
- Deep knowledge of PostgreSQL database design
- Accepted visas: H1B, GC, US Citizen`;

const edgeCaseJdGenericNameAndCandidatePhrasing = `Role: Senior Cloud Infrastructure Engineer
Client: Apex Financial Systems
Location: Chicago, IL (Remote)
Rate: $95/hr C2C
About the Role:
Our client is seeking an experienced candidate with 8+ years of professional experience in Cloud Infrastructure.
The ideal candidate will have strong technical skills and professional experience designing high-availability systems.
Key Responsibilities:
- Design and maintain AWS cloud infrastructure using Terraform
- Partner with development teams on Kubernetes deployments and container orchestration
Required Qualifications:
- Bachelor's degree in Computer Science or equivalent experience
- Proven track record supporting enterprise production systems
- Strong communication and cross-functional collaboration skills`;

// ------------------------------------------------------------------------
// TEST SUITE 1: Inverse Case - Real JD uploaded under "Resume" tab
// ------------------------------------------------------------------------
console.log('[TEST SUITE 1: Inverse Case - Real JD uploaded under Resume tab]');
const test1 = validateResumeDocument(realJdStandard, 'senior_node_react_architect_jd.docx');
assert(!test1.isValid, 'Real JD uploaded to Resume tab is flagged as invalid for Resume tab');
assert(
  test1.reason && test1.reason.includes("Job Description"),
  `Returns specific guidance: "${test1.reason}"`
);

// ------------------------------------------------------------------------
// TEST SUITE 2: Edge Case JD - Generic filename & candidate-style phrasing
// ------------------------------------------------------------------------
console.log('\n[TEST SUITE 2: Edge Case JD with generic filename & candidate-style phrasing]');
// Under JD Tab: Should be accepted (isValid: true)
const test2a = validateJdDocument(edgeCaseJdGenericNameAndCandidatePhrasing, 'Client_Spec_782.docx');
assert(test2a.isValid, 'Edge-case JD is accepted under Job Description tab (NOT false-flagged as resume)');

// Under Resume Tab: Should be blocked (isValid: false)
const test2b = validateResumeDocument(edgeCaseJdGenericNameAndCandidatePhrasing, 'Client_Spec_782.docx');
assert(!test2b.isValid, 'Edge-case JD is blocked under Resume tab');
assert(
  test2b.reason && test2b.reason.includes("Job Description"),
  `Returns specific guidance: "${test2b.reason}"`
);

// ------------------------------------------------------------------------
// TEST SUITE 3: Real Resume uploaded under "Job Description" tab
// ------------------------------------------------------------------------
console.log('\n[TEST SUITE 3: Real Resume uploaded under Job Description tab]');
const test3 = validateJdDocument(realResumeOlivia, '09_Olivia_Martin_QA.docx');
assert(!test3.isValid, 'Real Resume (Olivia Martin) uploaded to JD tab is flagged as invalid for JD tab');
assert(
  test3.reason && test3.reason.includes("Candidate Resume"),
  `Returns specific guidance: "${test3.reason}"`
);

// ------------------------------------------------------------------------
// TEST SUITE 4: Real Resume uploaded under "Resume" tab
// ------------------------------------------------------------------------
console.log('\n[TEST SUITE 4: Real Resume uploaded under Resume tab]');
const test4 = validateResumeDocument(realResumeOlivia, '09_Olivia_Martin_QA.docx');
assert(test4.isValid, 'Real Resume (Olivia Martin) is accepted under Resume tab');

// ------------------------------------------------------------------------
// TEST SUITE 6: Real Resume (Sofia Ramirez) uploaded under "Job Description" tab
// ------------------------------------------------------------------------
console.log('\n[TEST SUITE 6: Real Resume (Sofia Ramirez) uploaded under Job Description tab]');
const realResumeSofia = `Sofia Ramirez
Senior React Developer
Consultant Type: Internal | Experience: 6 years
Current Location: New York, NY | Work Authorization: US Citizen
Primary Domain: Retail
Professional Summary
Sofia Ramirez is a Senior React Developer with 6 years of experience supporting retail technology initiatives.
Technical Skills
React, TypeScript, JavaScript, Next.js, Node.js, REST APIs, AWS
Professional Experience
Senior Project - Retail
Designed, developed, tested, deployed, and supported enterprise solutions using React.
Education
Bachelor's degree in Computer Science / Information Technology
Availability & Preferences
Availability: Immediately or within 2 weeks | Preferred Location: New York, NY | Work Authorization: US Citizen | Consultant Classification: Internal`;

const test6 = validateJdDocument(realResumeSofia, '04_Sofia_Ramirez_React_Developer.docx');
assert(!test6.isValid, 'Real Resume (Sofia Ramirez) uploaded to JD tab is flagged as invalid for JD tab');
assert(
  test6.reason && test6.reason.includes("Candidate Resume"),
  `Returns specific guidance: "${test6.reason}"`
);

// ------------------------------------------------------------------------
// TEST SUITE 7: Real Resume (Neha Singh) uploaded under "Job Description" tab
// ------------------------------------------------------------------------
console.log('\n[TEST SUITE 7: Real Resume (Neha Singh) uploaded under Job Description tab]');
const realResumeNeha = `Neha Singh
Senior React / Node Engineer
Consultant Type: Internal | Experience: 7 years
Current Location: Jersey City, NJ | Work Authorization: H-1B
Primary Domain: Finance
Professional Summary
Neha Singh is a Senior React / Node Engineer with 7 years of experience supporting finance technology initiatives.
Technical Skills
React, TypeScript, Node.js, Express, PostgreSQL, Redis, AWS, GraphQL
Professional Experience
Senior Project - Finance
Designed, developed, tested, deployed, and supported enterprise solutions.
Education
Bachelor's degree in Computer Science / Information Technology
Availability & Preferences
Availability: Immediately or within 2 weeks | Preferred Location: Jersey City, NJ | Work Authorization: H-1B | Consultant Classification: Internal`;

const test7 = validateJdDocument(realResumeNeha, '10_Neha_Singh_React_Node.docx');
assert(!test7.isValid, 'Real Resume (Neha Singh) uploaded to JD tab is flagged as invalid for JD tab');
assert(
  test7.reason && test7.reason.includes("Candidate Resume"),
  `Returns specific guidance: "${test7.reason}"`
);

// ------------------------------------------------------------------------
// Summary
// ------------------------------------------------------------------------
console.log('\n========================================================================');
console.log(`REGRESSION RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log('========================================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
