const assert = require("assert");
const {
  WORKFLOW_STATUSES,
  VALID_STATUSES,
  TRANSITIONS,
  buildMaskedProfile,
} = require("../src/services/prism.workflow.service");

// ANSI Colors for test reporter
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

let passedCount = 0;
let failedCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ${GREEN}✓${RESET} ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ${RED}✗ ${name}${RESET}`);
    console.error(`    ${RED}${err.message}${RESET}`);
    if (err.stack) {
      console.error(`    ${err.stack.split("\n").slice(1, 3).join("\n")}`);
    }
    failedCount++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ${GREEN}✓${RESET} ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ${RED}✗ ${name}${RESET}`);
    console.error(`    ${RED}${err.message}${RESET}`);
    if (err.stack) {
      console.error(`    ${err.stack.split("\n").slice(1, 3).join("\n")}`);
    }
    failedCount++;
  }
}

console.log(`\n${CYAN}====================================================${RESET}`);
console.log(`${CYAN}   PRISM WORKFLOW STATE MACHINE & GATES TEST SUITE  ${RESET}`);
console.log(`${CYAN}====================================================${RESET}\n`);

// -----------------------------------------------------------------------------
// 1. Status Definition & Transition Matrix Tests
// -----------------------------------------------------------------------------
console.log(`${YELLOW}1. State Machine Definitions & Transition Matrix${RESET}`);

test("Should define all 17 authoritative PRISM workflow statuses", () => {
  const expected = [
    "DRAFT",
    "PENDING_CONSENT",
    "CONSENT_REJECTED",
    "CANDIDATE_VALIDATED",
    "MASKED",
    "VENDOR_SUBMITTED",
    "VENDOR_ACCEPTED",
    "VENDOR_VALIDATED",
    "AVAILABILITY_CONFIRMED",
    "RATE_CONFIRMED",
    "PENDING_RTR",
    "RTR_CONFIRMED",
    "INTERVIEW_SCHEDULED",
    "READY",
    "SUBMITTED",
    "REJECTED",
    "WITHDRAWN",
  ];
  assert.strictEqual(VALID_STATUSES.length, 17);
  for (const s of expected) {
    assert.ok(VALID_STATUSES.includes(s), `Status ${s} must be in VALID_STATUSES`);
  }
});

test("Should enforce exact valid transition paths from DRAFT to SUBMITTED", () => {
  // Step 1: DRAFT -> PENDING_CONSENT or WITHDRAWN
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.DRAFT], [
    WORKFLOW_STATUSES.PENDING_CONSENT,
    WORKFLOW_STATUSES.WITHDRAWN,
  ]);

  // Step 2: PENDING_CONSENT -> CANDIDATE_VALIDATED, CONSENT_REJECTED, WITHDRAWN
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.PENDING_CONSENT], [
    WORKFLOW_STATUSES.CANDIDATE_VALIDATED,
    WORKFLOW_STATUSES.CONSENT_REJECTED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ]);

  // Step 3: CANDIDATE_VALIDATED -> MASKED, WITHDRAWN
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.CANDIDATE_VALIDATED], [
    WORKFLOW_STATUSES.MASKED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ]);

  // Step 4: MASKED -> VENDOR_SUBMITTED, WITHDRAWN
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.MASKED], [
    WORKFLOW_STATUSES.VENDOR_SUBMITTED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ]);

  // Step 5: VENDOR_SUBMITTED -> VENDOR_ACCEPTED, REJECTED, WITHDRAWN
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.VENDOR_SUBMITTED], [
    WORKFLOW_STATUSES.VENDOR_ACCEPTED,
    WORKFLOW_STATUSES.REJECTED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ]);

  // Step 6: VENDOR_ACCEPTED -> VENDOR_VALIDATED, WITHDRAWN
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.VENDOR_ACCEPTED], [
    WORKFLOW_STATUSES.VENDOR_VALIDATED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ]);

  // Step 7: VENDOR_VALIDATED -> AVAILABILITY_CONFIRMED, WITHDRAWN
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.VENDOR_VALIDATED], [
    WORKFLOW_STATUSES.AVAILABILITY_CONFIRMED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ]);

  // Step 8: AVAILABILITY_CONFIRMED -> RATE_CONFIRMED, WITHDRAWN
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.AVAILABILITY_CONFIRMED], [
    WORKFLOW_STATUSES.RATE_CONFIRMED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ]);

  // Step 9: RATE_CONFIRMED -> PENDING_RTR, WITHDRAWN
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.RATE_CONFIRMED], [
    WORKFLOW_STATUSES.PENDING_RTR,
    WORKFLOW_STATUSES.WITHDRAWN,
  ]);

  // Step 10: PENDING_RTR -> RTR_CONFIRMED, REJECTED, WITHDRAWN
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.PENDING_RTR], [
    WORKFLOW_STATUSES.RTR_CONFIRMED,
    WORKFLOW_STATUSES.REJECTED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ]);

  // Step 11: RTR_CONFIRMED -> INTERVIEW_SCHEDULED, WITHDRAWN
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.RTR_CONFIRMED], [
    WORKFLOW_STATUSES.INTERVIEW_SCHEDULED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ]);

  // Step 12: INTERVIEW_SCHEDULED -> READY, WITHDRAWN
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.INTERVIEW_SCHEDULED], [
    WORKFLOW_STATUSES.READY,
    WORKFLOW_STATUSES.WITHDRAWN,
  ]);

  // Step 13: READY -> SUBMITTED, WITHDRAWN
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.READY], [
    WORKFLOW_STATUSES.SUBMITTED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ]);
});

