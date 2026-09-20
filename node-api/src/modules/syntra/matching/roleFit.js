/**
 * Hard role-family gate so a Product Manager JD does not shortlist Finance Managers
 * (vector search alone will if the JD mentions budget / P&L).
 */

function haystack(parts) {
  return ` ${parts
    .filter(Boolean)
    .map((p) => String(p).toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim())
    .join(" ")} `;
}

const FAMILIES = [
  {
    id: "product",
    keys: ["product manager", "product owner", "product management", "product lead", "group product"],
  },
  {
    id: "marketing",
    keys: ["demand generation", "demand gen", "growth marketing", "performance marketing", "digital marketing"],
  },
  {
    id: "finance",
    keys: [
      "financial manager",
      "finance manager",
      "financial analyst",
      "accountant",
      "controller",
      "bookkeep",
      "fp a",
      "cfo",
      "treasury",
    ],
  },
  {
    id: "engineering",
    keys: ["software engineer", "developer", "full stack", "backend", "frontend", "sde "],
  },
  {
    id: "data",
    keys: ["data scientist", "data engineer", "machine learning", "ml engineer"],
  },
  {
    id: "design",
    keys: ["product designer", "ux designer", "ui designer"],
  },
  {
    id: "sales",
    keys: ["account executive", "sales manager", "bdr", "sdr"],
  },
  {
    id: "recruiting",
    keys: ["recruiter", "talent acquisition", "sourcer"],
  },
];

function roleFamily(parts) {
  const text = haystack(parts);
  if (!text.trim()) return null;
  for (const family of FAMILIES) {
    if (family.keys.some((k) => text.includes(` ${k} `) || text.includes(k))) return family.id;
  }
  return null;
}

function rolesCompatible(jobParts, resumeParts) {
  const jobFamily = roleFamily(jobParts);
  const resumeFamily = roleFamily(resumeParts);
  if (jobFamily && resumeFamily && jobFamily !== resumeFamily) return false;
  return true;
}

function toPercentScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 0 && n <= 1) return Math.round(n * 100);
  return Math.round(Math.min(100, n));
}

module.exports = { roleFamily, rolesCompatible, toPercentScore };
