import { describe, expect, it, afterAll } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { pool } = require("./src/config/db");
const jobRepo = require("./src/repositories/job.repository");
const jobController = require("./src/controllers/job.controller");

describe("Job Description Regression Tests — Deletion & Cascading Cleanups", { timeout: 30000 }, () => {
  const createdJobIds = [];

  // Helper to create a test requirement with matches, scoring log, and submissions
  async function createTestJob(prefix = "regression_jd") {
    const orgRes = await pool.query(
      "SELECT id FROM platform.organizations LIMIT 1"
    );
    const orgId = orgRes.rows[0]?.id;

    const personRes = await pool.query(
      "SELECT id FROM core.people WHERE org_id = $1 LIMIT 1",
      [orgId]
    );
    const personId = personRes.rows[0]?.id;

    const reqRes = await pool.query(
      `INSERT INTO core.requirements (title, primary_role, required_skills, status, org_id)
       VALUES ($1, $2, $3, 'Active', $4)
       RETURNING id, title, org_id`,
      [
        `Test Job ${prefix}`,
        "Fullstack Developer",
        JSON.stringify(["PHP", "MySQL", "JavaScript"]),
        orgId,
      ]
    );
    const job = reqRes.rows[0];
    createdJobIds.push(job.id);

    // Add match if person exists
    if (personId) {
      const resumeRes = await pool.query(
        "SELECT id FROM core.resumes WHERE person_id = $1 LIMIT 1",
        [personId]
      );
      const resumeId = resumeRes.rows[0]?.id;

      await pool.query(
        `INSERT INTO core.matches (org_id, requirement_id, person_id, resume_id, status, score)
         VALUES ($1, $2, $3, $4, 'matched', 90)
         ON CONFLICT DO NOTHING`,
        [orgId, job.id, personId, resumeId || null]
      );

      if (resumeId) {
        // Add syntra.scoring_log
        await pool.query(
          `INSERT INTO syntra.scoring_log (org_id, candidate_id, job_id, resume_id, score)
           VALUES ($1, $2, $3, $4, 90)`,
          [orgId, personId, job.id, resumeId]
        );
      }

      // Add orbit.submission
      await pool.query(
        `INSERT INTO orbit.submissions (org_id, requirement_id, person_id, status)
         VALUES ($1, $2, $3, 'SUBMITTED')`,
        [orgId, job.id, personId]
      );
    }

    // Add core.embeddings
    await pool.query(
      `INSERT INTO core.embeddings (org_id, subject_type, subject_id, model, model_version, embedding)
       VALUES ($1, 'requirement', $2, 'text-embedding-3-small', 'v1', ARRAY[0.1, 0.2, 0.3]::real[])`,
      [orgId, job.id]
    );

    return { jobId: job.id, orgId: job.org_id };
  }

  afterAll(async () => {
    // Cleanup any lingering test jobs
    if (createdJobIds.length > 0) {
      try {
        await pool.query(
          "DELETE FROM core.matches WHERE requirement_id = ANY($1::uuid[])",
          [createdJobIds]
        );
        await pool.query(
          "DELETE FROM prism.submissions WHERE requirement_id = ANY($1::uuid[])",
          [createdJobIds]
        );
        await pool.query(
          "DELETE FROM orbit.placements WHERE requirement_id = ANY($1::uuid[])",
          [createdJobIds]
        );
        await pool.query(
          "DELETE FROM orbit.submissions WHERE requirement_id = ANY($1::uuid[])",
          [createdJobIds]
        );
        await pool.query(
          "DELETE FROM syntra.scoring_log WHERE job_id = ANY($1::uuid[])",
          [createdJobIds]
        );
        await pool.query(
          "DELETE FROM core.embeddings WHERE subject_type = 'requirement' AND subject_id = ANY($1::uuid[])",
          [createdJobIds]
        );
        await pool.query(
          "DELETE FROM core.requirements WHERE id = ANY($1::uuid[])",
          [createdJobIds]
        );
      } catch {
        /* best effort cleanup */
      }
    }
  });

  describe("JD Deletion", () => {
    it("1. deletes an existing JD cleanly without SQL syntax errors", async () => {
      const { jobId } = await createTestJob("clean_delete");

      const deleted = await jobRepo.deleteJob(jobId);
      expect(deleted).toBe(true);

      const check = await pool.query(
        "SELECT id FROM core.requirements WHERE id = $1",
        [jobId]
      );
      expect(check.rows.length).toBe(0);
    });

    it("2. deletes JD with associated matches, submissions, scoring logs, and embeddings in transaction", async () => {
      const { jobId } = await createTestJob("full_cascade");

      // Verify records exist before deletion
      const matchBefore = await pool.query(
        "SELECT id FROM core.matches WHERE requirement_id = $1",
        [jobId]
      );
      expect(matchBefore.rows.length).toBeGreaterThan(0);

      const deleted = await jobRepo.deleteJob(jobId);
      expect(deleted).toBe(true);

      // Verify all dependent rows were cleaned up safely
      const matchAfter = await pool.query(
        "SELECT id FROM core.matches WHERE requirement_id = $1",
        [jobId]
      );
      expect(matchAfter.rows.length).toBe(0);

      const subAfter = await pool.query(
        "SELECT id FROM orbit.submissions WHERE requirement_id = $1",
        [jobId]
      );
      expect(subAfter.rows.length).toBe(0);

      const scoreAfter = await pool.query(
        "SELECT id FROM syntra.scoring_log WHERE job_id = $1",
        [jobId]
      );
      expect(scoreAfter.rows.length).toBe(0);

      const embedAfter = await pool.query(
        "SELECT id FROM core.embeddings WHERE subject_type = 'requirement' AND subject_id = $1",
        [jobId]
      );
      expect(embedAfter.rows.length).toBe(0);

      const reqAfter = await pool.query(
        "SELECT id FROM core.requirements WHERE id = $1",
        [jobId]
      );
      expect(reqAfter.rows.length).toBe(0);
    });

    it("3. returns false and 404 for nonexistent JD", async () => {
      const fakeId = "00000000-0000-4000-a000-000000000099";
      const result = await jobRepo.deleteJob(fakeId);
      expect(result).toBe(false);

      let statusCode = null;
      let jsonPayload = null;
      const mockReq = { params: { jobId: fakeId } };
      const mockRes = {
        status: (code) => {
          statusCode = code;
          return {
            json: (data) => { jsonPayload = data; },
            send: () => {},
          };
        },
      };

      await jobController.deleteJob(mockReq, mockRes, () => {});
      expect(statusCode).toBe(404);
      expect(jsonPayload?.error).toBe("job_not_found");
    });

    it("4. validates JD UUID and returns 400 Bad Request for malformed ID", async () => {
      let statusCode = null;
      let jsonPayload = null;
      const mockReq = { params: { jobId: "not-a-valid-uuid" } };
      const mockRes = {
        status: (code) => {
          statusCode = code;
          return {
            json: (data) => { jsonPayload = data; },
            send: () => {},
          };
        },
      };

      await jobController.deleteJob(mockReq, mockRes, () => {});
      expect(statusCode).toBe(400);
      expect(jsonPayload?.error).toBe("invalid_job_id");
    });

    it("5. handles bulk deletion of multiple JDs", async () => {
      const job1 = await createTestJob("bulk_1");
      const job2 = await createTestJob("bulk_2");

      const result = await jobRepo.deleteJobs([job1.jobId, job2.jobId]);
      expect(result.deleted).toBeGreaterThanOrEqual(2);

      const check = await pool.query(
        "SELECT id FROM core.requirements WHERE id = ANY($1::uuid[])",
        [[job1.jobId, job2.jobId]]
      );
      expect(check.rows.length).toBe(0);
    });
  });
});