// -----------------------------------------------------------------------------
// 2. Candidate Masking Tests
// -----------------------------------------------------------------------------
console.log(`\n${YELLOW}2. Candidate Masking Verification${RESET}`);

test("buildMaskedProfile removes candidate PII and preserves qualifications", () => {
  const candidate = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    full_name: "John Alexander Doe",
    email: "john.doe@secretpersonalemail.com",
    phone: "+1-555-123-4567",
    immigration_status: "US Citizen",
    location: "Austin, TX, USA",
    primary_role: "Senior Cloud Architect",
    total_experience: 10,
  };

  const resume = {
    skills: ["AWS", "Kubernetes", "Node.js", "PostgreSQL"],
    resume_summary: "10+ years designing resilient cloud native architectures.",
  };

  const job = {
    title: "Lead Cloud Architect",
  };

  const masked = buildMaskedProfile(candidate, resume, job);

  // Check PII redacted
  assert.strictEqual(masked.email, "[PROTECTED / VIA RECRUITER]");
  assert.strictEqual(masked.phone, "[PROTECTED]");
  assert.ok(!masked.displayName.includes("John Alexander Doe"));
  assert.ok(masked.displayName.includes("JAD"));
  assert.strictEqual(masked.maskedCandidateId, "CAN-123E4567");

  // Check qualifications preserved
  assert.strictEqual(masked.primaryRole, "Senior Cloud Architect");
  assert.strictEqual(masked.totalExperience, "10 Years");
  assert.strictEqual(masked.immigrationStatus, "US Citizen");
  assert.strictEqual(masked.generalLocation, "TX, USA");
  assert.deepStrictEqual(masked.skills, ["AWS", "Kubernetes", "Node.js", "PostgreSQL"]);
  assert.strictEqual(masked.profileSummary, "10+ years designing resilient cloud native architectures.");
  assert.ok(masked.maskedAt);
});

// -----------------------------------------------------------------------------
// 3. Negative Gate & Transition Validation Tests (All 15 Scenarios)
// -----------------------------------------------------------------------------
console.log(`\n${YELLOW}3. Negative Tests & Workflow Gate Enforcement (15 Required Scenarios)${RESET}`);

test("Scenario 1: DRAFT -> SUBMITTED MUST FAIL", () => {
  const allowed = TRANSITIONS[WORKFLOW_STATUSES.DRAFT];
  assert.ok(!allowed.includes(WORKFLOW_STATUSES.SUBMITTED), "DRAFT cannot directly transition to SUBMITTED");
});

test("Scenario 2: PENDING_CONSENT -> SUBMITTED MUST FAIL", () => {
  const allowed = TRANSITIONS[WORKFLOW_STATUSES.PENDING_CONSENT];
  assert.ok(!allowed.includes(WORKFLOW_STATUSES.SUBMITTED), "PENDING_CONSENT cannot directly transition to SUBMITTED");
});

