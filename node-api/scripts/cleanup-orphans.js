require("dotenv").config();
const { pool } = require("../src/config/db");

async function cleanupOrphans() {
  const isDryRun = process.argv.includes("--dry-run");
  
  try {
    // 1. Find the current user id (just pick the one who owns the resumes, assuming 1 user for local dev or we find the most active one)
    const { rows: users } = await pool.query(
      `SELECT created_by, COUNT(*) as count FROM syntra.candidates WHERE created_by IS NOT NULL GROUP BY created_by ORDER BY count DESC LIMIT 1`
    );
    if (!users.length) {
      console.log("No users found with candidates.");
      process.exit(0);
    }
    const userId = users[0].created_by;
    console.log(`Targeting cleanup for User ID: ${userId}`);

    // 2. Query all resumes for this user
    const { rows: allResumes } = await pool.query(
      `SELECT r.id, r.candidate_id, r.is_current, r.processing_status, r.original_file_name, r.processing_failed_at, c.full_name
       FROM syntra.resumes r
       JOIN syntra.candidates c ON r.candidate_id = c.id
       WHERE c.created_by = $1`,
      [userId]
    );

    console.log(`Total resumes in DB for user: ${allResumes.length}`);

    // Count UI visible vs hidden
    // A resume is UI-visible if it's the current one for its candidate.
    const uiVisibleResumes = allResumes.filter(r => r.is_current === true);
    
    // We want to clean up exact duplicate failed records for the same candidate.
    // Wait, if a candidate has multiple `is_current = true` resumes, that's a data integrity issue.
    // If we have multiple resumes for the same candidate, we keep the latest.
    // But usually each candidate has exactly 1 `is_current = true` resume.
    // Let's identify the 50+ DB vs 3 UI discrepancy. The discrepancy was because 50+ failed resumes were hidden in UI by the list query, but they were STILL `is_current = true`.
    // Now that we FIXED the list query, those 50+ failed resumes WILL SHOW UP in the UI!
    // So if we just delete them now, the user won't have to delete them manually.
    // Wait, the prompt says: "Then perform the cleanup ... DO NOT delete a valid failed resume that should now be displayed and retried".
    // If there are 50 failed resumes because the user tried to upload the same file 50 times, they are probably 50 DIFFERENT candidate records, each with 1 failed resume.
    // Let's group by `original_file_name` and `raw_text`? 
    // Or just group by `original_file_name` and keep the latest one (max uploaded_at).
    
    const { rows: duplicateCandidates } = await pool.query(`
      SELECT r.original_file_name, COUNT(*) as cnt
      FROM syntra.resumes r
      JOIN syntra.candidates c ON r.candidate_id = c.id
      WHERE c.created_by = $1
      GROUP BY r.original_file_name
      HAVING COUNT(*) > 1
    `, [userId]);

    let candidatesToDelete = [];
    
    for (const dup of duplicateCandidates) {
      const { rows: records } = await pool.query(`
        SELECT r.id as resume_id, c.id as candidate_id, r.processing_failed_at, r.processed_at, r.uploaded_at
        FROM syntra.resumes r
        JOIN syntra.candidates c ON r.candidate_id = c.id
        WHERE c.created_by = $1 AND r.original_file_name = $2
        ORDER BY r.uploaded_at DESC
      `, [userId, dup.original_file_name]);
      
      // Keep the first one (most recently uploaded), delete the rest
      const keep = records[0];
      for (let i = 1; i < records.length; i++) {
        candidatesToDelete.push(records[i].candidate_id);
      }
    }

    console.log(`Found ${candidatesToDelete.length} duplicate/stale candidate records to delete.`);

    if (isDryRun) {
      console.log("--- DRY RUN SUMMARY ---");
      console.log("Would delete the following candidate IDs (and their resumes via cascade):", candidatesToDelete);
      console.log("Run without --dry-run to execute.");
    } else {
      console.log("--- EXECUTING CLEANUP ---");
      if (candidatesToDelete.length > 0) {
        await pool.query(`DELETE FROM syntra.candidates WHERE id = ANY($1)`, [candidatesToDelete]);
        console.log(`Deleted ${candidatesToDelete.length} orphaned/duplicate candidates.`);
      }
      console.log("Cleanup complete.");
    }

    process.exit(0);
  } catch (err) {
    console.error("Cleanup failed:", err);
    process.exit(1);
  }
}

cleanupOrphans();
