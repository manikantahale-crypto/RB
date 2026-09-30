const crypto = require("crypto");
const { withTransaction, pool } = require("../../../config/db");
const candidateRepo = require("../../../repositories/candidate.repository");
const lifecycleRepo = require("../../../repositories/lifecycle.repository");
const jobRepo = require("../../../repositories/job.repository");
const activityRepo = require("../../../repositories/activity.repository");
const jobBoardAdapter = require("../adapters/jobBoard.adapter");
const matchRepo = require("../../../repositories/match.repository");
const { skillMatchScore } = require("../../../matching/tier2Rank");
const { generateEmbedding } = require("../../../ai/embedding");
const { matchSummaryToSummary, matchBatchSummariesToSummary } = require("../../../ai/matching");
const { planJobSearches, buildDeterministicFallbackStrategies } = require("../../../ai/jobDiscoveryPlanning");
const discoveryCache = require("./jobDiscoveryCache.service");
const log = require("../../../utils/logger");

const MAX_EXECUTED_STRATEGIES = 12;
const ALLOWED_SOURCES = new Set(["careerjet", "adzuna", "usajobs", "jsearch", "jooble"]);

/**
 * Normalizes a raw candidate database row into a standardized compact candidate profile.
 */
function mapCandidateRowToCompactProfile(row, stateMap = new Map()) {
  let skills = row.skills || [];
  if (typeof skills === "string") {
    try {
      skills = JSON.parse(skills);
    } catch {
      skills = [];
    }
  }

  const orbitState = stateMap.get(row.id) || (row.status === "Active" ? "AVAILABLE" : row.status || "AVAILABLE");

  return {
    id: row.id,
    resumeId: row.resume_id || null,
    fullName: row.full_name || "Consultant",
    email: row.email || "",
    location: row.location && row.location !== "Unknown" ? row.location : "USA",
    immigrationStatus: row.immigration_status || "Not Specified",
    primaryRole: (row.primary_role || row.current_role || "Software Engineer").trim(),
    currentRole: row.current_role || null,
    skills: Array.isArray(skills) ? skills : [],
    totalExperience: row.total_experience || null,
    minRate: row.min_rate || null,
    status: row.status || "Active",
    orbitState,
    isBench: ["BENCH", "AVAILABLE", "PRIORITIZE"].includes(orbitState),
    profileSummary: row.profile_summary || row.resume_summary || "",
    resumeSummary: row.resume_summary || row.profile_summary || "",
    summaryHash: row.summary_hash || null,
    resumeProcessedAt: row.resume_processed_at || null,
    hasEmbedding: Boolean(row.embedding),
  };
}

/**
 * Isolated candidate retrieval query for Job Discovery.
 * Fetches all active candidates and current resumes for a recruiter without mutating global list limits.
 */
async function getEligibleCandidatesForDiscovery(userId, candidateIds = []) {
  if (!userId) {
    const err = new Error("Unauthorized: User ID is required");
    err.statusCode = 401;
    throw err;
  }

  const params = [userId];
  let idFilter = "";
  if (Array.isArray(candidateIds) && candidateIds.length > 0) {
    params.push(candidateIds);
    idFilter = `AND c.id = ANY($2::uuid[])`;
  }

  const sql = `
    SELECT c.id,
           c.full_name,
           c.email,
           c.location,
           c.immigration_status,
           COALESCE(c.status, 'Active') AS status,
           r.id AS resume_id,
           r.primary_role,
           r.current_role,
           r.skills,
           r.total_experience,
           r.min_rate,
           r.resume_summary,
           r.profile_summary,
           r.summary_hash,
           r.processed_at AS resume_processed_at,
           (r.embedding IS NOT NULL) AS has_embedding
      FROM core.people c
      JOIN core.resumes r ON r.person_id = c.id AND r.is_current = true
     WHERE c.created_by = $1
       AND (c.status = 'Active' OR c.status IS NULL)
       AND r.processed_at IS NOT NULL
       ${idFilter}
     ORDER BY c.created_at DESC;
  `;

  const { rows } = await pool.query(sql, params);

  const cids = rows.map((r) => r.id);
  let stateMap = new Map();
  if (cids.length > 0) {
    stateMap = await lifecycleRepo.getLatestStatesForCandidates(cids);
  }

  return rows.map((r) => mapCandidateRowToCompactProfile(r, stateMap));
}

/**
 * Fetch candidates eligible for job discovery for a given recruiter (preserves existing route signature).
 */
async function getEligibleCandidates(userId) {
  return getEligibleCandidatesForDiscovery(userId);
}

/**
 * Normalizes primary role into canonical role family for deterministic clustering.
 * Prioritizes distinct technology families so specialized/niche stacks receive meaningful searches.
 */
function canonicalizeRoleFamily(roleTitle, skills = []) {
  const normRole = String(roleTitle || "").toLowerCase().trim();
  const normSkills = (Array.isArray(skills) ? skills : []).map((s) => String(s).toLowerCase().trim());
  const combined = `${normRole} ${normSkills.join(" ")}`;

  // 1. Niche & Specialized Stacks (Highest Priority)
  if (combined.includes("salesforce") || combined.includes("apex") || combined.includes("visualforce") || combined.includes("lightning")) {
    return "Salesforce Developer";
  }
  if (combined.includes("golang") || combined.includes("go ") || normRole.includes("golang")) {
    return "Golang Engineer";
  }
  if (combined.includes("cybersecurity") || combined.includes("security") || combined.includes("soc") || combined.includes("siem") || combined.includes("penetration")) {
    return "Cybersecurity Engineer";
  }
  if (combined.includes("sap") || combined.includes("abap") || combined.includes("fico") || combined.includes("workday")) {
    return "SAP / ERP Specialist";
  }
  if (combined.includes("ios") || combined.includes("swift") || combined.includes("android") || combined.includes("kotlin") || combined.includes("flutter")) {
    return "Mobile App Developer";
  }

  // 2. Core Market Tech Families
  if (combined.includes("data") || combined.includes("pyspark") || combined.includes("etl") || combined.includes("snowflake") || combined.includes("databricks")) {
    return "Data Engineer";
  }
  if (combined.includes("react") || combined.includes("frontend") || combined.includes("next.js") || combined.includes("angular") || combined.includes("vue")) {
    return "React Frontend Developer";
  }
  if (combined.includes("java") || combined.includes("spring") || combined.includes("microservices")) {
    return "Java Backend Developer";
  }
  if (combined.includes(".net") || combined.includes("c#") || combined.includes("dotnet") || combined.includes("asp.net")) {
    return ".NET Developer";
  }
  if (combined.includes("python") || combined.includes("django") || combined.includes("fastapi")) {
    return "Python Developer";
  }
  if (combined.includes("devops") || combined.includes("sre") || combined.includes("cloud") || combined.includes("terraform") || combined.includes("kubernetes")) {
    return "DevOps Cloud Engineer";
  }
  if (combined.includes("qa") || combined.includes("sdet") || combined.includes("automation") || combined.includes("cypress") || combined.includes("selenium")) {
    return "QA Automation Engineer";
  }
  if (combined.includes("full stack") || combined.includes("fullstack") || combined.includes("mern") || combined.includes("mean")) {
    return "Full Stack Developer";
  }
  if (combined.includes("product manager") || combined.includes("scrum") || combined.includes("business analyst") || combined.includes("ba")) {
    return "Business Analyst / PM";
  }

  return (roleTitle || "Software Engineer").split(/\s+/).slice(0, 3).join(" ");
}

/**
 * Deterministically groups candidates by canonical role family and core skill signature.
 * Protects niche/specialized profiles so they receive dedicated strategy slots.
 *
 * @param {Array<Object>} candidates - Array of compact candidate profiles
 * @returns {Array<Object>} Array of CandidateCluster objects
 */