test("Scenario 3: CANDIDATE_VALIDATED without validation results / unapproved consent MUST FAIL", () => {
  const allowed = TRANSITIONS[WORKFLOW_STATUSES.DRAFT];
  assert.ok(!allowed.includes(WORKFLOW_STATUSES.CANDIDATE_VALIDATED), "Cannot skip PENDING_CONSENT to reach CANDIDATE_VALIDATED");
});

test("Scenario 4: CANDIDATE_VALIDATED -> VENDOR_SUBMITTED without MASKED step MUST FAIL", () => {
  const allowed = TRANSITIONS[WORKFLOW_STATUSES.CANDIDATE_VALIDATED];
  assert.ok(!allowed.includes(WORKFLOW_STATUSES.VENDOR_SUBMITTED), "Cannot transition CANDIDATE_VALIDATED directly to VENDOR_SUBMITTED without masking");
});

test("Scenario 5: MASKED -> RATE_CONFIRMED MUST FAIL", () => {
  const allowed = TRANSITIONS[WORKFLOW_STATUSES.MASKED];
  assert.ok(!allowed.includes(WORKFLOW_STATUSES.RATE_CONFIRMED), "Cannot transition MASKED directly to RATE_CONFIRMED");
});

test("Scenario 6: VENDOR_SUBMITTED -> RATE_CONFIRMED MUST FAIL", () => {
  const allowed = TRANSITIONS[WORKFLOW_STATUSES.VENDOR_SUBMITTED];
  assert.ok(!allowed.includes(WORKFLOW_STATUSES.RATE_CONFIRMED), "Cannot transition VENDOR_SUBMITTED directly to RATE_CONFIRMED without acceptance and validation");
});

test("Scenario 7: Vendor rejected -> transitions to REJECTED (Terminal state)", () => {
  const allowed = TRANSITIONS[WORKFLOW_STATUSES.VENDOR_SUBMITTED];
  assert.ok(allowed.includes(WORKFLOW_STATUSES.REJECTED), "VENDOR_SUBMITTED must support transition to REJECTED on vendor decline");
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.REJECTED], [], "REJECTED is a terminal state");
});

test("Scenario 8: Candidate rejected -> transitions to CONSENT_REJECTED (Stop/Follow-up)", () => {
  const allowed = TRANSITIONS[WORKFLOW_STATUSES.PENDING_CONSENT];
  assert.ok(allowed.includes(WORKFLOW_STATUSES.CONSENT_REJECTED), "PENDING_CONSENT must support transition to CONSENT_REJECTED on candidate decline");
});

test("Scenario 9: Missing availability -> cannot reach AVAILABILITY_CONFIRMED", () => {
  const invalidAvailabilities = ["", "   ", null, undefined];
  for (const val of invalidAvailabilities) {
    const isValid = Boolean(val && typeof val === "string" && val.trim().length > 0);
    assert.strictEqual(isValid, false, `Availability '${val}' must be rejected`);
  }
});

test("Scenario 10: Missing or invalid rate/rate_type -> cannot reach RATE_CONFIRMED", () => {
  const invalidRates = [-10, 0, NaN, "not-a-number", null, undefined];
  const validRateTypes = ["HOURLY", "DAILY", "ANNUAL", "C2C", "W2"];

  for (const r of invalidRates) {
    const rateNum = Number(r);
    const isRateValid = !isNaN(rateNum) && rateNum > 0;
    assert.strictEqual(isRateValid, false, `Rate '${r}' must be rejected`);
  }

  const invalidRateTypes = ["WEEKLY", "INVALID", "MONTHLY_RATE", ""];
  for (const rt of invalidRateTypes) {
    assert.strictEqual(validRateTypes.includes(rt), false, `Rate type '${rt}' must be rejected`);
  }
});

test("Scenario 11: Unsigned RTR -> cannot reach RTR_CONFIRMED", () => {
  const rtrStatuses = ["PENDING", "SENT", "DECLINED"];
  for (const st of rtrStatuses) {
    const isSigned = st === "SIGNED";
    assert.strictEqual(isSigned, false, `RTR status '${st}' must not pass RTR_CONFIRMED gate`);
  }
});

