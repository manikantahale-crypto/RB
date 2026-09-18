/**
 * JSearch (Web Search) REST API Client Service for ASTRA Job Boards.
 *
 * Requirements:
 * - API Endpoint: https://jsearch.p.rapidapi.com/search
 * - Authentication:
 *     X-RapidAPI-Key: process.env.JSEARCH_API_KEY
 *     X-RapidAPI-Host: process.env.JSEARCH_API_HOST (default: jsearch.p.rapidapi.com)
 * - Source / Publisher Preservation:
 *     Underlying publisher from job.job_publisher (Dice, LinkedIn, Indeed, etc.) is preserved
 *     as the job's source attribution.
 * - Original Job URL:
 *     Prioritizes job.job_apply_link or apply_options over Google Jobs search links.
 * - Deduplication ID:
 *     job.job_id formatted with publisher prefix -> messageId "jsearch:<publisher>:<job_id>"
 */

/**
 * Safely cleans HTML tags and entities from raw text.
 *
 * @param {string} html
 * @returns {string}
 */
function cleanHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Known publisher display name overrides.
 */
const KNOWN_PUBLISHERS = {
  "dice": "Dice",
  "linkedin": "LinkedIn",
  "indeed": "Indeed",
  "ziprecruiter": "ZipRecruiter",
  "glassdoor": "Glassdoor",
  "upwork": "Upwork",
  "monster": "Monster",
  "careerbuilder": "CareerBuilder",
  "simplyhired": "SimplyHired",
  "usajobs": "USAJOBS",
  "talent": "Talent.com",
  "workday": "Workday",
  "greenhouse": "Greenhouse",
  "lever": "Lever",
  "smartrecruiters": "SmartRecruiters",
  "snagajob": "Snagajob",
  "techcareers": "TechCareers"
};

/**
 * Cleanly normalizes publisher string (e.g. "DICE.COM" -> "Dice", "LINKEDIN" -> "LinkedIn").
 *
 * @param {string|null|undefined} raw
 * @returns {string}
 */