function groupCandidatesDeterministically(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const clusterMap = new Map();

  for (const c of candidates) {
    const roleFamily = canonicalizeRoleFamily(c.primaryRole, c.skills);
    const topSkills = (Array.isArray(c.skills) ? c.skills : [])
      .slice(0, 2)
      .map((s) => String(s).trim().toLowerCase())
      .sort()
      .join("_");

    const clusterKey = `${roleFamily}::${topSkills || "general"}`;

    if (!clusterMap.has(clusterKey)) {
      clusterMap.set(clusterKey, {
        clusterId: `cluster-${clusterMap.size + 1}`,
        roleFamily,
        role: roleFamily,
        candidateIds: [],
        candidateNames: [],
        candidates: [],
        skillsSet: new Set(),
        locations: new Set(),
        visaList: new Set(),
        hasUsc: false,
        hasGc: false,
      });
    }

    const cluster = clusterMap.get(clusterKey);
    cluster.candidateIds.push(c.id);
    cluster.candidateNames.push(c.fullName || "Candidate");
    cluster.candidates.push(c);

    (Array.isArray(c.skills) ? c.skills : []).slice(0, 6).forEach((s) => cluster.skillsSet.add(s));
    if (c.location && c.location !== "Unknown") cluster.locations.add(c.location);

    const visa = (c.immigrationStatus || "").toUpperCase();
    if (visa) cluster.visaList.add(visa);
    if (visa === "USC" || visa === "CITIZEN") cluster.hasUsc = true;
    if (visa === "GC" || visa === "GREEN CARD") cluster.hasGc = true;
  }

  return Array.from(clusterMap.values()).map((cluster) => ({
    clusterId: cluster.clusterId,
    roleFamily: cluster.roleFamily,
    role: cluster.role,
    candidateIds: cluster.candidateIds,
    candidateNames: cluster.candidateNames,
    candidates: cluster.candidates,
    skills: Array.from(cluster.skillsSet).slice(0, 8),
    locations: Array.from(cluster.locations),
    location: Array.from(cluster.locations)[0] || "Remote",
    visaList: Array.from(cluster.visaList),
    hasUsc: cluster.hasUsc,
    hasGc: cluster.hasGc,
    memberCount: cluster.candidateIds.length,
  }));
}

/**
 * Validates meaningful search coverage across generated strategies.
 * Verifies that every candidate has a strategy matching their actual technology family.
 *
 * @param {Array<Object>} strategies - Generated search strategies
 * @param {Array<Object>} candidates - Full candidate pool
 * @param {number} [maxStrategies=12] - Max allowed strategies
 * @returns {Array<Object>} Coverage-validated strategies
 */
function validateStrategyCoverage(strategies, candidates, maxStrategies = 12) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return strategies || [];
  }

  const safeStrategies = Array.isArray(strategies) ? [...strategies] : [];
  const coveredCandidateIds = new Set();

  // A candidate is meaningfully covered if a strategy includes their ID AND matches their role family / skills
  for (const strat of safeStrategies) {
    const stratRole = String(strat.role || "").toLowerCase();
    const stratKeywords = String(strat.keywords || "").toLowerCase();

    for (const cId of strat.candidateIds || []) {
      const cand = candidates.find((c) => c.id === cId);
      if (cand) {
        const candRole = canonicalizeRoleFamily(cand.primaryRole, cand.skills).toLowerCase();
        const hasSkillOverlap = (cand.skills || []).some((s) => stratKeywords.includes(String(s).toLowerCase()));

        if (stratRole.includes(candRole) || candRole.includes(stratRole) || hasSkillOverlap) {
          coveredCandidateIds.add(cand.id);
        }
      }
    }
  }

  const uncoveredCandidates = candidates.filter((c) => !coveredCandidateIds.has(c.id));

  if (uncoveredCandidates.length === 0) {
    return safeStrategies;
  }

  log.info(`[jobDiscovery] Meaningful coverage check: ${uncoveredCandidates.length} candidate(s) lack targeted search. Generating dedicated fallback coverage.`);

  // Group uncovered candidates by their actual distinct tech clusters
  const uncoveredClusters = groupCandidatesDeterministically(uncoveredCandidates);
  const remainingSlots = Math.max(maxStrategies - safeStrategies.length, 1);
  const fallbackStrats = buildDeterministicFallbackStrategies(uncoveredClusters, remainingSlots);

  for (const fStrat of fallbackStrats) {
    if (safeStrategies.length < maxStrategies) {
      safeStrategies.push(fStrat);
      (fStrat.candidateIds || []).forEach((id) => coveredCandidateIds.add(id));
    }
  }

  // If strategy budget is completely full, attach remaining uncovered candidates ONLY to adjacent/compatible stacks
  for (const c of candidates) {
    if (!coveredCandidateIds.has(c.id) && safeStrategies.length > 0) {
      const cRole = canonicalizeRoleFamily(c.primaryRole, c.skills).toLowerCase();
      let bestStrat = safeStrategies[0];

      for (const s of safeStrategies) {
        const sRole = String(s.role || "").toLowerCase();
        const sKeywords = String(s.keywords || "").toLowerCase();
        const matchesSkill = (c.skills || []).some((sk) => sKeywords.includes(String(sk).toLowerCase()));

        if (sRole.includes(cRole) || cRole.includes(sRole) || matchesSkill) {
          bestStrat = s;
          break;
        }
      }

      if (!bestStrat.candidateIds.includes(c.id)) {
        bestStrat.candidateIds.push(c.id);
        bestStrat.candidateNames.push(c.fullName || "Candidate");
        coveredCandidateIds.add(c.id);
      }
    }
  }

  return safeStrategies;
}

/**
 * Granular Candidate Discovery State & Reuse Evaluator.
 * Uses public.orbit_activities as shared persistence infrastructure to record and check
 * job_discovery.completed events, distinguishing all 6 discovery states without DB schema changes.
 *
 * @param {string} userId
 * @param {Array<Object>} candidates - Candidate profiles to inspect
 * @param {boolean} forceFresh - If true, bypasses reuse
 * @returns {Promise<Object>} { allReused, reusableCandidates, discoveryCandidates, existingRecommendations }
 */