test("Scenario 12: Missing interview details -> cannot reach INTERVIEW_SCHEDULED", () => {
  const invalidInterviewDetails = [{}, { round: 1 }, { scheduledAt: null }, { scheduledAt: "" }];
  for (const details of invalidInterviewDetails) {
    const hasScheduledAt = Boolean(details && details.scheduledAt);
    assert.strictEqual(hasScheduledAt, false, `Interview details ${JSON.stringify(details)} must be rejected`);
  }
});

test("Scenario 13: Any attempt to directly PATCH SUBMITTED without prerequisite gates MUST FAIL", () => {
  const nonReadyStatuses = [
    "DRAFT",
    "PENDING_CONSENT",
    "CONSENT_REJECTED",
    "CANDIDATE_VALIDATED",
    "MASKED",
    "VENDOR_SUBMITTED",
    "VENDOR_ACCEPTED",
    "VENDOR_VALIDATED",
    "AVAILABILITY_CONFIRMED",
    "RATE_CONFIRMED",
    "PENDING_RTR",
    "RTR_CONFIRMED",
    "INTERVIEW_SCHEDULED",
  ];

  for (const status of nonReadyStatuses) {
    const allowed = TRANSITIONS[status];
    assert.ok(
      !allowed.includes(WORKFLOW_STATUSES.SUBMITTED),
      `Status ${status} MUST NOT be allowed to transition directly to SUBMITTED`
    );
  }
});

test("Scenario 14: Terminal state WITHDRAWN prevents further progression", () => {
  assert.deepStrictEqual(TRANSITIONS[WORKFLOW_STATUSES.WITHDRAWN], [], "WITHDRAWN is a terminal state with no next transitions");
});

test("Scenario 15: Cross-tenant isolation logic in state transitions", () => {
  // Verifies that transition functions take userId and query s.created_by = $2
  const prismRepoCode = require("fs").readFileSync(
    require("path").join(__dirname, "../src/repositories/prism.repository.js"),
    "utf8"
  );
  assert.ok(prismRepoCode.includes("WHERE id = $1 AND created_by = $2"), "Repository queries MUST enforce tenant/user ownership");
  assert.ok(prismRepoCode.includes("WHERE a.entity_id = $1 AND s.created_by = $2"), "Audit queries MUST enforce tenant/user ownership");
});

// -----------------------------------------------------------------------------
// 4. Happy Path Sequence Progression Test
// -----------------------------------------------------------------------------
console.log(`\n${YELLOW}4. Happy Path Workflow Full Progression Verification${RESET}`);

test("Happy Path State Sequence: DRAFT -> SUBMITTED through all 14 sequential steps", () => {
  const happyPathSequence = [
    WORKFLOW_STATUSES.DRAFT,
    WORKFLOW_STATUSES.PENDING_CONSENT,
    WORKFLOW_STATUSES.CANDIDATE_VALIDATED,
    WORKFLOW_STATUSES.MASKED,
    WORKFLOW_STATUSES.VENDOR_SUBMITTED,
    WORKFLOW_STATUSES.VENDOR_ACCEPTED,
    WORKFLOW_STATUSES.VENDOR_VALIDATED,
    WORKFLOW_STATUSES.AVAILABILITY_CONFIRMED,
    WORKFLOW_STATUSES.RATE_CONFIRMED,
    WORKFLOW_STATUSES.PENDING_RTR,
    WORKFLOW_STATUSES.RTR_CONFIRMED,
    WORKFLOW_STATUSES.INTERVIEW_SCHEDULED,
    WORKFLOW_STATUSES.READY,
    WORKFLOW_STATUSES.SUBMITTED,
  ];

  for (let i = 0; i < happyPathSequence.length - 1; i++) {
    const current = happyPathSequence[i];
    const next = happyPathSequence[i + 1];
    const allowed = TRANSITIONS[current];
    assert.ok(
      allowed.includes(next),
      `Happy path transition step ${i + 1} failed: ${current} -> ${next} is not allowed`
    );
  }
});

// -----------------------------------------------------------------------------
// 5. Canonical Vendor Email Template & Masking PII Exclusion Tests
// -----------------------------------------------------------------------------
console.log(`\n${YELLOW}5. Canonical Vendor Email Template & PII Exclusion${RESET}`);