function normalizePublisher(raw) {
  if (!raw || typeof raw !== "string") return "Web Search";
  let cleaned = raw.trim();
  if (!cleaned) return "Web Search";

  // Strip trailing domain extensions (.com, .org, .net, .io, .co, .us, .app)
  cleaned = cleaned.replace(/\.(com|org|net|io|co|gov|us|app|info)$/i, "").trim();

  const key = cleaned.toLowerCase();
  if (KNOWN_PUBLISHERS[key]) {
    return KNOWN_PUBLISHERS[key];
  }

  // Convert to Title Case for arbitrary/unknown publishers
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Formats salary numbers into a clean string (e.g. "$120,000 - $150,000 Per Year").
 *
 * @param {number|null} min
 * @param {number|null} max
 * @param {string|null} currency
 * @param {string|null} period
 * @returns {string}
 */
function formatSalary(min, max, currency = "USD", period = "YEAR") {
  if (!min && !max) return "";
  const symbol = currency === "USD" || !currency ? "$" : `${currency} `;
  const pStr = period ? ` Per ${period.toLowerCase()}` : "";

  const minStr = min ? `${symbol}${Number(min).toLocaleString("en-US")}` : "";
  const maxStr = max ? `${symbol}${Number(max).toLocaleString("en-US")}` : "";

  if (minStr && maxStr && minStr !== maxStr) {
    return `${minStr} - ${maxStr}${pStr}`;
  } else if (minStr) {
    return `${minStr}${pStr}`;
  } else if (maxStr) {
    return `${maxStr}${pStr}`;
  }
  return "";
}

/**
 * Maps JSearch employment type string to canonical employment type.
 *
 * @param {string|null} empType
 * @returns {string}
 */
function determineEmploymentType(empType) {
  if (!empType || typeof empType !== "string") return "Full-Time";
  const t = empType.toUpperCase();
  if (t === "CONTRACTOR" || t === "CONTRACT") return "Contract";
  if (t === "PARTTIME" || t === "PART_TIME" || t === "PART-TIME") return "Part-Time";
  if (t === "INTERN" || t === "INTERNSHIP") return "Internship";
  if (t === "FULLTIME" || t === "FULL_TIME" || t === "FULL-TIME") return "Full-Time";
  return "Full-Time";
}

/**
 * Determines work mode from remote indicator and location.
 *
 * @param {boolean|null} isRemote
 * @param {string} location
 * @returns {string}
 */
function determineWorkMode(isRemote, location = "") {
  if (isRemote === true || location.toLowerCase().includes("remote")) {
    return "Remote";
  }
  return "Hybrid";
}

/**
 * Selects the highest priority original job listing URL.
 * Priority: 1. job_apply_link -> 2. apply_options[0].apply_link -> 3. job_google_link.
 *
 * @param {Object} job
 * @returns {string}
 */
function selectTargetUrl(job) {
  if (job.job_apply_link && typeof job.job_apply_link === "string" && job.job_apply_link.trim()) {
    return job.job_apply_link.trim();
  }
  if (Array.isArray(job.apply_options) && job.apply_options.length > 0) {
    const firstOption = job.apply_options[0];
    if (firstOption?.apply_link && typeof firstOption.apply_link === "string" && firstOption.apply_link.trim()) {
      return firstOption.apply_link.trim();
    }
  }
  if (job.job_google_link && typeof job.job_google_link === "string" && job.job_google_link.trim()) {
    return job.job_google_link.trim();
  }
  return "";
}

/**
 * Constructs JSearch query string from keyword and optional location.
 *
 * @param {string} keyword
 * @param {string} location
 * @returns {string}
 */
function buildSearchQuery(keyword, location) {
  const kw = (keyword || "Developer").trim();
  const loc = (location || "").trim();
  if (loc) {
    return `${kw} in ${loc}`;
  }
  return `${kw} in USA`;
}

/**
 * Fetches job requirements from JSearch API via RapidAPI.
 *
 * @param {string} keyword Search keyword/role
 * @param {string} location Geographic location (e.g. "Dallas, TX")
 * @param {Object} [options] Optional search parameters
 * @returns {Promise<Array<Object>>} Standardized intermediate job requirement list
 */
async function fetchJSearchJobs(keyword, location, options = {}) {
  const apiKey = process.env.JSEARCH_API_KEY;
  if (!apiKey) {
    throw new Error("Web Search (JSearch) is not configured. Missing JSEARCH_API_KEY in environment.");
  }

  const apiHost = process.env.JSEARCH_API_HOST || "jsearch.p.rapidapi.com";
  const baseUrl = (process.env.JSEARCH_BASE_URL || "https://jsearch.p.rapidapi.com").replace(/\/+$/, "");

  const query = buildSearchQuery(keyword, location);

  const url = new URL(`${baseUrl}/search-v2`);
  url.searchParams.set("query", query);
  url.searchParams.set("page", String(options.page || 1));
  url.searchParams.set("num_pages", "1");
  url.searchParams.set("country", "us");
  url.searchParams.set("date_posted", options.datePosted || "all");

  const headers = {
    "X-RapidAPI-Key": apiKey,
    "X-RapidAPI-Host": apiHost,
    "Accept": "application/json"
  };

  let response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15000)
    });
  } catch (netErr) {
    throw new Error(`Web Search (JSearch) network error: ${netErr.message}`);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new Error(`JSearch authentication failed (${response.status}). Check JSEARCH_API_KEY.`);
    }
    if (response.status === 429) {
      throw new Error("JSearch monthly quota or rate limit reached. Please try again later.");
    }
    throw new Error(`JSearch API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
  }

  const data = await response.json();
  const rawJobs = Array.isArray(data?.data) ? data.data : (data?.data?.jobs || []);

  if (!Array.isArray(rawJobs) || rawJobs.length === 0) {
    return [];
  }

  return rawJobs.map((job) => {
    const publisher = normalizePublisher(job.job_publisher);
    const targetUrl = selectTargetUrl(job);
    const cleanDesc = cleanHtml(job.job_description || "");

    const locationParts = [job.job_city, job.job_state, job.job_country].filter(Boolean);
    const locationStr = locationParts.length > 0 ? locationParts.join(", ") : (location || "USA");

    const effectiveDesc = cleanDesc || (job.job_title
      ? `Position: ${job.job_title}. Company: ${job.employer_name || "Unknown Company"}. Location: ${locationStr}. Source: ${publisher}. Please refer to the source URL for full description: ${targetUrl || "N/A"}`
      : "");

    const skills = Array.isArray(job.job_required_skills) ? job.job_required_skills : [];
    const salary = formatSalary(job.job_min_salary, job.job_max_salary, job.job_salary_currency, job.job_salary_period);
    const employmentType = determineEmploymentType(job.job_employment_type);
    const workMode = determineWorkMode(job.job_is_remote, locationStr);

    let experience = "";
    if (job.job_required_experience?.required_experience_in_months) {
      const years = Math.round(job.job_required_experience.required_experience_in_months / 12);
      experience = `${years > 0 ? years : 1}+ Years`;
    }

    const postedAt = job.job_posted_at_datetime_utc
      ? new Date(job.job_posted_at_datetime_utc)
      : (job.job_posted_at_timestamp ? new Date(job.job_posted_at_timestamp * 1000) : new Date());

    return {
      source: publisher,
      sourceId: String(job.job_id || ""),
      sourceUrl: targetUrl,
      title: job.job_title || "Job Requirement",
      company: job.employer_name || "Unknown Company",
      description: effectiveDesc,
      location: locationStr,
      skills: skills,
      salary: salary,
      experience: experience,
      employmentType: employmentType,
      workMode: workMode,
      postedAt: postedAt
    };
  });
}

module.exports = { fetchJSearchJobs, normalizePublisher };