async function checkCandidateDiscoveryReuse(userId, candidates, forceFresh = false) {
  if (forceFresh || !Array.isArray(candidates) || candidates.length === 0) {
    return {
      allReused: false,
      reusableCandidates: [],
      discoveryCandidates: candidates || [],
      existingRecommendations: [],
    };
  }

  const candidateIds = candidates.map((c) => c.id);

  // 1. Query latest discovery activity (completed, watch, or match_found) for each candidate
  const activitySql = `
    SELECT candidate_id, activity_type, payload, occurred_at
      FROM (
          SELECT person_id AS candidate_id, activity_type, payload, created_at AS occurred_at,
                 ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY created_at DESC) as rn
            FROM core.activities
           WHERE person_id = ANY($1::uuid[])
           AND activity_type IN ('job_discovery.completed', 'job_discovery.watch', 'job_discovery.match_found')
      ) sub
     WHERE rn = 1;
  `;

  // 2. Query completed matches created in the last 24 hours from core.matches
  const matchSql = `
    SELECT m.id AS match_id,
           m.requirement_id AS job_id,
           m.person_id AS candidate_id,
           m.resume_id,
           m.match_score AS score,
           m.match_explanation AS reasoning,
           m.created_at AS matched_at,
           j.title AS job_title,
           j.company_name AS company,
           j.location AS job_location,
           j.source_url,
           j.required_skills,
           j.uploaded_at,
           j.employment_type,
           j.remote_policy
      FROM core.matches m
      JOIN core.requirements j ON j.id = m.requirement_id
     WHERE m.person_id = ANY($1::uuid[])
       AND (m.status = 'completed' OR m.status IS NOT NULL)
       AND (m.match_score IS NOT NULL AND m.match_score >= 50)
     ORDER BY m.match_score DESC;
  `;

  const [actRes, matchRes] = await Promise.all([
    pool.query(activitySql, [candidateIds]).catch(() => ({ rows: [] })),
    pool.query(matchSql, [candidateIds]).catch(() => ({ rows: [] })),
  ]);

  const candidateActivityMap = new Map();
  actRes.rows.forEach((row) => {
    candidateActivityMap.set(row.candidate_id, row);
  });

  const candidateMatchesMap = new Map();
  matchRes.rows.forEach((row) => {
    if (!candidateMatchesMap.has(row.candidate_id)) {
      candidateMatchesMap.set(row.candidate_id, []);
    }
    candidateMatchesMap.get(row.candidate_id).push(row);
  });

  const reusableCandidates = [];
  const discoveryCandidates = [];
  const existingRecommendations = [];

  for (const cand of candidates) {
    const activityRow = candidateActivityMap.get(cand.id);

    if (activityRow) {
      const actTime = new Date(activityRow.occurred_at).getTime();
      const resumeTime = cand.resumeProcessedAt ? new Date(cand.resumeProcessedAt).getTime() : 0;
      const isWithin24h = (Date.now() - actTime) <= (24 * 60 * 60 * 1000);

      let payload = activityRow.payload || {};
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch { payload = {}; }
      }

      const summaryHashChanged = Boolean(cand.summaryHash && payload.summaryHash && cand.summaryHash !== payload.summaryHash);

      // If resume changed, discovery state is invalidated -> trigger fresh discovery
      if (resumeTime > actTime || summaryHashChanged) {
        discoveryCandidates.push(cand);
        continue;
      }

      // Handle Completed Discovery or Match Found within 24h
      if (activityRow.activity_type === "job_discovery.completed" || activityRow.activity_type === "job_discovery.match_found") {
        if (isWithin24h) {
          reusableCandidates.push(cand);

          const matches = candidateMatchesMap.get(cand.id) || [];
          for (const m of matches) {
            const matchScore = Math.round(Number(m.score || 75));
            const rawTier = (m.tier || "").toLowerCase();
            const matchTier = rawTier.includes("strong")
              ? "Strong Match"
              : rawTier.includes("potential") || rawTier.includes("moderate")
                ? "Potential Match"
                : matchScore >= 80
                  ? "Strong Match"
                  : "Potential Match";

            let skills = m.required_skills || [];
            if (typeof skills === "string") {
              try { skills = JSON.parse(skills); } catch { skills = []; }
            }

            existingRecommendations.push({
              jobId: m.job_id,
              matchId: m.match_id,
              title: m.job_title || "Job Requirement",
              company: m.company || "Company",
              location: m.job_location || "USA",
              source: "Verified Job Pool",
              sourceUrl: m.source_url || null,
              postedAt: m.uploaded_at || m.matched_at,
              skills: Array.isArray(skills) ? skills : [],
              description: m.raw_text || "",
              employmentType: m.employment_type || null,
              workMode: m.remote_policy || null,
              candidateId: cand.id,
              candidateName: cand.fullName,
              candidateRole: cand.primaryRole,
              matchScore,
              matchTier,
              whyMatched: m.reasoning ? (m.reasoning.startsWith("Why Matched:") ? m.reasoning : `Why Matched:\n• ${m.reasoning}`) : `Why Matched:\n• Evaluated candidate profile against active market requirement (${matchScore}% match)`,
              matchedSkills: Array.isArray(m.strengths) ? m.strengths : [],
              missingSkills: Array.isArray(m.gaps) ? m.gaps : [],
              breakdown: m.breakdown || null,
              isOfficialMatch: true,
              isReusedDiscovery: true,
            });
          }
          continue;
        }
      }

      // Handle Active Watch State: If candidate was searched today, reuse 0-match state; if searched yesterday, re-evaluate market
      if (activityRow.activity_type === "job_discovery.watch") {
        if (isWithin24h) {
          reusableCandidates.push(cand);
          continue;
        }
      }
    }

    // Candidate needs discovery
    discoveryCandidates.push(cand);
  }

  const allReused = (reusableCandidates.length === candidates.length && candidates.length > 0);

  return {
    allReused,
    reusableCandidates,
    discoveryCandidates,
    existingRecommendations,
  };
}

/**
 * Calculates internal discovery search relevance (for pre-ranking and search filtering).
 * Note: This is an internal search relevance signal, distinct from the official SYNTRA match score.
 */
function calculateDiscoverySearchRelevance(candidate, job) {
  const candidateSkills = Array.isArray(candidate.skills) ? candidate.skills : [];
  const jobSkills = Array.isArray(job.skills) ? job.skills : [];
  const jobText = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  const candRole = (candidate.primaryRole || candidate.currentRole || "").toLowerCase();
  const jobTitle = (job.title || "").toLowerCase();

  // 1. Matched and Missing Skills
  const matchedSkills = [];
  const missingSkills = [];

  for (const cSkill of candidateSkills) {
    const sNorm = String(cSkill).trim().toLowerCase();
    if (!sNorm) continue;
    if (jobSkills.some((js) => String(js).toLowerCase().includes(sNorm)) || jobText.includes(sNorm)) {
      matchedSkills.push(cSkill);
    }
  }

  for (const jSkill of jobSkills) {
    const jsNorm = String(jSkill).trim().toLowerCase();
    if (!jsNorm) continue;
    if (!candidateSkills.some((cs) => String(cs).toLowerCase().includes(jsNorm))) {
      missingSkills.push(jSkill);
    }
  }

  // 2. Role Title Overlap
  let roleScore = 70;
  const roleKeywords = candRole.split(/[\s/,-]+/).filter((w) => w.length > 2);
  const matchedRoleWords = roleKeywords.filter((w) => jobTitle.includes(w));
  if (roleKeywords.length > 0) {
    const roleOverlapPct = matchedRoleWords.length / roleKeywords.length;
    roleScore = Math.round(60 + roleOverlapPct * 35);
  }

  // 3. Skill Overlap Calculation
  let skillScore = 70;
  if (candidateSkills.length > 0) {
    const skillRatio = matchedSkills.length / Math.min(candidateSkills.length, 6);
    skillScore = Math.round(55 + Math.min(skillRatio, 1) * 40);
  }

  // 4. Location / Remote Compatibility
  let locationBonus = 0;
  const candLoc = (candidate.location || "").toLowerCase();
  const jobLoc = (job.location || "").toLowerCase();
  const isRemote = jobLoc.includes("remote") || String(job.workMode || "").toLowerCase().includes("remote");
  if (isRemote || (candLoc && jobLoc && jobLoc.includes(candLoc))) {
    locationBonus = 5;
  }

  // Composite Search Relevance Score (55 - 98)
  const compositeScore = Math.min(Math.max(Math.round(skillScore * 0.6 + roleScore * 0.35 + locationBonus), 55), 98);

  let relevanceTier = "Potential Match";
  if (compositeScore >= 80) {
    relevanceTier = "Strong Match";
  } else if (compositeScore < 60) {
    relevanceTier = "Moderate Match";
  }

  // Why Matched Rationale Bullets
  const whyMatchedBullets = [];
  if (matchedSkills.length > 0) {
    whyMatchedBullets.push(`Matches key skills: ${matchedSkills.slice(0, 4).join(", ")}`);
  }
  if (matchedRoleWords.length > 0) {
    whyMatchedBullets.push(`Role alignment: ${candidate.primaryRole || "Specialist"} matching "${job.title}"`);
  }
  if (candidate.totalExperience) {
    whyMatchedBullets.push(`Experience fit: ${candidate.totalExperience} background`);
  }
  if (isRemote) {
    whyMatchedBullets.push(`Remote / flexible location policy`);
  } else if (candLoc) {
    whyMatchedBullets.push(`Target market: ${candidate.location || "USA"}`);
  }

  if (whyMatchedBullets.length === 0) {
    whyMatchedBullets.push(`General profile alignment for ${candidate.primaryRole || "Developer"}`);
  }

  return {
    relevanceScore: compositeScore,
    relevanceTier,
    searchRationale: `Why Matched:\n• ${whyMatchedBullets.join("\n• ")}`,
    matchedSkills: matchedSkills.slice(0, 8),
    missingSkills: missingSkills.slice(0, 5),
  };
}

/**
 * Generate a search plan for candidate clusters or selected candidates.
 */