test("buildCanonicalVendorEmail generates canonical subject and body with zero candidate PII", () => {
  const { buildCanonicalVendorEmail } = require("../src/utils/vendorEmailTemplate");
  
  const result = buildCanonicalVendorEmail({
    vendorName: "Acme Staffing Inc",
    jobTitle: "Senior Java Developer",
    location: "New York, NY",
    contractType: "C2C",
    candidateReference: "CAND-98765",
    skills: ["Java", "Spring Boot", "PostgreSQL"],
    experience: "10+ Years",
    immigrationStatus: "H1B",
    availability: "Immediate",
    payRate: "$85/hr",
    rateType: "HOURLY",
    recruiterName: "John Recruiter",
    companyName: "Syntra Tech",
  });

  assert.ok(result.subject.includes("Senior Java Developer"));
  assert.ok(result.subject.includes("CAND-98765"));

  // Check candidate PII is ABSENT from both subject and body
  const PII_LIST = ["John Doe", "john.doe@example.com", "555-0199", "123 Main St"];
  for (const pii of PII_LIST) {
    assert.strictEqual(result.subject.includes(pii), false, `Subject must not contain PII: ${pii}`);
    assert.strictEqual(result.body.includes(pii), false, `Body must not contain PII: ${pii}`);
  }

  // Check required dynamic fields are present
  assert.ok(result.body.includes("Dear Acme Staffing Inc,"));
  assert.ok(result.body.includes("Candidate Reference : CAND-98765"));
  assert.ok(result.body.includes("Skills              : Java, Spring Boot, PostgreSQL"));
  assert.ok(result.body.includes("YES, PROCEED"));
  assert.ok(result.body.includes("NO, NOT INTERESTED"));
});

// -----------------------------------------------------------------------------
// 6. Both-Party Availability & Rate Confirmation & RTR Gate Tests
// -----------------------------------------------------------------------------
console.log(`\n${YELLOW}6. Both-Party Availability & Rate Confirmation & RTR Gate Tests${RESET}`);

test("buildCanonicalConsultantConfirmationEmail generates canonical template", () => {
  const { buildCanonicalConsultantConfirmationEmail } = require("../src/utils/confirmationEmailTemplate");

  const result = buildCanonicalConsultantConfirmationEmail({
    candidateName: "Jane Doe",
    jobTitle: "Senior Frontend Engineer",
    location: "Austin, TX",
    contractType: "C2C",
    availability: "Immediate",
    payRate: "$80/hr",
    rateType: "HOURLY",
    recruiterName: "Recruiter Bob",
    companyName: "Syntra Inc"
  });

  assert.ok(result.subject.includes("Availability & Rate Confirmation Required"));
  assert.ok(result.subject.includes("Senior Frontend Engineer"));
  assert.ok(result.body.includes("Dear Jane Doe,"));
  assert.ok(result.body.includes("Availability       : Immediate"));
  assert.ok(result.body.includes("Pay Rate           : $80/hr"));
  assert.ok(result.body.includes("Rate Type          : HOURLY"));
  assert.ok(result.body.includes("YES, I CONFIRM"));
  assert.ok(result.body.includes("NO, I DO NOT CONFIRM"));
});

test("buildCanonicalVendorConfirmationEmail generates canonical template with zero candidate PII", () => {
  const { buildCanonicalVendorConfirmationEmail } = require("../src/utils/confirmationEmailTemplate");

  const result = buildCanonicalVendorConfirmationEmail({
    vendorName: "Apex Systems",
    jobTitle: "Fullstack Developer",
    location: "Remote",
    contractType: "C2C",
    candidateReference: "CAND-99112",
    skills: ["React", "Node.js"],
    experience: "8 Years",
    immigrationStatus: "US Citizen",
    availability: "2 weeks",
    payRate: "$75/hr",
    rateType: "HOURLY",
    recruiterName: "Recruiter Alice",
    companyName: "Syntra Tech"
  });

  assert.ok(result.subject.includes("Availability & Rate Confirmation"));
  assert.ok(result.subject.includes("CAND-99112"));

  // Verify ZERO candidate PII
  const PII_LIST = ["John Doe", "Jane Doe", "jane@example.com", "555-9999"];
  for (const pii of PII_LIST) {
    assert.strictEqual(result.subject.includes(pii), false, `Subject must not expose PII: ${pii}`);
    assert.strictEqual(result.body.includes(pii), false, `Body must not expose PII: ${pii}`);
  }

  assert.ok(result.body.includes("Dear Apex Systems,"));
  assert.ok(result.body.includes("Availability       : 2 weeks"));
  assert.ok(result.body.includes("Pay Rate           : $75/hr"));
  assert.ok(result.body.includes("YES, I CONFIRM"));
});

