const assert = require("assert");
const { pool } = require("../src/config/db");
const matchRepo = require("../src/repositories/match.repository");

async function runTests() {
  console.log("\n====================================================");
  console.log("   CANDIDATE MATCHES DATA CONTRACT TEST SUITE       ");
  console.log("====================================================\n");

  let passed = 0;
  let failed = 0;

  function it(desc, fn) {
    try {
      fn();
      console.log(`  ✓ ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${desc}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  async function itAsync(desc, fn) {
    try {
      await fn();
      console.log(`  ✓ ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${desc}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  console.log("1. Real Candidate Matches Mapping");

  // Fetch Priya and Marcus with matches
  const { rows: cands } = await pool.query(
    `SELECT DISTINCT c.id, c.full_name 
       FROM syntra.candidates c
       JOIN syntra.matches m ON m.candidate_id = c.id
      WHERE c.full_name ILIKE '%Priya%' OR c.full_name ILIKE '%Marcus%'`
  );

  const priya = cands.find(c => c.full_name.toLowerCase().includes("priya"));
  const marcus = cands.find(c => c.full_name.toLowerCase().includes("marcus"));

  assert(priya, "Priya Nair candidate record must exist in DB");
  assert(marcus, "Marcus Chen candidate record must exist in DB");

  await itAsync("Priya Nair has candidate matches with real titles, companies, locations, and scores", async () => {
    const rows = await matchRepo.listMatchesForCandidate(priya.id);
    assert(rows.length > 0, "Priya should have match rows");
    
    // Check at least one row has populated real data
    const scoredRow = rows.find(r => r.score != null);
    assert(scoredRow, "Priya should have at least one scored match");
    assert(scoredRow.job_title && scoredRow.job_title.trim().length > 0, "job_title must not be empty");
    assert(Number(scoredRow.score) <= 100, `Score must be <= 100, got ${scoredRow.score}`);
    
    // Ensure no hardcoded mock placeholders in DB returned values
    assert(scoredRow.company_name !== "Direct Client", "DB query must not hardcode 'Direct Client'");
    assert(scoredRow.location !== "Remote", "DB query must not hardcode 'Remote'");
  });

  await itAsync("Marcus Chen has candidate matches with real titles, companies, locations, and scores", async () => {
    const rows = await matchRepo.listMatchesForCandidate(marcus.id);
    assert(rows.length > 0, "Marcus should have match rows");

    const scoredRow = rows.find(r => r.score != null);
    assert(scoredRow, "Marcus should have at least one scored match");
    assert(scoredRow.job_title && scoredRow.job_title.trim().length > 0, "job_title must not be empty");
    assert(Number(scoredRow.score) <= 100, `Score must be <= 100, got ${scoredRow.score}`);
  });

  console.log("\n2. Candidate Isolation & Disjoint Results");

  await itAsync("Marcus Chen and Priya Nair have distinct match sets and different candidate IDs", async () => {
    const priyaRows = await matchRepo.listMatchesForCandidate(priya.id);
    const marcusRows = await matchRepo.listMatchesForCandidate(marcus.id);

    assert.notStrictEqual(priya.id, marcus.id, "Candidate IDs must be distinct");
    
    const priyaMatchIds = new Set(priyaRows.map(r => r.match_id));
    const marcusMatchIds = new Set(marcusRows.map(r => r.match_id));

    // Match IDs should be disjoint
    for (const mId of marcusMatchIds) {
      assert(!priyaMatchIds.has(mId), `Match ID ${mId} should not belong to both Priya and Marcus`);
    }
  });

  console.log("\n====================================================");
  console.log(`Total Tests Run: ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("====================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests()
  .then(() => pool.end())
  .catch((err) => {
    console.error("Test execution failed:", err);
    pool.end();
    process.exit(1);
  });