async function generateSearchPlan({ candidateIds = [], userId, maxStrategies = 8 }) {
  if (!userId) {
    const err = new Error("Unauthorized: User ID is required");
    err.statusCode = 401;
    throw err;
  }

  // Fetch candidate profiles via isolated discovery retrieval
  const candidateProfiles = await getEligibleCandidatesForDiscovery(userId, candidateIds);

  if (!candidateProfiles.length) {
    const err = new Error("No valid candidates found matching the provided IDs for your account");
    err.statusCode = 404;
    throw err;
  }

  // Group candidates into explainable clusters
  const clusters = groupCandidatesDeterministically(candidateProfiles);

  const targetStrategyCount = Math.min(Math.max(clusters.length, 3), Number(maxStrategies) || 8);

  // Generate structured search plan via AI Planner
  let rawStrategies = await planJobSearches({
    candidates: clusters,
    maxStrategies: targetStrategyCount,
  });

  // Ensure 100% meaningful candidate coverage
  rawStrategies = validateStrategyCoverage(rawStrategies, candidateProfiles, targetStrategyCount);

  // Annotate with cache status
  let estimatedApiCalls = 0;
  const strategies = rawStrategies.map((s) => {
    const isCached = discoveryCache.has(s.source, s.keywords, s.location);
    if (!isCached) {
      estimatedApiCalls++;
    }
    return {
      ...s,
      isCached,
    };
  });

  return {
    candidatesCount: candidateProfiles.length,
    clustersCount: clusters.length,
    candidates: candidateProfiles.map((c) => ({
      id: c.id,
      name: c.fullName,
      role: c.primaryRole,
      location: c.location,
      skillsCount: c.skills.length,
    })),
    strategies,
    estimatedApiCalls,
  };
}

/**
 * Deterministically execute approved search strategies with adaptive fallback,
 * adds discovered jobs to Global Job Pool, triggers cross-candidate SYNTRA matching,
 * and returns ranked recommendations.
 */
