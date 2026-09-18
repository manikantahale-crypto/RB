/**
 * USAJOBS REST API Client Service for ASTRA Job Boards.
 *
 * Requirements:
 * - Search API: https://data.usajobs.gov/api/search
 * - Announcement Text API: https://data.usajobs.gov/api/historicjoa/announcementtext
 * - Authentication:
 *     Authorization-Key: process.env.USAJOBS_API_KEY
 *     User-Agent: process.env.USAJOBS_USER_AGENT (email address)
 *     Host: data.usajobs.gov
 * - Deduplication ID: MatchedObjectId (e.g. 759326100) -> messageId "usajobs:759326100"
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
 * Formats remuneration range into a human-readable salary string.
 *
 * @param {Array<Object>} remunerations
 * @returns {string}
 */
function formatSalary(remunerations) {
  if (!Array.isArray(remunerations) || remunerations.length === 0) return "";
  const rem = remunerations[0];
  if (!rem) return "";
  const min = rem.MinimumRange ? `$${Number(rem.MinimumRange).toLocaleString("en-US")}` : "";
  const max = rem.MaximumRange ? `$${Number(rem.MaximumRange).toLocaleString("en-US")}` : "";
  const interval = rem.RateIntervalCode ? ` ${rem.RateIntervalCode}` : "";

  if (min && max && min !== max) {
    return `${min} - ${max}${interval}`;
  } else if (min) {
    return `${min}${interval}`;
  }
  return "";
}

/**
 * Determines work mode (Remote / Hybrid / Onsite).
 *
 * @param {Object} descriptor
 * @returns {string}
 */
function determineWorkMode(descriptor) {
  const locDisplay = (descriptor.PositionLocationDisplay || "").toLowerCase();
  const telework = descriptor.UserArea?.Details?.TeleworkEligible;
  if (locDisplay.includes("remote") || telework === true || telework === "true") {
    return "Remote";
  }
  return "Hybrid";
}

/**
 * Determines standard employment type.
 *
 * @param {Object} descriptor
 * @returns {string}
 */
function determineEmploymentType(descriptor) {
  const schedule = descriptor.PositionSchedule?.[0]?.Name || "";
  const offering = descriptor.PositionOfferingType?.[0]?.Name || "";
  if (/full[- ]?time/i.test(schedule) || /full[- ]?time/i.test(offering)) {
    return "Full-Time";
  }
  if (/part[- ]?time/i.test(schedule) || /part[- ]?time/i.test(offering)) {
    return "Part-Time";
  }
  if (/contract/i.test(schedule) || /contract/i.test(offering) || /temporary/i.test(offering)) {
    return "Contract";
  }
  return "Full-Time";
}

/**
 * Extracts skills from job category metadata.
 *
 * @param {Object} descriptor
 * @returns {string[]}
 */
function extractSkills(descriptor) {
  const categories = descriptor.JobCategory || [];
  return categories.map((c) => c.Name).filter(Boolean);
}

/**
 * Assembles full structured description from Announcement Text response or falls back to Search metadata.
 *
 * @param {Object|null} announcement Announcement Text API object
 * @param {Object} descriptor Search API MatchedObjectDescriptor
 * @param {string} fallbackLoc Fallback location string
 * @returns {string}
 */
