const assert = require("assert");
const { pool } = require("../src/config/db");
const env = require("../src/config/env");
const vendorService = require("../src/services/vendor.service");
const userRepo = require("../src/repositories/user.repository");

// ANSI Colors for test reporter
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

let passedCount = 0;
let failedCount = 0;

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

async function runVendorTests() {
  console.log(`\n${CYAN}====================================================${RESET}`);
  console.log(`${CYAN}   VENDOR ONBOARDING & FOREIGN KEY TEST SUITE       ${RESET}`);
  console.log(`${CYAN}====================================================${RESET}\n`);

  console.log(`1. Database Schema & Foreign Key Integrity`);

  await asyncTest("vendors_created_by_fkey constraint is strictly active in PostgreSQL", async () => {
    const fkRes = await pool.query(`
      SELECT tc.constraint_name, tc.table_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.constraint_column_usage AS ccu
        ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'vendors' AND tc.constraint_name = 'vendors_created_by_fkey';
    `);
    assert.strictEqual(fkRes.rows.length, 1, "vendors_created_by_fkey must exist in database");
    assert.strictEqual(fkRes.rows[0].foreign_table_name, "users");
    assert.strictEqual(fkRes.rows[0].foreign_column_name, "id");
  });

  console.log(`\n2. User Schema Mapping & Auto-Provisioning`);

  let testRecruiter;
  await asyncTest("Authenticated recruiter in syntra.users maps correctly to public.users", async () => {
    // Look up or create test user
    const testEmail = `vendor_recruiter_${Date.now()}@syntra.local`;
    testRecruiter = await userRepo.createUser({
      fullName: "Megha Reddy Test",
      email: testEmail,
      passwordHash: "mock_hash",
      role: "Recruiter",
    });
    assert.ok(testRecruiter.id, "User ID must be generated");

    // Verify public.users row was synchronized
    const publicUser = await userRepo.findPublicUserById(testRecruiter.id);
    assert.ok(publicUser, "public.users record must exist for recruiter");
    assert.strictEqual(publicUser.id, testRecruiter.id);
    assert.strictEqual(publicUser.email, testEmail.toLowerCase());
    assert.ok(publicUser.organization_id, "User must have a valid organization_id");
  });

  console.log(`\n3. Vendor Creation & Foreign Key Validation`);

  let createdVendorId;
  const vendorPayload = {
    name: `TechNova Solutions ${Date.now()}`,
    vendorType: "PRIME_VENDOR",
    website: "https://technova.example.com",
    email: "hr@technova.example.com",
    phone: "+1-555-4321",
    location: "Chicago, IL",
    paymentTerms: "Net 45",
    preferredTechnologies: "Python, Go, Kubernetes",
    preferredImmigrationTypes: "US Citizen, Green Card, H1B",
  };

  await asyncTest("POST /vendors creates vendor with valid created_by FK referencing public.users", async () => {
    const vendor = await vendorService.createVendor(testRecruiter.id, vendorPayload);
    assert.ok(vendor.id, "Vendor ID must be generated");
    assert.strictEqual(vendor.name, vendorPayload.name);
    assert.strictEqual(vendor.created_by, testRecruiter.id);
    assert.strictEqual(vendor.status, "PENDING");
    createdVendorId = vendor.id;

    // Verify directly in DB
    const dbRow = await pool.query(`SELECT * FROM public.vendors WHERE id = $1`, [vendor.id]);
    assert.strictEqual(dbRow.rows.length, 1);
    assert.strictEqual(dbRow.rows[0].created_by, testRecruiter.id);
  });

  await asyncTest("Duplicate vendor name for same user is rejected with 409 Conflict", async () => {
    try {
      await vendorService.createVendor(testRecruiter.id, {
        name: vendorPayload.name,
        vendorType: "DIRECT_CLIENT",
      });
      assert.fail("Should have thrown duplicate vendor error");
    } catch (err) {
      assert.strictEqual(err.statusCode, 409);
      assert.ok(err.message.includes("already exists"));
    }
  });

  await asyncTest("Invalid vendor_type is rejected with 400 Bad Request", async () => {
    try {
      await vendorService.createVendor(testRecruiter.id, {
        name: `Invalid Type Vendor ${Date.now()}`,
        vendorType: "INVALID_VENDOR_TYPE",
      });
      assert.fail("Should have thrown invalid vendor type error");
    } catch (err) {
      assert.strictEqual(err.statusCode, 400);
      assert.ok(err.message.includes("Invalid vendor_type"));
    }
  });

  console.log(`\n4. Negative Tests & Security Verification`);

  await asyncTest("Non-existent/unauthenticated user ID cannot create vendor (returns 401)", async () => {
    try {
      await vendorService.createVendor("00000000-0000-0000-0000-888888888888", {
        name: `Hacker Vendor ${Date.now()}`,
      });
      assert.fail("Should have rejected non-existent user");
    } catch (err) {
      assert.strictEqual(err.statusCode, 401);
      assert.ok(err.message.includes("Authenticated user not found"));
    }
  });

  console.log(`\n5. Vendor Lifecycle & Listing`);

  await asyncTest("listVendors returns created vendor for authenticated user", async () => {
    const list = await vendorService.listVendors(testRecruiter.id, {});
    assert.ok(list.length >= 1);
    const found = list.find((v) => v.id === createdVendorId);
    assert.ok(found, "Created vendor must be present in recruiter vendor list");
  });

  await asyncTest("approveVendor transitions status from PENDING to ACTIVE", async () => {
    const approved = await vendorService.approveVendor(createdVendorId, testRecruiter.id);
    assert.strictEqual(approved.status, "ACTIVE");
  });

  await asyncTest("deactivateVendor transitions status from ACTIVE to INACTIVE", async () => {
    const deactivated = await vendorService.deactivateVendor(createdVendorId, testRecruiter.id);
    assert.strictEqual(deactivated.status, "INACTIVE");
  });

  await asyncTest("reactivateVendor transitions status from INACTIVE to ACTIVE", async () => {
    const reactivated = await vendorService.reactivateVendor(createdVendorId, testRecruiter.id);
    assert.strictEqual(reactivated.status, "ACTIVE");
  });

  console.log(`\n====================================================`);
  console.log(`Total Tests Run: ${passedCount + failedCount}`);
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`====================================================\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runVendorTests()
  .then(() => pool.end())
  .catch((err) => {
    console.error("Test runner crashed:", err);
    process.exit(1);
  });