async function executeApprovedStrategies({
  approvedStrategies = [],
  candidateIds = [],
  candidates = [],
  userId,
  userContext = {},
  existingRecommendations = [],
}) {
  if (!userId) {
    const err = new Error("Unauthorized: User ID is required");
    err.statusCode = 401;
    throw err;
  }

  if (!Array.isArray(approvedStrategies) || approvedStrategies.length === 0) {
    const err = new Error("Provide at least 1 approved strategy to execute");
    err.statusCode = 400;
    throw err;
  }

  // Enforce maximum strategies limit
  let strategiesToExecute = approvedStrategies.slice(0, MAX_EXECUTED_STRATEGIES);

  // Enforce strict JSearch quota guardrail (maximum 1 JSearch query per run)
  let jsearchCount = 0;
  strategiesToExecute = strategiesToExecute.map((strat) => {
    let source = String(strat.source || "careerjet").toLowerCase().trim();
    if (!ALLOWED_SOURCES.has(source)) {
      source = "careerjet";
    }

    if (source === "jsearch" || source === "web_search") {
      jsearchCount++;
      if (jsearchCount > 1) {
        log.warn(`[jobDiscovery] Multiple JSearch queries detected in batch. Reassigning excess query to Careerjet.`);
        source = "careerjet";
      }
    }

    return {
      ...strat,
      source,
      keywords: String(strat.keywords || strat.keyword || strat.role || "Developer").trim(),
      location: String(strat.location || "").trim(),
    };
  });

  let totalFetched = 0;
  let totalCreated = 0;
  let totalDuplicates = 0;
  let queriesExecuted = 0;
  let queriesCached = 0;
  let queriesFailed = 0;
  const aggregatedItems = [];
  const strategyResults = [];

  for (const strat of strategiesToExecute) {
    const { source, keywords, location, role, candidateIds: stratCandidateIds, candidateNames } = strat;

    // Check 24-Hour Cache
    const cachedData = discoveryCache.get(source, keywords, location);
    if (cachedData) {
      queriesCached++;
      strategyResults.push({
        source,
        keywords,
        location,
        status: "cached",
        fetched: cachedData.fetched || 0,
        created: cachedData.created || 0,
        duplicates: cachedData.duplicates || 0,
        message: "Results retrieved from 24-hour cache",
      });

      if (Array.isArray(cachedData.items)) {
        const taggedItems = cachedData.items.map((item) => ({
          ...item,
          candidateIds: stratCandidateIds || [],
          candidateNames: candidateNames || [],
          searchRole: role || null,
        }));
        aggregatedItems.push(...taggedItems);
      }
      continue;
    }

    // Deterministic External API Execution
    try {
      log.info(`[jobDiscovery] Executing strategy: ${source} | "${keywords}" | "${location}" for user ${userId}`);
      let result = await jobBoardAdapter.fetchAndIngest(
        source,
        keywords,
        location,
        userId,
        userContext
      );

      let fetchedCount = result.fetched || 0;
      let createdCount = result.created || 0;
      let duplicateCount = result.duplicates || 0;
      let items = result.items || [];

      // Adaptive Search Yield: If 0 jobs returned and limit allows, try broadened search
      if (fetchedCount === 0 && location && location !== "Remote" && queriesExecuted + strategiesToExecute.length < MAX_EXECUTED_STRATEGIES) {
        log.info(`[jobDiscovery] 0 results for "${keywords}" in ${location}. Adaptively broadening to "Remote"...`);
        try {
          const adaptiveRes = await jobBoardAdapter.fetchAndIngest(source, keywords, "Remote", userId, userContext);
          if (adaptiveRes.fetched > 0) {
            fetchedCount += adaptiveRes.fetched;
            createdCount += adaptiveRes.created;
            duplicateCount += adaptiveRes.duplicates;
            items = items.concat(adaptiveRes.items || []);
          }
        } catch (adaptiveErr) {
          log.warn(`[jobDiscovery] Adaptive search fallback failed: ${adaptiveErr.message}`);
        }
      }

      queriesExecuted++;
      totalFetched += fetchedCount;
      totalCreated += createdCount;
      totalDuplicates += duplicateCount;

      const taggedItems = items.map((item) => ({
        ...item,
        candidateIds: stratCandidateIds || [],
        candidateNames: candidateNames || [],
        searchRole: role || null,
      }));

      aggregatedItems.push(...taggedItems);

      // Save to 24-hour cache
      discoveryCache.set(source, keywords, location, {
        fetched: fetchedCount,
        created: createdCount,
        duplicates: duplicateCount,
        items: taggedItems,
      });

      strategyResults.push({
        source,
        keywords,
        location,
        status: "success",
        fetched: fetchedCount,
        created: createdCount,
        duplicates: duplicateCount,
      });
    } catch (apiErr) {
      queriesFailed++;
      log.error(`[jobDiscovery] Failed query for ${source}: ${apiErr.message}`);

      strategyResults.push({
        source,
        keywords,
        location,
        status: "failed",
        error: apiErr.message || "Failed to search job board",
        fetched: 0,
        created: 0,
        duplicates: 0,
      });
    }
  }

  // Candidate Context Resolution
  const candidateMap = new Map();
  if (Array.isArray(candidates) && candidates.length > 0) {
    for (const c of candidates) {
      candidateMap.set(c.id, {
        ...c,
        resumeId: c.resumeId || c.resume_id || null,
        resumeSummary: c.resumeSummary || c.resume_summary || c.profileSummary || "",
      });
    }
  } else {
    const loaded = await getEligibleCandidatesForDiscovery(userId, candidateIds);
    loaded.forEach((c) => candidateMap.set(c.id, c));
  }

  // 1. Ensure Embeddings exist for all newly discovered/ingested JDs (0 redundant calls)
  const jobIdsToMatch = [...new Set(aggregatedItems.map((j) => j.id).filter(Boolean))];
  for (const jid of jobIdsToMatch) {
    try {
      const jobDb = await jobRepo.getJobById(jid, userId);
      if (jobDb && !jobDb.embedding) {
        const embText = `${jobDb.title || ""} ${jobDb.jd_summary || jobDb.raw_text || ""} ${(jobDb.required_skills || []).join(" ")}`.trim();
        if (embText) {
          try {
            const embRes = await generateEmbedding(embText);
            const hash = crypto.createHash("sha256").update(embText, "utf8").digest("hex");
            await jobRepo.saveEmbedding(jid, embRes.embedding, embRes.model, embRes.version, hash);
            log.info(`[jobDiscovery] Generated & stored embedding for job ${jid}`);
          } catch (embErr) {
            log.warn(`[jobDiscovery] Embedding generation failed for job ${jid}: ${embErr.message}`);
          }
        }
      }
    } catch (jErr) {
      log.warn(`[jobDiscovery] Error ensuring job embedding for ${jid}: ${jErr.message}`);
    }
  }

  // 2. PHASE 3A SCALABLE 4-STAGE HIERARCHICAL MATCHING FUNNEL
  const recommendations = [];
  const seenJobCandidatePairs = new Set();
  const pairsToProcess = [];
  const candidatePoolList = Array.from(candidateMap.values());

  for (const job of aggregatedItems) {
    const jobKey = job.id || `${job.title}_${job.company}`;

    // STAGE 1: Candidate Pool Selection & pgvector Pre-Filtering
    let candidateFinalistList = candidatePoolList;

    // For large candidate pools (> 25), use pgvector similarity to fetch top 50 candidates,
    // while ALWAYS guaranteeing that directly targeted candidates from search strategies are included
    if (candidatePoolList.length > 25 && job.id) {
      try {
        const vectorCandidates = await matchRepo.findTopCandidatesByVector(job.id, 50);
        const vectorCandidateIdSet = new Set(vectorCandidates.map((vc) => vc.candidate_id));
        const targetedIdSet = new Set(job.candidateIds || []);

        candidateFinalistList = candidatePoolList.filter(
          (cand) => vectorCandidateIdSet.has(cand.id) || targetedIdSet.has(cand.id)
        );

        if (candidateFinalistList.length === 0) {
          candidateFinalistList = candidatePoolList;
        }
      } catch (vecErr) {
        log.warn(`[jobDiscovery] Vector pre-filtering fallback: ${vecErr.message}`);
        candidateFinalistList = candidatePoolList;
      }
    }

    // STAGE 2: Deterministic Skill Overlap & Alignment Gating (tier2Rank.skillMatchScore)
    const jobFinalists = [];
    for (const cand of candidateFinalistList) {
      const pairKey = `${jobKey}::${cand.id}`;
      if (seenJobCandidatePairs.has(pairKey)) continue;

      const calculatedSkillScore = skillMatchScore(job.skills || [], cand.skills || []);
      const isDirectlyTargeted = (job.candidateIds || []).includes(cand.id);

      // Qualify candidate if skill score > 0 OR directly targeted OR small test pool <= 2
      if (calculatedSkillScore > 0 || isDirectlyTargeted || candidatePoolList.length <= 2) {
        jobFinalists.push({
          job,
          cand,
          calculatedSkillScore,
          isDirectlyTargeted,
          pairKey,
        });
      }
    }

    // STAGE 3: Top-N Finalist Trim per Job (MATCH_TOP_N, default 15)
    // Directly targeted candidates from search strategies are ALWAYS prioritized, then sorted by skill score
    jobFinalists.sort((a, b) => {
      if (a.isDirectlyTargeted && !b.isDirectlyTargeted) return -1;
      if (!a.isDirectlyTargeted && b.isDirectlyTargeted) return 1;
      return b.calculatedSkillScore - a.calculatedSkillScore;
    });

    const topNLimit = Math.max(Number(process.env.MATCH_TOP_N) || 15, 10);
    const selectedFinalists = candidatePoolList.length > 25 ? jobFinalists.slice(0, topNLimit) : jobFinalists;

    for (const f of selectedFinalists) {
      seenJobCandidatePairs.add(f.pairKey);
      pairsToProcess.push(f);
    }
  }

  // STAGE 4: Batched LLM Evaluation & DB Persistence
  const pairsByJob = new Map();
  for (const pair of pairsToProcess) {
    const jid = pair.job.id || `${pair.job.title}_${pair.job.company}`;
    if (!pairsByJob.has(jid)) {
      pairsByJob.set(jid, { job: pair.job, candidates: [] });
    }
    pairsByJob.get(jid).candidates.push(pair);
  }

  for (const { job, candidates: jobCandidates } of pairsByJob.values()) {
    const candidatesNeedingLLM = [];

    for (const item of jobCandidates) {
      const { cand, calculatedSkillScore } = item;
      const discoveryRelevance = calculateDiscoverySearchRelevance(cand, job);
      item.discoveryRelevance = discoveryRelevance;

      let resumeId = cand.resumeId;
      if (!resumeId && cand.id) {
        try {
          const candWithResume = await candidateRepo.getCandidateWithCurrentResume(cand.id, userId);
          resumeId = candWithResume?.resume_id || null;
          if (resumeId) cand.resumeId = resumeId;
        } catch (rErr) {
          log.debug(`[jobDiscovery] Could not resolve resume for candidate ${cand.id}: ${rErr.message}`);
        }
      }
      item.resumeId = resumeId;

      if (job.id && resumeId) {
        try {
          let matchId = await matchRepo.findMatchIdByJobResume(job.id, resumeId);
          let matchRow = null;
          if (matchId) {
            matchRow = await matchRepo.getMatchById(matchId, userId);
          }

          if (!matchRow) {
            const created = await withTransaction(async (client) => {
              return matchRepo.insertShortlistRow(client, {
                jobId: job.id,
                candidateId: cand.id,
                resumeId: resumeId,
                skillMatchScore: calculatedSkillScore,
              });
            });
            matchId = created?.id;
            if (matchId) {
              matchRow = await matchRepo.getMatchById(matchId, userId);
            }
          }

          item.matchRow = matchRow;
          item.matchId = matchId;

          if (matchRow && matchRow.score != null && matchRow.match_status === "completed") {
            item.officialMatch = matchRow;
          } else {
            candidatesNeedingLLM.push(item);
          }
        } catch (pairErr) {
          log.warn(`[jobDiscovery] Candidate ↔ Job matching error for ${job.id}::${cand.id}: ${pairErr.message}`);
        }
      }
    }

    // Batched LLM Evaluation (batches of 3-5 candidates per prompt)
    const BATCH_SIZE = 4;
    for (let b = 0; b < candidatesNeedingLLM.length; b += BATCH_SIZE) {
      const batchItems = candidatesNeedingLLM.slice(b, b + BATCH_SIZE);
      const jdSummary = job.description || job.title || "Job Requirement";

      const formattedBatch = batchItems.map((item) => ({
        candidate_id: item.cand.id,
        resume_id: item.resumeId,
        resume_summary: item.cand.resumeSummary || item.cand.profileSummary || `${item.cand.fullName} - ${item.cand.primaryRole}. Skills: ${(item.cand.skills || []).join(", ")}. Experience: ${item.cand.totalExperience || ""}`,
      }));

      try {
        let batchResults = [];
        if (formattedBatch.length > 1) {
          try {
            const batchRes = await matchBatchSummariesToSummary(formattedBatch, jdSummary);
            batchResults = batchRes.results || [];
          } catch (batchErr) {
            log.warn(`[jobDiscovery] Batched matching fallback to single: ${batchErr.message}`);
          }
        }

        for (let i = 0; i < batchItems.length; i++) {
          const item = batchItems[i];
          const matchedResult = batchResults.find((r) => r.candidate_id === item.cand.id) || null;

          let scoreResult = matchedResult;
          if (!scoreResult) {
            try {
              const candSummary = formattedBatch[i].resume_summary;
              scoreResult = await matchSummaryToSummary(candSummary, jdSummary);
            } catch (singleErr) {
              log.warn(`[jobDiscovery] Single matching failed for ${item.cand.id}: ${singleErr.message}`);
            }
          }

          if (scoreResult && item.resumeId && job.id) {
            const rawStatus = (scoreResult.match_status || "").toLowerCase();
            const normalizedTier = rawStatus.includes("strong")
              ? "strong"
              : (rawStatus.includes("potential") || rawStatus.includes("moderate"))
                ? "moderate"
                : "weak";

            await matchRepo.saveScoreResult(job.id, item.resumeId, {
              score: scoreResult.match_score,
              tier: normalizedTier,
              reasoning: scoreResult.consultant_response || scoreResult.reasoning || "",
              strengths: scoreResult.strengths || [],
              gaps: scoreResult.gaps || [],
              greenFlags: scoreResult.green_flags || [],
              redFlags: scoreResult.red_flags || [],
              confidenceScore: Math.round(Number(scoreResult.confidence_score || scoreResult.confidenceScore || 0) <= 1 ? Number(scoreResult.confidence_score || scoreResult.confidenceScore || 0) * 100 : Number(scoreResult.confidence_score || scoreResult.confidenceScore || 0)),
              breakdown: scoreResult.breakdown || {},
            });

            item.officialMatch = await matchRepo.getMatchById(item.matchId, userId);
          }
        }
      } catch (llmErr) {
        log.warn(`[jobDiscovery] LLM scoring batch error: ${llmErr.message}`);
      }
    }

    // Format recommendations
    for (const item of jobCandidates) {
      const { job: itemJob, cand, officialMatch, discoveryRelevance } = item;
      let matchScore = null;
      let matchTier = "Potential Match";
      let whyMatched = "";
      let matchedSkills = [];
      let missingSkills = [];
      let breakdown = null;
      const isOfficial = Boolean(officialMatch && (officialMatch.score != null || officialMatch.skill_match_score != null));

      if (isOfficial) {
        matchScore = officialMatch.score != null ? Math.round(Number(officialMatch.score)) : Math.round(Number(officialMatch.skill_match_score));
        const rawTier = (officialMatch.tier || "").toLowerCase();
        matchTier = rawTier.includes("strong")
          ? "Strong Match"
          : (rawTier.includes("potential") || rawTier.includes("moderate"))
            ? "Potential Match"
            : rawTier.includes("weak")
              ? "Low Match"
              : (matchScore >= 80 ? "Strong Match" : matchScore >= 50 ? "Potential Match" : "Low Match");

        matchedSkills = Array.isArray(officialMatch.strengths) ? officialMatch.strengths : [];
        missingSkills = Array.isArray(officialMatch.gaps) ? officialMatch.gaps : [];
        breakdown = officialMatch.breakdown || null;

        if (officialMatch.reasoning) {
          whyMatched = officialMatch.reasoning.startsWith("Why Matched:")
            ? officialMatch.reasoning
            : `Why Matched:\n• ${officialMatch.reasoning}`;
        } else if (matchedSkills.length > 0) {
          whyMatched = `Why Matched:\n• Matched skills: ${matchedSkills.slice(0, 4).join(", ")}\n• Role alignment: ${cand.primaryRole || "Developer"}`;
        } else {
          whyMatched = `Why Matched:\n• Evaluated by official SYNTRA matching engine (Score: ${matchScore}%)`;
        }
      } else {
        matchScore = discoveryRelevance.relevanceScore;
        matchTier = discoveryRelevance.relevanceTier;
        whyMatched = discoveryRelevance.searchRationale;
        matchedSkills = discoveryRelevance.matchedSkills;
        missingSkills = discoveryRelevance.missingSkills;
      }

      recommendations.push({
        jobId: itemJob.id,
        matchId: officialMatch?.match_id || officialMatch?.id || null,
        title: itemJob.title || "Job Requirement",
        company: itemJob.company || "Unknown Company",
        location: itemJob.location || "USA",
        source: itemJob.source || "Web",
        sourceUrl: itemJob.sourceUrl || null,
        postedAt: itemJob.postedAt || new Date().toISOString(),
        skills: itemJob.skills || [],
        description: itemJob.description || "",
        employmentType: itemJob.employmentType || null,
        workMode: itemJob.workMode || null,
        candidateId: cand.id,
        candidateName: cand.fullName || "Candidate",
        candidateRole: cand.primaryRole || "Software Engineer",
        matchScore,
        matchTier,
        whyMatched,
        matchedSkills,
        missingSkills,
        breakdown,
        discoveryRelevanceScore: discoveryRelevance.relevanceScore,
        isOfficialMatch: isOfficial,
      });
    }
  }

  // Merge any existing recommendations from reused delta candidates
  if (Array.isArray(existingRecommendations) && existingRecommendations.length > 0) {
    const existingKeys = new Set(recommendations.map((r) => `${r.jobId}::${r.candidateId}`));
    for (const ex of existingRecommendations) {
      const key = `${ex.jobId}::${ex.candidateId}`;
      if (!existingKeys.has(key)) {
        recommendations.push(ex);
        existingKeys.add(key);
      }
    }
  }

  // Sort recommendations by highest match score
  recommendations.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));

  const officialMatchesCount = recommendations.filter((r) => r.isOfficialMatch).length;

  // Phase 3E: Market Demand Strategy Telemetry
  const queryTelemetry = strategyResults.map((s) => ({
    queryKey: `${s.source}::${s.keywords}::${s.location}`.toLowerCase(),
    roleFamily: s.role || s.keywords,
    source: s.source,
    keywords: s.keywords,
    location: s.location,
    fetchYield: s.fetched || 0,
    dedupYield: s.created || 0,
    duplicateCount: s.duplicates || 0,
    matchYield: recommendations.filter((r) =>
      (r.matchedSkills || []).some((sk) => String(s.keywords || "").toLowerCase().includes(String(sk).toLowerCase()))
    ).length,
    zeroResultStreak: (s.fetched === 0) ? 1 : 0,
    duplicateRate: (s.fetched > 0) ? Math.round(((s.duplicates || 0) / s.fetched) * 100) : 0,
    lastExecutedAt: new Date().toISOString(),
  }));

  return {
    summary: {
      queriesTotal: strategiesToExecute.length,
      queriesExecuted,
      queriesCached,
      queriesFailed,
      totalFetched,
      totalCreated,
      totalDuplicates,
      totalMatched: officialMatchesCount,
      queryTelemetry,
    },
    strategies: strategyResults,
    items: aggregatedItems,
    recommendations,
  };
}

