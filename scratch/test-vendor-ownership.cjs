const jwt = require("jsonwebtoken");
const env = require("../node-api/src/config/env");

async function testVendorOwnership() {
  try {
    console.log("=== TESTING VENDOR USER OWNERSHIP AND ZERO-ORG ACCESS ===");

    const zeroOrgUserId = "66666666-6666-6666-6666-666666666666"; // Zero-org user
    const tokenZero = jwt.sign({ userId: zeroOrgUserId, email: "zeroorg@test.com" }, env.AUTH_JWT_SECRET || env.JWT_SECRET);

    const userBId = "5baf647a-f1ad-4895-a281-cb26ef12e005"; // User B
    const tokenB = jwt.sign({ userId: userBId, email: "userB@test.com" }, env.AUTH_JWT_SECRET || env.JWT_SECRET);

    // 1. Create Vendor with Zero-Org User
    const vendorName = `Test Vendor Zero ${Date.now()}`;
    const createRes = await fetch("http://localhost:4000/vendors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tokenZero}`
      },
      body: JSON.stringify({
        name: vendorName,
        vendorType: "PRIME_VENDOR",
        email: "vendorzero@test.com"
      })
    });

    const createStatus = createRes.status;
    const createBody = await createRes.json();
    console.log(`Create Vendor Status: ${createStatus}`, createBody);

    if (createStatus !== 201 || !createBody.data?.id) {
      throw new Error("Zero-org vendor creation failed!");
    }
    const vendorId = createBody.data.id;
    console.log("PASS: Zero-org vendor creation succeeded!");

    // 2. List Vendors for Zero-Org User
    const listRes = await fetch("http://localhost:4000/vendors", {
      headers: { "Authorization": `Bearer ${tokenZero}` }
    });
    const listBody = await listRes.json();
    console.log(`List Vendors Status: ${listRes.status}, Count: ${listBody.data?.length}`);
    if (listRes.status === 200 && listBody.data?.some(v => v.id === vendorId)) {
      console.log("PASS: Zero-org vendor listing succeeded!");
    } else {
      throw new Error("Vendor listing failed!");
    }

    // 3. Cross-User Security Check: User B attempts to access Zero-Org User's vendor
    const crossRes = await fetch(`http://localhost:4000/vendors/${vendorId}`, {
      headers: { "Authorization": `Bearer ${tokenB}` }
    });
    console.log(`Cross-user GET Vendor Status: ${crossRes.status}`);
    if (crossRes.status === 404) {
      console.log("PASS: Cross-user access to vendor strictly denied (404 Not Found)!");
    } else {
      throw new Error("Cross-user security failed!");
    }

    console.log("\n=== ALL VENDOR OWNERSHIP TESTS PASSED ===");
    process.exit(0);
  } catch (err) {
    console.error("Vendor ownership test failed:", err);
    process.exit(1);
  }
}

testVendorOwnership();
