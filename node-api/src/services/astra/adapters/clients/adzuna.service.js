async function fetchAdzunaJobs(keyword, location) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    throw new Error("Adzuna is not configured");
  }

  const cleanKeyword = encodeURIComponent(keyword || "");
  const cleanLocation = encodeURIComponent(location || "");
  const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${appId}&app_key=${appKey}&what=${cleanKeyword}&where=${cleanLocation}&content-type=application/json`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Adzuna API error: ${response.statusText}`);
  }

  const data = await response.json();
  const rawJobs = data.results || [];

  return rawJobs.map(job => {
    const cleanDesc = (job.description || "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();

    return {
      source: "Adzuna",
      sourceId: String(job.id),
      sourceUrl: job.redirect_url || "",
      title: job.title || "Job Requirement",
      company: job.company ? job.company.display_name : "Unknown Company",
      description: cleanDesc,
      location: job.location ? job.location.display_name : location || "USA",
      skills: [],
      salary: job.salary_min ? `$${job.salary_min} - $${job.salary_max || job.salary_min}` : "",
      experience: "",
      employmentType: job.contract_type === "full_time" ? "Full-Time" : "Contract",
      workMode: "Hybrid",
      postedAt: job.created ? new Date(job.created) : new Date()
    };
  });
}

module.exports = { fetchAdzunaJobs };
