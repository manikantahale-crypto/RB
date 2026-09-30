const { pool } = require("../node-api/src/config/db");

async function runPhase5Audit() {
  console.log("=== STARTING PHASE 5 DATABASE TENANT AUDIT ===\n");

  // 1. Column Inventory for org_id / organization_id
  console.log("--- 1. TABLES & COLUMNS CONTAINING ORG_ID ---");
  const columnsRes = await pool.query(`
    SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE column_name ILIKE '%org%'
      AND table_schema NOT IN ('information_schema', 'pg_catalog', 'pgboss')
    ORDER BY table_schema, table_name, column_name;
  `);
  console.table(columnsRes.rows);

  // 2. Foreign Key Inventory referencing platform.organizations or platform.org_members
  console.log("\n--- 2. FOREIGN KEYS REFERENCING ORGANIZATIONS / ORG_MEMBERS ---");
  const fkRes = await pool.query(`
    SELECT
      tc.table_schema, 
      tc.table_name, 
      kcu.column_name, 
      ccu.table_schema AS foreign_table_schema,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      tc.constraint_name
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND (ccu.table_name IN ('organizations', 'org_members') OR kcu.column_name ILIKE '%org%')
    ORDER BY tc.table_schema, tc.table_name;
  `);
  console.table(fkRes.rows);

  // 3. Database Functions Inspection
  console.log("\n--- 3. DATABASE FUNCTIONS RELATED TO ORG ---");
  const funcsRes = await pool.query(`
    SELECT n.nspname AS schema_name, p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname ILIKE '%org%'
      AND n.nspname NOT IN ('information_schema', 'pg_catalog')
    ORDER BY n.nspname, p.proname;
  `);
  console.table(funcsRes.rows);

  // Print function definitions for key functions
  const keyFuncs = [
    { schema: 'app', name: 'org_from_creator' },
    { schema: 'app', name: 'core_org_from_person' },
    { schema: 'prism', name: 'org_from_submission' },
    { schema: 'app', name: 'current_org_id' }
  ];

  for (const f of keyFuncs) {
    try {
      const defRes = await pool.query(`
        SELECT pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1 AND p.proname = $2;
      `, [f.schema, f.name]);
      if (defRes.rows.length) {
        console.log(`\n=== FUNCTION DEFINITION: ${f.schema}.${f.name}() ===`);
        console.log(defRes.rows[0].definition);
      }
    } catch (err) {
      console.log(`Could not get definition for ${f.schema}.${f.name}: ${err.message}`);
    }
  }

  // 4. Trigger Inventory
  console.log("\n--- 4. TRIGGERS RELATED TO ORG ---");
  const triggersRes = await pool.query(`
    SELECT 
      event_object_schema AS table_schema,
      event_object_table AS table_name,
      trigger_name,
      action_timing,
      event_manipulation,
      action_statement
    FROM information_schema.triggers
    WHERE action_statement ILIKE '%org%'
       OR trigger_name ILIKE '%org%'
    ORDER BY event_object_schema, event_object_table;
  `);
  console.table(triggersRes.rows);

  // 5. RLS Policies Inventory
  console.log("\n--- 5. RLS POLICIES REFERENCING ORG ---");
  const rlsRes = await pool.query(`
    SELECT 
      schemaname,
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    FROM pg_policies
    WHERE qual ILIKE '%org%' OR with_check ILIKE '%org%' OR policyname ILIKE '%org%'
    ORDER BY schemaname, tablename;
  `);
  console.table(rlsRes.rows);

  // Check RLS status on tables
  console.log("\n--- RLS STATUS ON TABLES ---");
  const rlsTablesRes = await pool.query(`
    SELECT schemaname, tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pgboss')
      AND rowsecurity = true
    ORDER BY schemaname, tablename;
  `);
  console.table(rlsTablesRes.rows);

  // 6. Zero-Organization User Database Behavior Test
  console.log("\n--- 6. ZERO-ORGANIZATION USER DATABASE BEHAVIOR TEST ---");
  const zeroOrgUserId = "88888888-8888-8888-8888-888888888888";
  await pool.query(
    "INSERT INTO platform.users (id, full_name, email, status) VALUES ($1, 'Zero Org User Phase5', 'zeroorg5@test.com', 'active') ON CONFLICT (id) DO NOTHING",
    [zeroOrgUserId]
  );

  // Check platform.org_members for zero-org user
  const zeroMembers = await pool.query("SELECT * FROM platform.org_members WHERE user_id = $1", [zeroOrgUserId]);
  console.log(`Zero-org user platform.org_members count: ${zeroMembers.rows.length}`);

  // Test inserting candidate without org_id
  let candTestResult = "PASS";
  let candErr = null;
  let tempCandId = null;
  try {
    const candRes = await pool.query(
      "INSERT INTO core.people (full_name, created_by, status) VALUES ('Zero Org Cand P5', $1, 'Active') RETURNING id, org_id",
      [zeroOrgUserId]
    );
    tempCandId = candRes.rows[0].id;
    console.log(`Candidate inserted successfully. id: ${tempCandId}, org_id: ${candRes.rows[0].org_id}`);
  } catch (err) {
    candTestResult = "BLOCKED BY TRIGGER/CONSTRAINT";
    candErr = err.message;
    console.log(`Candidate insertion failed: ${err.message}`);
  }

  // Test inserting requirement/job without org_id
  let jobTestResult = "PASS";
  let jobErr = null;
  let tempJobId = null;
  try {
    const jobRes = await pool.query(
      "INSERT INTO core.requirements (title, created_by, status) VALUES ('Zero Org Job P5', $1, 'Staging') RETURNING id, org_id",
      [zeroOrgUserId]
    );
    tempJobId = jobRes.rows[0].id;
    console.log(`Requirement inserted successfully. id: ${tempJobId}, org_id: ${jobRes.rows[0].org_id}`);
  } catch (err) {
    jobTestResult = "BLOCKED BY TRIGGER/CONSTRAINT";
    jobErr = err.message;
    console.log(`Requirement insertion failed: ${err.message}`);
  }

  // Test inserting submission without org_id for zero org user
  let subTestResult = "PASS";
  let subErr = null;
  let tempSubId = null;
  if (tempCandId && tempJobId) {
    try {
      const subRes = await pool.query(
        "INSERT INTO prism.submissions (person_id, requirement_id, status, created_by) VALUES ($1, $2, 'DRAFT', $3) RETURNING id, org_id",
        [tempCandId, tempJobId, zeroOrgUserId]
      );
      tempSubId = subRes.rows[0].id;
      console.log(`Submission inserted successfully. id: ${tempSubId}, org_id: ${subRes.rows[0].org_id}`);
    } catch (err) {
      subTestResult = "BLOCKED BY TRIGGER/CONSTRAINT";
      subErr = err.message;
      console.log(`Submission insertion failed: ${err.message}`);
    }
  } else {
    subTestResult = "SKIPPED (Candidate/Job creation failed)";
  }

  // Clean up temporary zero-org records
  try {
    if (tempSubId) {
      await pool.query("DELETE FROM prism.audit WHERE entity_id = $1", [tempSubId]);
      await pool.query("DELETE FROM prism.submissions WHERE id = $1", [tempSubId]);
    }
    if (tempJobId) await pool.query("DELETE FROM core.requirements WHERE id = $1", [tempJobId]);
    if (tempCandId) await pool.query("DELETE FROM core.people WHERE id = $1", [tempCandId]);
    await pool.query("DELETE FROM platform.users WHERE id = $1", [zeroOrgUserId]);
  } catch (e) {}

  console.log("\n=== ALL PHASE 5 DATABASE AUDIT QUERIES COMPLETED ===");
  await pool.end();
}

runPhase5Audit().catch((err) => {
  console.error("PHASE 5 AUDIT ERROR:", err);
  process.exit(1);
});
