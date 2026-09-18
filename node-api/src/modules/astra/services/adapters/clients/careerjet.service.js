const crypto = require("crypto");

/**
 * Fetches job requirements from Careerjet REST API v4.
 *
 * Requirements:
 * - API Endpoint: https://search.api.careerjet.net/v4/query
 * - Authentication: Basic Auth (API Key as username, empty password)
 * - Required query parameters: locale_code, keywords, location, user_ip, user_agent
 * - Required header: Referer
 * - Deterministic ID: SHA-256 hash of (title + company + location + canonicalUrl)
 *
 * @param {string} keyword Search keyword/role
 * @param {string} location Geographic location
 * @returns {Promise<Array<Object>>} Standardized intermediate job requirement list
 */
async function fetchCareerjetJobs(keyword, location, options = {}) {
  const apiKey = process.env.CAREERJET_API_KEY;
  if (!apiKey) {
    throw new Error("Careerjet is not configured");
  }

  const baseUrl = process.env.CAREERJET_BASE_URL || "https://search.api.careerjet.net/v4/query";
  const localeCode = process.env.CAREERJET_LOCALE_CODE || "en_US";

  // Validate whether an IP is a local/private address
  const isPrivateOrLoopback = (ip) => {
    if (!ip || typeof ip !== "string") return true;
    const clean = ip.replace(/^::ffff:/, "").trim().toLowerCase();
    if (clean === "127.0.0.1" || clean === "::1" || clean === "localhost" || clean === "0.0.0.0") return true;
    if (clean.startsWith("10.") || clean.startsWith("192.168.")) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(clean)) return true;
    return false;
  };

  // Determine user_ip: prioritize dynamic public IP, fallback to .env for local/test execution
  let userIp = options.userIp;
  if (!userIp || isPrivateOrLoopback(userIp)) {
    userIp = process.env.CAREERJET_USER_IP || "127.0.0.1";
  }

  // Determine user_agent: prioritize dynamic browser User-Agent, fallback to .env / default
  const userAgent = options.userAgent || process.env.CAREERJET_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const referer = process.env.CAREERJET_REFERER || "http://localhost:4000";

  const url = new URL(baseUrl);
  url.searchParams.set("locale_code", localeCode);
  url.searchParams.set("keywords", keyword || "React Developer");
  if (location) {
    url.searchParams.set("location", location);
  }
  url.searchParams.set("user_ip", userIp);
  url.searchParams.set("user_agent", userAgent);

  const authHeader = "Basic " + Buffer.from(`${apiKey}:`).toString("base64");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Authorization": authHeader,
      "Referer": referer,
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Careerjet API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
  }

  const data = await response.json();

  if (data.type === "ERROR" || data.error) {
    throw new Error(`Careerjet API error: ${data.error || data.message || "Unknown error"}`);
  }

  const rawJobs = data.jobs || data.results || [];

  return rawJobs.map((job) => {
    // Strip HTML formatting from descriptions (e.g. <b>Java</b> -> Java)
    const cleanDesc = (job.description || "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();

    // Generate deterministic sourceId from title + company + location + canonical URL
    const cleanTitle = (job.title || "").toLowerCase().trim();
    const cleanCompany = (job.company || "").toLowerCase().trim();
    const cleanLocation = (job.locations || job.location || "").toLowerCase().trim();
    const cleanUrl = (job.url || "").split("?")[0].toLowerCase().trim();

    const rawIdString = `${cleanTitle}|${cleanCompany}|${cleanLocation}|${cleanUrl}`;
    const sourceId = crypto
      .createHash("sha256")
      .update(rawIdString, "utf8")
      .digest("hex")
      .slice(0, 24);

    const effectiveDesc = cleanDesc || (job.title
      ? `Position: ${job.title}. Location: ${job.locations || job.location || location || "USA"}. Please refer to the source URL for full description: ${job.url || "N/A"}`
      : "");

    return {
      source: "Careerjet",
      sourceId: sourceId,
      sourceUrl: job.url || "",
      title: job.title || "Job Requirement",
      company: job.company || "Unknown Company",
      description: effectiveDesc,
      location: job.locations || job.location || location || "USA",
      skills: [],
      salary: job.salary || "",
      experience: "",
      employmentType: "Full-Time",
      workMode: "Hybrid",
      postedAt: job.date ? new Date(job.date) : new Date()
    };
  });
}

module.exports = { fetchCareerjetJobs };