function buildFullDescription(announcement, descriptor, fallbackLoc) {
  const sections = [];

  if (announcement) {
    const summary = cleanHtml(announcement.summary);
    if (summary) sections.push(`SUMMARY:\n${summary}`);

    const duties = cleanHtml(announcement.duties);
    if (duties) sections.push(`DUTIES & RESPONSIBILITIES:\n${duties}`);

    const qualifications = cleanHtml(announcement.requirementsQualifications);
    if (qualifications) sections.push(`QUALIFICATIONS & REQUIREMENTS:\n${qualifications}`);

    const education = cleanHtml(announcement.requirementsEducation);
    if (education) sections.push(`EDUCATION REQUIREMENTS:\n${education}`);

    const conditions = cleanHtml(announcement.requirementsConditionsOfEmployment);
    if (conditions) sections.push(`CONDITIONS OF EMPLOYMENT:\n${conditions}`);

    const evaluations = cleanHtml(announcement.evaluations);
    if (evaluations) sections.push(`EVALUATIONS & ASSESSMENT:\n${evaluations}`);

    const howToApply = cleanHtml(announcement.howToApply);
    const nextSteps = cleanHtml(announcement.howToApplyNextSteps);
    const requiredDocs = cleanHtml(announcement.requiredDocuments);
    const applyParts = [howToApply, nextSteps, requiredDocs ? `Required Documents:\n${requiredDocs}` : ""].filter(Boolean);
    if (applyParts.length > 0) {
      sections.push(`HOW TO APPLY:\n${applyParts.join("\n\n")}`);
    }
  }

  // Graceful fallback to search descriptor if Announcement Text was empty or missing
  if (sections.length === 0) {
    const qualSummary = cleanHtml(descriptor?.QualificationSummary || "");
    const title = descriptor?.PositionTitle || "Job Requirement";
    const org = descriptor?.OrganizationName || descriptor?.DepartmentName || "US Federal Government";
    const loc = descriptor?.PositionLocationDisplay || fallbackLoc || "USA";
    const url = descriptor?.PositionURI || "N/A";

    if (qualSummary) {
      sections.push(`Position: ${title}\nAgency: ${org}\nLocation: ${loc}\n\nSummary:\n${qualSummary}\n\nAnnouncement URL: ${url}`);
    } else {
      sections.push(`Position: ${title}. Agency: ${org}. Location: ${loc}. Please refer to the official announcement URL for full details: ${url}`);
    }
  }

  return sections.join("\n\n");
}

/**
 * Executes an async mapping function over an array with controlled concurrency.
 *
 * @param {Array<T>} items
 * @param {number} limit Maximum concurrent executions
 * @param {function(T): Promise<R>} fn Async worker function
 * @returns {Promise<Array<R>>}
 * @template T, R
 */
