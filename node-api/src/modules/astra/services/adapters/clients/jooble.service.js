async function fetchJoobleJobs(keyword, location) {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) {
    throw new Error("Jooble is not configured");
  }

  const url = `https://jooble.org/api/${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keywords: keyword, location: location })
  });

  if (!response.ok) {
    throw new Error(`Jooble API error: ${response.statusText}`);
  }

  const data = await response.json();
  const rawJobs = data.jobs || [];

  return rawJobs.map(job => {
    // Strip HTML from Jooble descriptions
    const cleanDesc = (job.snippet || "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();

    return {
      source: "Jooble",
      sourceId: String(job.id),
      sourceUrl: job.link || "",
      title: job.title || "Job Requirement",
      company: job.company || "Unknown Company",
      description: cleanDesc,
      location: job.location || location || "USA",
      skills: [], // Jooble does not return structured skills
      salary: job.salary || "",
      experience: "",
      employmentType: "Full-Time",
      workMode: "Hybrid",
      postedAt: job.updated ? new Date(job.updated) : new Date()
    };
  });
}

module.exports = { fetchJoobleJobs };
