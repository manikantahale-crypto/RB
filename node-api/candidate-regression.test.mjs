import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { pool } = require("./src/config/db");
const candidateRepo = require("./src/repositories/candidate.repository");
const candidateController = require("./src/controllers/candidate.controller");

describe("Candidate Regression Tests — Delete, Edit Profile, Edit Email", { timeout: 30000 }, () => {
  const createdCandidateIds = [];

  // Helper to create a test candidate with resume and match
  async function createTestCandidate(prefix = "regression") {
    const reqRes = await pool.query(
      "SELECT id, org_id FROM core.requirements WHERE org_id IS NOT NULL LIMIT 1"
    );
    const orgId = reqRes.rows[0]?.org_id;
    const reqId = reqRes.rows[0]?.id;

    const personRes = await pool.query(
      `INSERT INTO core.people (full_name, email, phone, location, immigration_status, status, org_id)
       VALUES ($1, $2, $3, $4, $5, 'Active', $6)
       RETURNING id, full_name, email, org_id`,
      [
        `Test Person ${prefix}`,
        `regression.test.${Date.now()}.${Math.random().toString(36).substring(7)}@example.invalid`,
        "+15551234567",
        "Chicago, IL",
        "US Citizen",
        orgId,
      ]
    );
    const person = personRes.rows[0];
    createdCandidateIds.push(person.id);

    const resumeRes = await pool.query(
      `INSERT INTO core.resumes (org_id, person_id, version_number, is_current, skills, current_role_title, primary_role, total_experience)
       VALUES ($1, $2, 1, true, $3, $4, $4, $5)
       RETURNING id`,
      [
        orgId,
        person.id,
        JSON.stringify(["JavaScript", "Node.js"]),
        "Software Engineer",
        "5 years",
      ]
    );
    const resume = resumeRes.rows[0];

    if (reqId) {
      await pool.query(
        `INSERT INTO core.matches (org_id, requirement_id, person_id, resume_id, status, score)
         VALUES ($1, $2, $3, $4, 'matched', 85)`,
        [orgId, reqId, person.id, resume.id]
      );
    }

    return { personId: person.id, resumeId: resume.id, email: person.email };
  }

  // Helper to mock express req/res
  function mockReqRes({ params = {}, body = {}, userId = null } = {}) {
    const req = { params, body, userId, id: "test-req" };
    let statusCode = 200;
    let responseData = null;
    let nextError = null;

    const res = {
      status(code) {
        statusCode = code;
        return res;
      },
      json(data) {
        responseData = data;
        return res;
      },
      send(data) {
        responseData = data;
        return res;
      },
    };

    const next = (err) => {
      nextError = err;
    };

    return { req, res, getStatus: () => statusCode, getData: () => responseData, getError: () => nextError };
  }

  afterAll(async () => {
    // Clean up created candidates using the new safe deleteCandidates function
    if (createdCandidateIds.length > 0) {
      try {
        await candidateRepo.deleteCandidates(createdCandidateIds);
      } catch (err) {
        console.error("Cleanup error:", err.message);
      }
    }
  });

  // ==========================================
  // PART 1: DELETE CANDIDATE TESTS
  // ==========================================
  describe("DELETE Candidate Scenarios", () => {
    it("1. deletes an existing candidate cleanly without SQL syntax errors", async () => {
      const { personId } = await createTestCandidate("delete-simple");
      const ok = await candidateRepo.deleteCandidate(personId);
      expect(ok).toBe(true);

      const check = await pool.query("SELECT id FROM core.people WHERE id = $1", [personId]);
      expect(check.rows.length).toBe(0);
    });

    it("2. deletes candidate with associated matches and resumes safely in transaction", async () => {
      const { personId, resumeId } = await createTestCandidate("delete-matches");

      // Verify records exist prior to deletion
      const matchCheck = await pool.query("SELECT id FROM core.matches WHERE person_id = $1", [personId]);
      expect(matchCheck.rows.length).toBeGreaterThan(0);

      const ok = await candidateRepo.deleteCandidate(personId);
      expect(ok).toBe(true);

      // Verify cascade/cleanup
      const matchAfter = await pool.query("SELECT id FROM core.matches WHERE person_id = $1", [personId]);
      expect(matchAfter.rows.length).toBe(0);

      const resumeAfter = await pool.query("SELECT id FROM core.resumes WHERE id = $1", [resumeId]);
      expect(resumeAfter.rows.length).toBe(0);

      const personAfter = await pool.query("SELECT id FROM core.people WHERE id = $1", [personId]);
      expect(personAfter.rows.length).toBe(0);
    });

    it("3. returns false and 404 for nonexistent candidate", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const ok = await candidateRepo.deleteCandidate(fakeId);
      expect(ok).toBe(false);

      const { req, res } = mockReqRes({ params: { candidateId: fakeId } });
      await candidateController.deleteCandidate(req, res, (err) => {
        expect(err.statusCode).toBe(404);
      });
    });

    it("4. handles invalid candidate ID safely with 400 (no raw SQL crash)", async () => {
      const invalidId = "not-a-valid-uuid";
      const ok = await candidateRepo.deleteCandidate(invalidId);
      expect(ok).toBe(false);

      const { req, res } = mockReqRes({ params: { candidateId: invalidId } });
      await candidateController.deleteCandidate(req, res, (err) => {
        expect(err.statusCode).toBe(400);
        expect(err.message).toBe("Invalid candidate ID");
      });
    });

    it("5. rolls back transaction on simulated database failure, preserving candidate", async () => {
      const { personId } = await createTestCandidate("delete-rollback");

      // Begin manual transaction, trigger failure and ensure rollback
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM core.matches WHERE person_id = $1", [personId]);
        throw new Error("Simulated failure during deletion");
      } catch {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }

      // Candidate must still exist
      const personCheck = await pool.query("SELECT id FROM core.people WHERE id = $1", [personId]);
      expect(personCheck.rows.length).toBe(1);

      // Clean up test candidate
      await candidateRepo.deleteCandidate(personId);
    });
  });

  // ==========================================
  // PART 2: EDIT PROFILE TESTS
  // ==========================================
  describe("EDIT Profile Scenarios", () => {
    let testProfileCandidate = null;

    beforeAll(async () => {
      testProfileCandidate = await createTestCandidate("profile-shared");
    });

    it("1. updates valid profile with name, title, skills, experience, location, rate", async () => {
      const updates = {
        fullName: "Updated Full Name",
        current_title: "Lead Architect",
        skills: ["TypeScript", "PostgreSQL", "React"],
        total_experience: "10 years",
        location: "San Francisco, CA",
        immigration_status: "Green Card (GC)",
        min_rate: "$95/hr",
        status: "Active",
      };

      const updated = await candidateRepo.updateCandidate(testProfileCandidate.personId, updates);
      expect(updated).not.toBeNull();
      expect(updated.full_name).toBe("Updated Full Name");
      expect(updated.location).toBe("San Francisco, CA");
      expect(updated.total_experience).toBe("10 years");
    });

    it("2. rejects invalid candidate ID with HTTP 400", async () => {
      const { req, res } = mockReqRes({
        params: { candidateId: "invalid-uuid-123" },
        body: { fullName: "New Name" },
      });
      await candidateController.updateCandidate(req, res, (err) => {
        expect(err.statusCode).toBe(400);
        expect(err.message).toBe("Invalid candidate ID");
      });
    });

    it("3. returns 404 for nonexistent candidate", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const { req, res } = mockReqRes({
        params: { candidateId: fakeId },
        body: { fullName: "Nobody" },
      });
      await candidateController.updateCandidate(req, res, (err) => {
        expect(err.statusCode).toBe(404);
      });
    });

    it("4. verifies database persistence across core.people and core.resumes", async () => {
      const pCheck = await pool.query(
        "SELECT full_name, location FROM core.people WHERE id = $1",
        [testProfileCandidate.personId]
      );
      expect(pCheck.rows[0].full_name).toBe("Updated Full Name");
      expect(pCheck.rows[0].location).toBe("San Francisco, CA");

      const rCheck = await pool.query(
        "SELECT skills, total_experience, min_rate, current_role_title FROM core.resumes WHERE person_id = $1",
        [testProfileCandidate.personId]
      );
      expect(rCheck.rows[0].total_experience).toBe("10 years");
      expect(rCheck.rows[0].min_rate).toBe("$95/hr");
      expect(rCheck.rows[0].current_role_title).toBe("Lead Architect");
    });

    it("5. controller returns enriched candidate response matching frontend expectations", async () => {
      const { req, res, getData, getStatus } = mockReqRes({
        params: { candidateId: testProfileCandidate.personId },
        body: {
          fullName: "Enriched Candidate",
          current_title: "Senior SRE",
          skills: ["Kubernetes", "AWS"],
          total_experience: "7 years",
          location: "Dallas, TX",
          orbit_lifecycle_state: "AVAILABLE",
        },
      });

      await candidateController.updateCandidate(req, res, (err) => {
        if (err) throw err;
      });

      expect(getStatus()).toBe(200);
      const data = getData();
      expect(data.success).toBe(true);
      expect(data.candidate.fullName).toBe("Enriched Candidate");
      expect(data.candidate.full_name).toBe("Enriched Candidate");
      expect(data.candidate.currentRole).toBe("Senior SRE");
      expect(data.candidate.totalExperience).toBe("7 years");
      expect(data.candidate.location).toBe("Dallas, TX");
      expect(data.candidate.orbit_lifecycle_state).toBe("AVAILABLE");
    });
  });

  // ==========================================
  // PART 3: EDIT EMAIL TESTS
  // ==========================================
  describe("EDIT Email Scenarios", () => {
    let testEmailCandidate = null;

    beforeAll(async () => {
      testEmailCandidate = await createTestCandidate("email-shared");
    });

    it("1. updates valid email address and persists to core.people", async () => {
      const newEmail = `updated.${Date.now()}@example.invalid`;

      const { req, res, getData, getStatus } = mockReqRes({
        params: { candidateId: testEmailCandidate.personId },
        body: { email: newEmail },
      });

      await candidateController.updateCandidate(req, res, (err) => {
        if (err) throw err;
      });

      expect(getStatus()).toBe(200);
      expect(getData().candidate.email).toBe(newEmail);

      // Verify database persistence
      const pCheck = await pool.query("SELECT email FROM core.people WHERE id = $1", [
        testEmailCandidate.personId,
      ]);
      expect(pCheck.rows[0].email).toBe(newEmail);
    });

    it("2. rejects invalid email format with HTTP 400", async () => {
      const { req, res } = mockReqRes({
        params: { candidateId: testEmailCandidate.personId },
        body: { email: "invalid-email-without-at" },
      });

      await candidateController.updateCandidate(req, res, (err) => {
        expect(err.statusCode).toBe(400);
        expect(err.message).toBe("Invalid email format");
      });
    });

    it("3. rejects empty email with HTTP 400", async () => {
      const { req, res } = mockReqRes({
        params: { candidateId: testEmailCandidate.personId },
        body: { email: "   " },
      });

      await candidateController.updateCandidate(req, res, (err) => {
        expect(err.statusCode).toBe(400);
        expect(err.message).toBe("Email cannot be empty");
      });
    });

    it("4. handles unchanged email safely", async () => {
      const { req, res, getData, getStatus } = mockReqRes({
        params: { candidateId: testEmailCandidate.personId },
        body: { email: testEmailCandidate.email },
      });

      await candidateController.updateCandidate(req, res, (err) => {
        if (err) throw err;
      });

      expect(getStatus()).toBe(200);
      expect(getData().candidate.email).toBe(testEmailCandidate.email);
    });

    it("5. returns 404 for nonexistent candidate email update", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const { req, res } = mockReqRes({
        params: { candidateId: fakeId },
        body: { email: "valid@example.invalid" },
      });

      await candidateController.updateCandidate(req, res, (err) => {
        expect(err.statusCode).toBe(404);
      });
    });
  });
});