async function mapConcurrent(items, limit, fn) {
  const results = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    if (limit <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

/**
 * Fetches job requirements from official USAJOBS Search & Announcement Text APIs.
 *
 * @param {string} keyword Search keyword/role
 * @param {string} location Geographic location (e.g., "Dallas, TX", "Washington, DC")
 * @param {Object} [options] Optional pagination parameters
 * @returns {Promise<Array<Object>>} Standardized intermediate job requirement list
 */
async function fetchUsajobsJobs(keyword, location, options = {}) {
  const apiKey = process.env.USAJOBS_API_KEY;
  const userAgent = process.env.USAJOBS_USER_AGENT;

  if (!apiKey || !userAgent) {
    throw new Error("USAJOBS is not configured. Missing USAJOBS_API_KEY or USAJOBS_USER_AGENT in environment.");
  }

  const baseUrl = (process.env.USAJOBS_BASE_URL || "https://data.usajobs.gov/api").replace(/\/+$/, "");
  const resultsPerPage = options.resultsPerPage || process.env.USAJOBS_RESULTS_PER_PAGE || 20;
  const page = options.page || 1;

  const searchUrl = new URL(`${baseUrl}/search`);
  searchUrl.searchParams.set("Keyword", keyword || "Developer");
  if (location && location.trim()) {
    searchUrl.searchParams.set("LocationName", location.trim());
  }
  searchUrl.searchParams.set("ResultsPerPage", String(resultsPerPage));
  searchUrl.searchParams.set("Page", String(page));

  const headers = {
    "Host": "data.usajobs.gov",
    "User-Agent": userAgent,
    "Authorization-Key": apiKey,
    "Accept": "application/json"
  };

  // 1. Fetch Search API results
  let searchRes;
  try {
    searchRes = await fetch(searchUrl.toString(), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15000)
    });
  } catch (netErr) {
    throw new Error(`USAJOBS network error: ${netErr.message}`);
  }

  if (!searchRes.ok) {
    const errorText = await searchRes.text().catch(() => "");
    if (searchRes.status === 401 || searchRes.status === 403) {
      throw new Error(`USAJOBS authentication failed (${searchRes.status}). Check USAJOBS_API_KEY and USAJOBS_USER_AGENT.`);
    }
    if (searchRes.status === 429) {
      throw new Error("USAJOBS rate limit reached. Please try again later.");
    }
    throw new Error(`USAJOBS Search API error: ${searchRes.status} ${searchRes.statusText}${errorText ? ` - ${errorText}` : ""}`);
  }

  const searchData = await searchRes.json();
  const searchItems = searchData?.SearchResult?.SearchResultItems || [];

  if (!Array.isArray(searchItems) || searchItems.length === 0) {
    return [];
  }

  // 2. Extract control numbers and fetch Announcement Text individually with controlled concurrency (max 4)
  const rawControlNumbers = searchItems
    .map((item) => item.MatchedObjectId || item.MatchedObjectDescriptor?.MatchedObjectId)
    .filter(Boolean);
  const controlNumbers = Array.from(new Set(rawControlNumbers));

  const announcementMap = new Map();

  if (controlNumbers.length > 0) {
    const concurrencyLimit = 4;
    await mapConcurrent(controlNumbers, concurrencyLimit, async (controlNumber) => {
      try {
        const announcementUrl = `${baseUrl}/historicjoa/announcementtext?USAJOBSControlNumbers=${encodeURIComponent(controlNumber)}`;
        const announcementRes = await fetch(announcementUrl, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(15000)
        });

const log = require("../../../../../utils/logger");

        if (announcementRes.ok) {
          const announcementData = await announcementRes.json();
          const item = announcementData?.data?.[0];
          if (item && item.usajobsControlNumber) {
            announcementMap.set(String(item.usajobsControlNumber), item);
          }
        } else {
          log.warn(`[ASTRA] USAJOBS Announcement Text for ${controlNumber} returned status ${announcementRes.status}, using metadata fallback`);
        }
      } catch (annErr) {
        log.warn(`[ASTRA] USAJOBS Failed to fetch Announcement Text for ${controlNumber}: ${annErr.message}, using metadata fallback`);
      }
    });
  }

  // 3. Map to canonical intermediate job objects
  return searchItems.map((item) => {
    const descriptor = item.MatchedObjectDescriptor || {};
    const controlNumber = item.MatchedObjectId || descriptor.MatchedObjectId || "";
    const ann = announcementMap.get(String(controlNumber)) || null;

    const title = descriptor.PositionTitle || "Job Requirement";
    const company = descriptor.OrganizationName || descriptor.DepartmentName || "US Federal Government";
    const loc = descriptor.PositionLocationDisplay || descriptor.PositionLocation?.[0]?.LocationName || location || "USA";
    const url = descriptor.PositionURI || (Array.isArray(descriptor.ApplyURI) ? descriptor.ApplyURI[0] : descriptor.ApplyURI) || "";

    const description = buildFullDescription(ann, descriptor, loc);
    const salary = formatSalary(descriptor.PositionRemuneration);
    const employmentType = determineEmploymentType(descriptor);
    const workMode = determineWorkMode(descriptor);
    const skills = extractSkills(descriptor);
    const postedAt = descriptor.PublicationStartDate || descriptor.PositionStartDate
      ? new Date(descriptor.PublicationStartDate || descriptor.PositionStartDate)
      : new Date();

    return {
      source: "USAJOBS",
      sourceId: String(controlNumber),
      sourceUrl: url,
      title: title,
      company: company,
      description: description,
      location: loc,
      skills: skills,
      salary: salary,
      experience: "",
      employmentType: employmentType,
      workMode: workMode,
      postedAt: postedAt
    };
  });
}

module.exports = { fetchUsajobsJobs };
