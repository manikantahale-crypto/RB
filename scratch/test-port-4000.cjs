const jwt = require("jsonwebtoken");
const env = require("../node-api/src/config/env");

async function checkPort4000() {
  try {
    console.log("=== CHECKING PORT 4000 ENDPOINTS ===");

    const token = jwt.sign({ userId: "5baf647a-f1ad-4895-a281-cb26ef12e005", email: "sarah.chen@tekisho.com" }, env.AUTH_JWT_SECRET || env.JWT_SECRET);

    const health = await fetch("http://localhost:4000/health");
    console.log("GET /health Status:", health.status, await health.json());

    const pending = await fetch("http://localhost:4000/recruiter/reviews/pending", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    console.log("GET /recruiter/reviews/pending Status:", pending.status, await pending.json());

    process.exit(0);
  } catch (err) {
    console.error("Error checking port 4000:", err.message);
    process.exit(1);
  }
}

checkPort4000();