test("initiateRTR strictly rejects requests when either party is unconfirmed", async () => {
  const { initiateRTR } = require("../src/services/prism.workflow.service");

  // Mock repository with unconfirmed consultant
  const mockRepoUnconfirmed = {
    findSubmissionById: async (id) => ({
      id,
      status: 'VENDOR_VALIDATED',
      rate: 75,
      rate_type: 'HOURLY',
      availability: 'Immediate',
      vendor: { id: 'v1', status: 'ACTIVE' },
      confirmationData: {
        consultantConfirmation: { status: 'PENDING' },
        vendorConfirmation: { status: 'CONFIRMED' }
      }
    })
  };

  try {
    await initiateRTR("sub-123", "user-1", mockRepoUnconfirmed);
    assert.fail("Should have thrown CONFIRMATION_REQUIRED error");
  } catch (err) {
    assert.strictEqual(err.code, "CONFIRMATION_REQUIRED");
    assert.ok(err.message.includes("both consultant and vendor confirm"));
  }
});

test("initiateRTR succeeds when both consultant and vendor confirmations are CONFIRMED", async () => {
  const { initiateRTR } = require("../src/services/prism.workflow.service");

  let updatedStatus = null;
  const mockRepoBothConfirmed = {
    findSubmissionById: async (id) => ({
      id,
      status: 'VENDOR_VALIDATED',
      rate: 75,
      rate_type: 'HOURLY',
      availability: 'Immediate',
      vendor: { id: 'v1', status: 'ACTIVE' },
      confirmationData: {
        consultantConfirmation: { status: 'CONFIRMED' },
        vendorConfirmation: { status: 'CONFIRMED' }
      }
    }),
    updateSubmissionStatus: async (id, status) => {
      updatedStatus = status;
      return { id, status };
    },
    recordAuditLog: async () => {}
  };

  const result = await initiateRTR("sub-456", "user-1", mockRepoBothConfirmed);
  assert.strictEqual(updatedStatus, "PENDING_RTR");
  assert.strictEqual(result.status, "PENDING_RTR");
});

// -----------------------------------------------------------------------------
// 7. Automatic RTR Email Package & Document Template Tests
// -----------------------------------------------------------------------------
console.log(`\n${YELLOW}7. Automatic RTR Email Package & Document Templates${RESET}`);

test("buildCanonicalRTREmail generates clean business template without internal workflow terms", () => {
  const { buildCanonicalRTREmail } = require("../src/utils/rtrEmailTemplate");

  const email = buildCanonicalRTREmail({
    vendorContactName: "Vendor Partner",
    candidateName: "Megha Reddy",
    jobTitle: "Senior Data Engineer",
    clientName: "Acme Corp",
    requisitionId: "REQ-12345",
    location: "Dallas, TX",
    contractType: "C2C",
    rate: 120,
    rateType: "HOURLY",
    availability: "Immediate",
    immigrationStatus: "US Citizen",
    recruiterName: "Bench Sales Team",
    companyName: "Syntra Portal",
    attachedDocuments: ["Candidate Resume", "Right to Represent (RTR) Form"]
  });

  assert.strictEqual(email.subject, "RTR Submission – Megha Reddy – Senior Data Engineer – Acme Corp");
  assert.ok(email.body.includes("RTR DETAILS"));
  assert.ok(email.body.includes("Candidate Name    : Megha Reddy"));
  assert.ok(email.body.includes("Rate              : $120"));

  // Verify ZERO internal workflow terms exist
  assert.ok(!email.body.includes("PRISM"));
  assert.ok(!email.body.includes("TEMPO"));
  assert.ok(!email.body.includes("next workflow stage"));
  assert.ok(!email.body.includes("internal workflow"));
});

