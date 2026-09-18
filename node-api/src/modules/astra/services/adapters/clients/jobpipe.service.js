async function fetchJobpipeJobs(keyword, location) {
  const apiKey = process.env.JOBPIPE_API_KEY;
  const baseUrl = process.env.JOBPIPE_BASE_URL || "https://api.jobspipe.dev";
  if (!apiKey) {
    throw new Error("JobPipe is not configured");
  }

  const body = {};
  if (keyword) {
    body.job_title_or = [keyword];
  }
  if (location) {
    body.job_location_or = [location];
  }

  const response = await fetch(`${baseUrl}/v1/jobs/search`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`JobPipe API error: ${response.statusText}`);
  }

  const data = await response.json();
  const rawJobs = data.data || [];

  return rawJobs.map(job => {
    return {
      source: "JobPipe",
      sourceId: String(job.id),
      sourceUrl: job.url || "",
      title: job.job_title || "Job Requirement",
      company: job.company || "Unknown Company",
      description: job.description || "",
      location: job.location || location || "USA",
      skills: Array.isArray(job.keyword_slugs) ? job.keyword_slugs : [],
      salary: job.salary_string || "",
      experience: "",
      employmentType: "Full-Time",
      workMode: "Hybrid",
      postedAt: job.date_posted ? new Date(job.date_posted) : new Date()
    };
  });
}

module.exports = { fetchJobpipeJobs };
