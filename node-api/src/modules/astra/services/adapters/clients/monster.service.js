const { runActorAndGetDataset } = require("./apify.service");

async function fetchMonsterJobs(keyword, location) {
  const actorId = process.env.APIFY_MONSTER_ACTOR_ID;
  if (!actorId) {
    throw new Error("Monster Actor ID is missing. Set APIFY_MONSTER_ACTOR_ID in environment.");
  }

  let locationName = location || "New York, NY";
  if (locationName.toLowerCase() === "new york") {
    locationName = "New York, NY";
  }

  const input = {
    includeKeyword: keyword || "React Developer",
    locationName: locationName,
    pagesToFetch: 1
  };

  const rawJobs = await runActorAndGetDataset(actorId, input);

  // Monster can return up to 100 jobs per page. Slice to top 10 to align with other providers.
  const jobsToProcess = rawJobs.slice(0, 10);

  return jobsToProcess.map(job => {
    // Strip HTML from description if any
    let cleanDesc = (job.descriptionText || job.descriptionMarkdown || "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();

    // Ingestion requires a non-empty description. Use a helpful fallback if empty.
    if (!cleanDesc) {
      cleanDesc = `Position: ${job.title || "Job Requirement"}. Location: ${job.location || location || "USA"}. Please refer to the source URL for full description: ${job.url || "N/A"}`;
    }

    const empType = Array.isArray(job.workTypes) ? job.workTypes[0] : job.workTypes;

    let salaryStr = job.salaryText || "";
    if (!salaryStr && job.salaryMin) {
      salaryStr = `$${job.salaryMin}`;
      if (job.salaryMax && job.salaryMax !== job.salaryMin) {
        salaryStr += ` - $${job.salaryMax}`;
      }
      if (job.salaryPeriod) {
        salaryStr += ` per ${job.salaryPeriod.toLowerCase()}`;
      }
    }

    return {
      source: "Monster",
      sourceId: String(job.id || ""),
      sourceUrl: job.url || "",
      title: job.title || "Job Requirement",
      company: job.company || "Unknown Client",
      description: cleanDesc,
      location: job.location || location || "New York",
      skills: [],
      salary: salaryStr,
      experience: "",
      employmentType: empType || "Full-Time",
      workMode: job.isRemote ? "Remote" : "Hybrid",
      postedAt: job.publishDateISO || job.publishDate ? new Date(job.publishDateISO || job.publishDate) : new Date()
    };
  });
}

module.exports = { fetchMonsterJobs };