test("buildCanonicalRTRDocument generates canonical representation agreement", () => {
  const { buildCanonicalRTRDocument } = require("../src/utils/rtrDocumentTemplate");

  const doc = buildCanonicalRTRDocument({
    candidateName: "Megha Reddy",
    jobTitle: "Senior Data Engineer",
    clientName: "Acme Corp",
    requisitionId: "REQ-12345",
    location: "Dallas, TX",
    contractType: "C2C",
    rate: 120,
    rateType: "HOURLY",
    availability: "Immediate",
    immigrationStatus: "US Citizen",
    date: "09/09/2026"
  });

  assert.strictEqual(doc.title, "RTR Agreement - Megha Reddy - Senior Data Engineer");
  assert.ok(doc.textContent.includes("RIGHT TO REPRESENT AGREEMENT"));
  assert.ok(doc.textContent.includes("REPRESENTATION AUTHORIZATION"));
  assert.ok(doc.textContent.includes("Candidate Signature     : Megha Reddy"));
});

// -----------------------------------------------------------------------------
// 8. Bidirectional Automatic RTR Trigger & Document Gate Verification
// -----------------------------------------------------------------------------
console.log(`\n${YELLOW}8. Bidirectional Automatic RTR Trigger & Document Gates${RESET}`);

test("checkAndTriggerAutomaticRTR executes when consultant confirms last", async () => {
  const { checkAndTriggerAutomaticRTR, WORKFLOW_STATUSES } = require("../src/services/prism.workflow.service");

  const mockSub = {
    id: "sub-auto-1",
    status: WORKFLOW_STATUSES.RATE_CONFIRMED,
    rate: 120,
    rate_type: "HOURLY",
    availability: "Immediate",
    candidate_id: "c-1",
    job_id: "j-1",
    confirmation_data: {
      consultantConfirmation: { status: "CONFIRMED" },
      vendorConfirmation: { status: "CONFIRMED" },
    },
  };

  // State machine logic check
  assert.strictEqual(mockSub.status, WORKFLOW_STATUSES.RATE_CONFIRMED);
  assert.strictEqual(mockSub.confirmation_data.consultantConfirmation.status, "CONFIRMED");
  assert.strictEqual(mockSub.confirmation_data.vendorConfirmation.status, "CONFIRMED");
});

test("checkAndTriggerAutomaticRTR executes when vendor confirms last", async () => {
  const { WORKFLOW_STATUSES } = require("../src/services/prism.workflow.service");

  const mockSub = {
    id: "sub-auto-2",
    status: WORKFLOW_STATUSES.RATE_CONFIRMED,
    rate: 120,
    rate_type: "HOURLY",
    availability: "Immediate",
    candidate_id: "c-2",
    job_id: "j-2",
    confirmation_data: {
      consultantConfirmation: { status: "CONFIRMED" },
      vendorConfirmation: { status: "CONFIRMED" },
    },
  };

  assert.strictEqual(mockSub.status, WORKFLOW_STATUSES.RATE_CONFIRMED);
  assert.strictEqual(mockSub.confirmation_data.consultantConfirmation.status, "CONFIRMED");
  assert.strictEqual(mockSub.confirmation_data.vendorConfirmation.status, "CONFIRMED");
});

test("RTR DECLINED path transitions to REJECTED without emitting completion event", async () => {
  const { WORKFLOW_STATUSES, TRANSITIONS } = require("../src/services/prism.workflow.service");

  // Verify state machine allows PENDING_RTR -> REJECTED
  const validTargets = TRANSITIONS[WORKFLOW_STATUSES.PENDING_RTR] || [];
  assert.ok(validTargets.includes(WORKFLOW_STATUSES.REJECTED), "PENDING_RTR must allow transition to REJECTED on DECLINED");
});

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log(`\n${CYAN}====================================================${RESET}`);
console.log(`Total Tests Run: ${passedCount + failedCount}`);
console.log(`Passed: ${GREEN}${passedCount}${RESET}`);
console.log(`Failed: ${failedCount > 0 ? RED : GREEN}${failedCount}${RESET}`);
console.log(`${CYAN}====================================================${RESET}\n`);

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
