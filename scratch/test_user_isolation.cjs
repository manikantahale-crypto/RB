const candidateRepo = require("../node-api/src/repositories/candidate.repository");
const jobRepo = require("../node-api/src/repositories/job.repository");
const { pool } = require("../node-api/src/config/db");

async function runSecurityTest() {
  const userA = "10c9e7cc-a50f-4764-be63-c764fb6ba368";
  const userB = "63f8d1c6-18e0-4325-a5c8-8bf43c5ad5b5";

  // Get User A's candidate
  const candA = await candidateRepo.listCandidates({ userId: userA, limit: 1 });
  const candIdA = candA.rows[0].id;

  // Get User A's job
  const jobA = await jobRepo.listJobs({ userId: userA, limit: 1 });
  const jobIdA = jobA.rows[0].id;

  console.log("User A Candidate ID:", candIdA);
  console.log("User A Job ID:", jobIdA);

  // User B tries to retrieve User A's candidate
  const fetchCandAsB = await candidateRepo.getCandidateWithCurrentResume(candIdA, userB);
  console.log("User B fetching User A candidate result:", fetchCandAsB);

  // User B tries to retrieve User A's job
  const fetchJobAsB = await jobRepo.getJobById(jobIdA, userB);
  console.log("User B fetching User A job result:", fetchJobAsB);

  if (!fetchCandAsB && !fetchJobAsB) {
    console.log("SECURITY VERIFIED: User B cannot access User A's records!");
  } else {
    console.error("SECURITY FAILURE: User B was able to access User A's records!");
  }

  await pool.end();
}

runSecurityTest().catch(console.error);