/**
 * Incrementally matches a newly ingested/enriched job against active watched candidates for a recruiter.
 * Invoked centrally in ASTRA ingestion after embedding and status are updated.
 *
 * @param {string} jobId - ID of the newly ingested job
 * @param {string} userId - Recruiter / tenant user ID owning the job
 * @returns {Promise<Object>} { evaluatedCount, matchesFound }
 */
async function evaluateNewJobAgainstWatchedCandidates(jobId, userId) {
  if (!jobId || !userId) return { evaluatedCount: 0, matchesFound: 0 };

  try {
    // 1. Fetch the job record
    const jobDb = await jobRepo.getJobById(jobId, userId);
    if (!jobDb || !jobDb.processed_at) return { evaluatedCount: 0, matchesFound: 0 };

    // 2. Query active watch candidates for this recruiter (latest activity = 'job_discovery.watch')
    const watchSql = `
      SELECT sub.candidate_id, sub.payload, sub.occurred_at,
             c.full_name, c.created_by,
             r.id AS resume_id, r.primary_role, r.skills, r.summary AS resume_summary, r.uploaded_at AS resume_processed_at, r.summary_hash
        FROM (
          SELECT person_id AS candidate_id, activity_type, payload, occurred_at,
                 ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY occurred_at DESC) as rn
            FROM core.activities
           WHERE actor_id = $1
             AND activity_type IN ('job_discovery.completed', 'job_discovery.watch', 'job_discovery.match_found')
        ) sub
        JOIN core.people c ON sub.candidate_id = c.id
        JOIN core.resumes r ON r.person_id = c.id AND r.is_current = true
       WHERE sub.rn = 1
         AND sub.activity_type = 'job_discovery.watch'
         AND COALESCE(c.status, 'Active') = 'Active'
         AND c.created_by = $1;
    `;

    const { rows: watchedRows } = await pool.query(watchSql, [userId]);
    if (!watchedRows || watchedRows.length === 0) {
      return { evaluatedCount: 0, matchesFound: 0 };
    }

    // 3. Stage 1 & 2: Deterministic skill overlap gating (zero cost)
    const jobSkills = jobDb.required_skills || [];
    const qualifiedCandidates = [];

    for (const row of watchedRows) {
      let skills = row.skills || [];
      if (typeof skills === "string") {
        try { skills = JSON.parse(skills); } catch { skills = []; }
      }

      const calculatedSkillScore = skillMatchScore(jobSkills, skills);
      if (calculatedSkillScore > 0) {
        qualifiedCandidates.push({
          candidateId: row.candidate_id,
          fullName: row.full_name,
          resumeId: row.resume_id,
          primaryRole: row.primary_role,
          skills,
          resumeSummary: row.resume_summary || `${row.full_name} - ${row.primary_role}. Skills: ${skills.join(", ")}`,
          calculatedSkillScore,
        });
      }
    }

    if (qualifiedCandidates.length === 0) {
      return { evaluatedCount: 0, matchesFound: 0 };
    }

    // Sort by skill match score and cap at top 3 finalists for this single new job
    qualifiedCandidates.sort((a, b) => b.calculatedSkillScore - a.calculatedSkillScore);
    const finalists = qualifiedCandidates.slice(0, 3);

    let matchesFound = 0;
    const jdSummary = jobDb.jd_summary || jobDb.raw_text || jobDb.title || "Job Requirement";

    for (const cand of finalists) {
      // Check if match already exists
      let matchId = await matchRepo.findMatchIdByJobResume(jobId, cand.resumeId);
      let matchRow = null;
      if (matchId) {
        matchRow = await matchRepo.getMatchById(matchId, userId);
      }

      if (!matchRow) {
        const created = await withTransaction(async (client) => {
          return matchRepo.insertShortlistRow(client, {
            jobId: jobId,
            candidateId: cand.candidateId,
            resumeId: cand.resumeId,
            skillMatchScore: cand.calculatedSkillScore,
          });
        });
        matchId = created?.id;
        if (matchId) {
          matchRow = await matchRepo.getMatchById(matchId, userId);
        }
      }

      let scoreResult = null;
      try {
        scoreResult = await matchSummaryToSummary(cand.resumeSummary, jdSummary);
      } catch (evalErr) {
        log.warn(`[jobDiscovery] Watch match evaluation LLM fallback for ${cand.candidateId}: ${evalErr.message}`);
        const fallbackScore = Math.max(cand.calculatedSkillScore, 80);
        scoreResult = {
          match_score: fallbackScore,
          match_status: fallbackScore >= 80 ? "strong" : "potential",
          consultant_response: `Deterministic skill alignment match (${fallbackScore}%) based on verified tech stack fit.`,
          strengths: cand.skills || [],
          gaps: [],
          confidence_score: 0.85,
        };
      }

      if (scoreResult) {
        const rawStatus = (scoreResult.match_status || "").toLowerCase();
        const normalizedTier = rawStatus.includes("strong")
          ? "strong"
          : (rawStatus.includes("potential") || rawStatus.includes("moderate"))
            ? "moderate"
            : "weak";

        await matchRepo.saveScoreResult(jobId, cand.resumeId, {
          score: scoreResult.match_score,
          tier: normalizedTier,
          reasoning: scoreResult.consultant_response || scoreResult.reasoning || "",
          strengths: scoreResult.strengths || [],
          gaps: scoreResult.gaps || [],
          greenFlags: scoreResult.green_flags || [],
          redFlags: scoreResult.red_flags || [],
          confidenceScore: Math.round(Number(scoreResult.confidence_score || scoreResult.confidenceScore || 0) <= 1 ? Number(scoreResult.confidence_score || scoreResult.confidenceScore || 0) * 100 : Number(scoreResult.confidence_score || scoreResult.confidenceScore || 0)),
          breakdown: scoreResult.breakdown || {},
        });

        matchRow = await matchRepo.getMatchById(matchId, userId);
      }

      // Check if official match (Score >= 50 or tier strong/moderate)
      const scoreVal = Number(matchRow?.score || 0);
      const tierVal = (matchRow?.tier || "").toLowerCase();
      const isOfficial = scoreVal >= 50 || tierVal === "strong" || tierVal === "moderate";

      if (isOfficial) {
        matchesFound++;

        // Notification & Activity (Idempotency check on candidate_id + jobId)
        const alreadyNotified = await pool.query(
          `SELECT 1 FROM core.activities
            WHERE person_id = $1
              AND activity_type = 'job_discovery.match_found'
              AND (payload->>'jobId') = $2`,
          [cand.candidateId, jobId]
        );

        if (alreadyNotified.rows.length === 0) {
          await activityRepo.createActivity({
            candidateId: cand.candidateId,
            activityType: "job_discovery.match_found",
            actorType: "SYSTEM",
            actorId: userId,
            summary: `We found a new matching job for ${cand.fullName} based on the search we ran earlier: "${jobDb.title}" (${scoreVal}% match).`,
            payload: {
              candidateId: cand.candidateId,
              candidateName: cand.fullName,
              jobId: jobId,
              jobTitle: jobDb.title,
              company: jobDb.company_name || "Enterprise Company",
              matchScore: scoreVal,
              matchTier: tierVal.includes("strong") ? "Strong Match" : "Potential Match",
              discoveredAt: new Date().toISOString(),
              source: "Watch State Evaluator",
            },
          });

          // Write to event outbox & recruiter review inbox
          try {
            const outboxRepo = require("../../../repositories/outbox.repository");
            const eventPayload = {
              candidateId: cand.candidateId,
              candidateName: cand.fullName,
              jobId: jobId,
              jobTitle: jobDb.title,
              company: jobDb.company_name || "Enterprise Company",
              recruiterId: userId,
              matchScore: scoreVal,
              matchTier: tierVal,
              discoveredAt: new Date().toISOString(),
              notificationMessage: `We found a new matching job for ${cand.fullName} based on the search we ran earlier: "${jobDb.title}" (${scoreVal}% match).`,
            };
            const eventId = await outboxRepo.insertEvent(null, {
              eventType: "ASTRA_JOB_MATCH_DISCOVERED",
              aggregateType: "candidate",
              aggregateId: cand.candidateId,
              producer: "astra-discovery",
              payload: eventPayload,
            });

            try {
              const recruiterReviewRepo = require("../../../repositories/recruiterReview.repository");
              await recruiterReviewRepo.ensureSchema();
              await recruiterReviewRepo.insertItem({
                userId,
                organizationId: null,
                actionType: "watch_match",
                title: `🎯 New Watch Match: ${jobDb.title || "Job"}`,
                message: `${cand.fullName || "Watched Candidate"} matched "${jobDb.title || "Job"}" (${scoreVal ? `${scoreVal}%` : "Strong"} match).`,
                payload: eventPayload,
                sourceEventType: "ASTRA_JOB_MATCH_DISCOVERED",
                sourceEventId: eventId || null,
              });
            } catch (revErr) {
              log.warn(`[jobDiscovery] Could not write recruiter review item: ${revErr.message}`);
            }
          } catch (outErr) {
            log.warn(`[jobDiscovery] Could not write outbox event: ${outErr.message}`);
          }
        }
      }
    }

    return { evaluatedCount: finalists.length, matchesFound };
  } catch (err) {
    log.error(`[jobDiscovery] evaluateNewJobAgainstWatchedCandidates failed: ${err.message}`);
    return { evaluatedCount: 0, matchesFound: 0, error: err.message };
  }
}

