const { runActorAndGetDataset } = require("./apify.service");

async function fetchIndeedJobs(keyword, location) {
  const actorId = process.env.APIFY_INDEED_ACTOR_ID;
  if (!actorId) {
    throw new Error("Indeed Actor ID is missing. Set APIFY_INDEED_ACTOR_ID in environment.");
  }

  const input = {
    position: keyword || "React Developer",
    location: location || "New York",
    country: "US",
    maxItemsPerSearch: 10
  };

  const rawJobs = await runActorAndGetDataset(actorId, input);

  return rawJobs.map(job => {
    // Strip HTML from description if any
    let cleanDesc = (job.description || "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();

    if (!cleanDesc) {
      cleanDesc = `Position: ${job.positionName || "Job Requirement"}. Location: ${job.location || location || "USA"}. Please refer to the source URL for full description: ${job.url || "N/A"}`;
    }

    const empType = Array.isArray(job.jobType) ? job.jobType[0] : job.jobType;

    return {
      source: "Indeed",
      sourceId: String(job.id || ""),
      sourceUrl: job.url || job.externalApplyLink || "",
      title: job.positionName || "Job Requirement",
      company: job.company || "Unknown Client",
      description: cleanDesc,
      location: job.location || location || "New York",
      skills: [],
      salary: job.salary || "",
      experience: "",
      employmentType: empType || "Full-Time",
      workMode: "Hybrid",
      postedAt: job.postingDateParsed ? new Date(job.postingDateParsed) : new Date()
    };
  });
}

module.exports = { fetchIndeedJobs };
