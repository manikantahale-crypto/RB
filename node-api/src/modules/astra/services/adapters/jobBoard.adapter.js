const { fetchJoobleJobs } = require("./clients/jooble.service");
const { fetchAdzunaJobs } = require("./clients/adzuna.service");
const { fetchJobpipeJobs } = require("./clients/jobpipe.service");
const { fetchIndeedJobs } = require("./clients/indeed.service");
const { fetchMonsterJobs } = require("./clients/monster.service");
const { fetchCareerjetJobs } = require("./clients/careerjet.service");
const { fetchUsajobsJobs } = require("./clients/usajobs.service");
const { fetchJSearchJobs } = require("./clients/jsearch.service");
const astraService = require("../astra.service");

async function fetchAndIngest(source, keyword, location, userId = null, context = {}) {
  const src = (source || "all").trim().toLowerCase();

  const stats = {
    jooble: { fetched: 0, created: 0, duplicates: 0, failed: 0 },
    adzuna: { fetched: 0, created: 0, duplicates: 0, failed: 0 },
    jobpipe: { fetched: 0, created: 0, duplicates: 0, failed: 0 },
    indeed: { fetched: 0, created: 0, duplicates: 0, failed: 0 },
    monster: { fetched: 0, created: 0, duplicates: 0, failed: 0 },
    careerjet: { fetched: 0, created: 0, duplicates: 0, failed: 0 },
    usajobs: { fetched: 0, created: 0, duplicates: 0, failed: 0 },
    web_search: { fetched: 0, created: 0, duplicates: 0, failed: 0 }
  };

const log = require("../../../../utils/logger");

  const safeFetch = async (fn, name, key, extraArgs = []) => {
    try {
      const results = await fn(keyword, location, ...extraArgs);
      log.info(`fetched ${results.length} jobs from ${name}`);
      stats[key].fetched = results.length;
      return results;
    } catch (err) {
      log.error(`[ASTRA] Failed to fetch from ${name}: ${err.message}`);
      stats[key].failed = 1;
      throw err;
    }
  };

  let jobs = [];
  const errors = [];

  if (src === "linkedin") {
    throw new Error("LinkedIn is not configured");
  } else if (src === "jooble") {
    try {
      const r = await safeFetch(fetchJoobleJobs, "Jooble", "jooble");
      jobs = jobs.concat(r);
    } catch (e) {
      errors.push("Jooble: " + e.message);
    }
  } else if (src === "adzuna") {
    try {
      const r = await safeFetch(fetchAdzunaJobs, "Adzuna", "adzuna");
      jobs = jobs.concat(r);
    } catch (e) {
      errors.push("Adzuna: " + e.message);
    }
  } else if (src === "jobpipe") {
    try {
      const r = await safeFetch(fetchJobpipeJobs, "JobPipe", "jobpipe");
      jobs = jobs.concat(r);
    } catch (e) {
      errors.push("JobPipe: " + e.message);
    }
  } else if (src === "indeed") {
    try {
      const r = await safeFetch(fetchIndeedJobs, "Indeed", "indeed");
      jobs = jobs.concat(r);
    } catch (e) {
      errors.push("Indeed: " + e.message);
    }
  } else if (src === "monster") {
    try {
      const r = await safeFetch(fetchMonsterJobs, "Monster", "monster");
      jobs = jobs.concat(r);
    } catch (e) {
      errors.push("Monster: " + e.message);
    }
  } else if (src === "careerjet") {
    try {
      const r = await safeFetch(fetchCareerjetJobs, "Careerjet", "careerjet", [context]);
      jobs = jobs.concat(r);
    } catch (e) {
      errors.push("Careerjet: " + e.message);
    }
  } else if (src === "usajobs") {
    try {
      const r = await safeFetch(fetchUsajobsJobs, "USAJOBS", "usajobs");
      jobs = jobs.concat(r);
    } catch (e) {
      errors.push("USAJOBS: " + e.message);
    }
  } else if (src === "web_search" || src === "jsearch") {
    try {
      const r = await safeFetch(fetchJSearchJobs, "Web Search", "web_search");
      jobs = jobs.concat(r);
    } catch (e) {
      errors.push("Web Search: " + e.message);
    }
  } else {
    // "all"
    const promises = [
      safeFetch(fetchJoobleJobs, "Jooble", "jooble").catch(e => { errors.push("Jooble: " + e.message); return []; }),
      safeFetch(fetchAdzunaJobs, "Adzuna", "adzuna").catch(e => { errors.push("Adzuna: " + e.message); return []; }),
      safeFetch(fetchJobpipeJobs, "JobPipe", "jobpipe").catch(e => { errors.push("JobPipe: " + e.message); return []; }),
      safeFetch(fetchIndeedJobs, "Indeed", "indeed").catch(e => { errors.push("Indeed: " + e.message); return []; }),
      safeFetch(fetchMonsterJobs, "Monster", "monster").catch(e => { errors.push("Monster: " + e.message); return []; }),
      safeFetch(fetchCareerjetJobs, "Careerjet", "careerjet", [context]).catch(e => { errors.push("Careerjet: " + e.message); return []; }),
      safeFetch(fetchUsajobsJobs, "USAJOBS", "usajobs").catch(e => { errors.push("USAJOBS: " + e.message); return []; }),
      safeFetch(fetchJSearchJobs, "Web Search", "web_search").catch(e => { errors.push("Web Search: " + e.message); return []; })
    ];
    const resultsArray = await Promise.all(promises);
    jobs = resultsArray.flat();
  }

  if (jobs.length === 0 && errors.length > 0) {
    throw new Error(errors[0]);
  }

  let totalCreated = 0;
  let totalDuplicates = 0;
  const fetchedItems = [];

  for (const job of jobs) {
    const jobKey = job.source ? job.source.toLowerCase().replace(/[^a-z0-9_]/g, "_") : "job_board";
    let itemStatus = "Failed";
    let jobId = null;
    try {
      const isJSearch = (src === "web_search" || src === "jsearch" || (job.sourceId && String(job.sourceId).length > 20));
      const stableMessageId = job.sourceId
        ? (isJSearch ? `jsearch:${jobKey}:${job.sourceId}` : `${jobKey}:${job.sourceId}`)
        : null;

      const canonicalPayload = {
        // The flow's id, when a workflow asked; every listing's announcement joins it.
        ...(context.correlationId ? { correlation_id: context.correlationId } : {}),
        ...(context.organizationId ? { organization_id: context.organizationId } : {}),
        title: job.title || "Job Requirement",
        companyName: job.company || "Unknown Company",
        location: job.location || "USA",
        skills: job.skills || [],
        rawText: job.description || "",
        sourceEmail: null,
        sourceUrl: job.sourceUrl || null,
        sourceSubject: `Fetched from ${job.source}`,
        messageId: stableMessageId,
        employmentType: job.employmentType || null,
        remotePolicy: job.workMode || null,
        createdBy: userId,
        sourceType: "job_board",
        sourceName: jobKey,
        status: "Active"
      };

      const res = await astraService.ingestRequirement(canonicalPayload);

      if (res.duplicate) {
        totalDuplicates++;
        if (stats[jobKey]) stats[jobKey].duplicates++;
        else if (stats[src]) stats[src].duplicates++;
        itemStatus = "Duplicate";
        jobId = res.job?.id || null;
      } else {
        totalCreated++;
        if (stats[jobKey]) stats[jobKey].created++;
        else if (stats[src]) stats[src].created++;
        itemStatus = "New";
        jobId = res.jobId || res.job?.id || null;
      }
    } catch (ingestErr) {
      log.error(`[ASTRA] Ingestion failed for job "${job.title}": ${ingestErr.message}`);
      if (stats[jobKey]) stats[jobKey].failed++;
      else if (stats[src]) stats[src].failed++;
      itemStatus = "Failed";
    }

    fetchedItems.push({
      id: jobId,
      title: job.title || "Job Requirement",
      company: job.company || "Unknown Company",
      location: job.location || "USA",
      source: job.source,
      sourceUrl: job.sourceUrl || null,
      postedAt: job.postedAt ? new Date(job.postedAt).toISOString() : new Date().toISOString(),
      status: itemStatus,
      skills: job.skills || [],
      description: job.description || "",
      employmentType: job.employmentType || null,
      workMode: job.workMode || null,
      visa: job.visa || "Any",
      experience: job.experience || "3+ Years"
    });
  }

  return {
    source: source,
    fetched: jobs.length,
    created: totalCreated,
    duplicates: totalDuplicates,
    sources: stats,
    items: fetchedItems
  };
}

module.exports = { fetchAndIngest };