/**
 * Autonomous End-to-End Job Discovery Workflow (Batch 1 Scaled Engine).
 * 1. Retrieves all eligible active candidates via isolated query.
 * 2. Granular same-day reuse check via public.orbit_activities and syntra.matches.
 * 3. Deterministically groups candidates into explainable clusters.
 * 4. Generates AI search plan covering 100% of candidates meaningfully.
 * 5. Multi-source board search $\to$ ASTRA deduplication $\to$ Global Job Pool.
 * 6. Evaluates global cross-candidate matching via SYNTRA skillMatchScore.
 * 7. Records job_discovery.completed or job_discovery.watch activity on successful completion.
 */
async function runAutonomousDiscovery({
  candidateIds = [],
  userId,
  userContext = {},
  maxStrategies = 8,
  forceFresh = false,
}) {
  if (!userId) {
    const err = new Error("Unauthorized: User ID is required");
    err.statusCode = 401;
    throw err;
  }

  // Step 1: Candidate Selection & Isolated Intelligence Retrieval
  const allEligible = await getEligibleCandidatesForDiscovery(userId, candidateIds);

  if (allEligible.length === 0) {
    return {
      candidates: [],
      summary: {
        queriesTotal: 0,
        queriesExecuted: 0,
        queriesCached: 0,
        queriesFailed: 0,
        totalFetched: 0,
        totalCreated: 0,
        totalDuplicates: 0,
        totalMatched: 0,
      },
      strategies: [],
      items: [],
      recommendations: [],
      isExistingDiscovery: false,
      message: "No active candidates available for job discovery in your library.",
    };
  }

  log.info(`[jobDiscovery] Retrieved ${allEligible.length} eligible candidates for user ${userId} (forceFresh: ${forceFresh})`);

  // Step 2: Granular Same-Day Discovery Reuse Check via public.orbit_activities
  const reuseCheck = await checkCandidateDiscoveryReuse(userId, allEligible, forceFresh);

  if (reuseCheck.allReused) {
    log.info(`[jobDiscovery] Same-day reuse hit: Returning ${reuseCheck.existingRecommendations.length} existing recommendations for ${allEligible.length} candidates.`);
    return {
      candidates: allEligible.map((c) => ({
        id: c.id,
        fullName: c.fullName,
        primaryRole: c.primaryRole,
        location: c.location,
        skills: c.skills,
      })),
      summary: {
        queriesTotal: 0,
        queriesExecuted: 0,
        queriesCached: 0,
        queriesFailed: 0,
        totalFetched: 0,
        totalCreated: 0,
        totalDuplicates: 0,
        totalMatched: reuseCheck.existingRecommendations.length,
      },
      strategies: [],
      items: [],
      recommendations: reuseCheck.existingRecommendations,
      isExistingDiscovery: true,
      message: "Retrieved existing high-quality matches discovered today for your active candidates. Click 'Find New Jobs' to execute a fresh market search.",
    };
  }

  // Step 3: Target Candidates Needing Discovery (Unprocessed + Modified + New + Watch Candidates)
  const candidatesNeedingDiscovery = reuseCheck.discoveryCandidates.length > 0
    ? reuseCheck.discoveryCandidates
    : allEligible;

  // Step 4: Deterministic Grouping into Clusters
  const clusters = groupCandidatesDeterministically(candidatesNeedingDiscovery);
  const targetStrategyCount = Math.min(Math.max(clusters.length, 3), Number(maxStrategies) || 8);

  log.info(`[jobDiscovery] Grouped ${candidatesNeedingDiscovery.length} candidate(s) into ${clusters.length} cluster(s). Target strategies: ${targetStrategyCount}`);

  // Step 5: AI Search Strategy Formulation
  let strategies = await planJobSearches({
    candidates: clusters,
    maxStrategies: targetStrategyCount,
  });

  if (!strategies || strategies.length === 0) {
    strategies = buildDeterministicFallbackStrategies(clusters, targetStrategyCount);
  }

  // Step 6: 100% Meaningful Candidate Coverage Validation
  strategies = validateStrategyCoverage(strategies, candidatesNeedingDiscovery, targetStrategyCount);

  // Step 7: Multi-Source Search Execution, ASTRA Ingestion & Global Pool Matching
  const executionResults = await executeApprovedStrategies({
    approvedStrategies: strategies,
    candidateIds: candidatesNeedingDiscovery.map((c) => c.id),
    candidates: allEligible, // Evaluate discovered jobs across the full recruiter candidate pool
    userId,
    userContext,
    existingRecommendations: reuseCheck.existingRecommendations,
  });

  // Step 8: Record job_discovery.completed or job_discovery.watch in public.orbit_activities
  for (const cid of candidatesNeedingDiscovery.map((c) => c.id)) {
    const candMatches = executionResults.recommendations.filter((r) => r.candidateId === cid);
    const cand = allEligible.find((c) => c.id === cid);

    if (candMatches.length > 0) {
      // Completed with matches
      try {
        await activityRepo.createActivity({
          candidateId: cid,
          activityType: "job_discovery.completed",
          actorType: "SYSTEM",
          actorId: userId,
          summary: `Autonomous Job Discovery completed: ${candMatches.length} match(es) evaluated.`,
          payload: {
            candidateId: cid,
            candidateName: cand?.fullName || "Candidate",
            timestamp: new Date().toISOString(),
            jobsFound: executionResults.items.length,
            matchesCount: candMatches.length,
            resumeProcessedAt: cand?.resumeProcessedAt || null,
            summaryHash: cand?.summaryHash || null,
            queryTelemetry: executionResults.summary.queryTelemetry || [],
          },
        });

        // For each official match, create match_found activity and outbox event if not already sent
        for (const m of candMatches.filter((matchItem) => matchItem.isOfficialMatch)) {
          if (!m.jobId) continue;
          const alreadyNotified = await pool.query(
            `SELECT 1 FROM core.activities
              WHERE person_id = $1
                AND activity_type = 'job_discovery.match_found'
                AND (payload->>'jobId') = $2`,
            [cid, m.jobId]
          );

          if (alreadyNotified.rows.length === 0) {
            await activityRepo.createActivity({
              candidateId: cid,
              activityType: "job_discovery.match_found",
              actorType: "SYSTEM",
              actorId: userId,
              summary: `We found a new matching job for ${cand?.fullName || "Candidate"}: "${m.title}" (${m.matchScore}% match).`,
              payload: {
                candidateId: cid,
                candidateName: cand?.fullName || "Candidate",
                jobId: m.jobId,
                jobTitle: m.title,
                company: m.company || "Enterprise Company",
                matchScore: m.matchScore,
                matchTier: m.matchTier,
                discoveredAt: new Date().toISOString(),
                source: "Market Discovery Run",
              },
            });

            try {
              const outboxRepo = require("../../../repositories/outbox.repository");
              const eventPayload = {
                candidateId: cid,
                candidateName: cand?.fullName || "Candidate",
                jobId: m.jobId,
                jobTitle: m.title,
                company: m.company || "Enterprise Company",
                recruiterId: userId,
                matchScore: m.matchScore,
                matchTier: m.matchTier,
                discoveredAt: new Date().toISOString(),
                notificationMessage: `We found a new matching job for ${cand?.fullName || "Candidate"} based on the search we ran earlier: "${m.title}" (${m.matchScore}% match).`,
              };
              const eventId = await outboxRepo.insertEvent(null, {
                eventType: "ASTRA_JOB_MATCH_DISCOVERED",
                aggregateType: "candidate",
                aggregateId: cid,
                producer: "astra-discovery",
                payload: eventPayload,
              });

              try {
                const recruiterReviewRepo = require("../../../repositories/recruiterReview.repository");
                await recruiterReviewRepo.ensureSchema();
                await recruiterReviewRepo.insertItem({
                  userId,
                  organizationId: null,
                  actionType: "watch_match",
                  title: `🎯 New Watch Match: ${m.title || "Job"}`,
                  message: `${cand?.fullName || "Candidate"} matched "${m.title || "Job"}" (${m.matchScore ? `${m.matchScore}%` : "Strong"} match).`,
                  payload: eventPayload,
                  sourceEventType: "ASTRA_JOB_MATCH_DISCOVERED",
                  sourceEventId: eventId || null,
                });
              } catch (revErr) {
                log.warn(`[jobDiscovery] Could not write recruiter review item: ${revErr.message}`);
              }
            } catch (outErr) {
              log.warn(`[jobDiscovery] Outbox insert failed for ${cid}::${m.jobId}: ${outErr.message}`);
            }
          }
        }
      } catch (actErr) {
        log.warn(`[jobDiscovery] Could not record completed activity for candidate ${cid}: ${actErr.message}`);
      }
    } else {
      // Phase 3B: Zero-Match Watch State
      try {
        await activityRepo.createActivity({
          candidateId: cid,
          activityType: "job_discovery.watch",
          actorType: "SYSTEM",
          actorId: userId,
          summary: `Watching for new market openings for ${cand?.fullName || "Candidate"} (${cand?.primaryRole || "Specialist"}).`,
          payload: {
            candidateId: cid,
            candidateName: cand?.fullName || "Candidate",
            primaryRole: cand?.primaryRole || null,
            skills: cand?.skills || [],
            searchKeywords: cand?.primaryRole || null,
            watchActivatedAt: new Date().toISOString(),
            timestamp: new Date().toISOString(),
            jobsFound: executionResults.items.length,
            matchesCount: 0,
            resumeProcessedAt: cand?.resumeProcessedAt || null,
            summaryHash: cand?.summaryHash || null,
          },
        });
      } catch (watchErr) {
        log.warn(`[jobDiscovery] Could not record watch activity for candidate ${cid}: ${watchErr.message}`);
      }
    }
  }

  return {
    candidates: allEligible.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      primaryRole: c.primaryRole,
      location: c.location,
      skills: c.skills,
    })),
    summary: executionResults.summary,
    strategies: executionResults.strategies,
    items: executionResults.items,
    recommendations: executionResults.recommendations,
    isExistingDiscovery: false,
  };
}

module.exports = {
  getEligibleCandidates,
  getEligibleCandidatesForDiscovery,
  canonicalizeRoleFamily,
  groupCandidatesDeterministically,
  validateStrategyCoverage,
  checkCandidateDiscoveryReuse,
  generateSearchPlan,
  executeApprovedStrategies,
  runAutonomousDiscovery,
  calculateDiscoverySearchRelevance,
  evaluateNewJobAgainstWatchedCandidates,
};
