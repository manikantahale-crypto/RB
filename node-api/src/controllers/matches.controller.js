const jobRepo = require("../repositories/job.repository");
const candidateRepo = require("../repositories/candidate.repository");
const matchRepo = require("../repositories/match.repository");

const DEFAULT_SCORE_THRESHOLD = 60;

function notFound(message) {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

function parseListQuery(query) {
  const status = query.status || undefined;
  let minScore;
  if (query.minScore !== undefined && query.minScore !== "") {
    minScore = Number(query.minScore);
    if (Number.isNaN(minScore)) {
      const err = new Error("minScore must be a number");
      err.statusCode = 400;
      throw err;
    }
  }
  return { status, minScore };
}

function eligibleFromRow(score, tier, scoreThreshold) {
  const threshold =
    scoreThreshold != null ? Number(scoreThreshold) : DEFAULT_SCORE_THRESHOLD;
  if (score == null) return false;
  return Number(score) >= threshold && tier !== "reject";
}

const EMPTY_BREAKDOWN = {
  experience: 0,
  skills: 0,
  location: 0,
  visa: 0,
  availability: 0,
  domain: 0,
  education: 0,
};

const EMPTY_EVIDENCE = {
  project_title: "",
  project_desc: "",
  tech_stack_desc: "",
  experience_desc: "",
};

function mapEnrichment(row) {
  return {
    confidenceScore:
      row.confidence_score != null ? Number(row.confidence_score) : 0,
    breakdown:
      row.breakdown && typeof row.breakdown === "object"
        ? { ...EMPTY_BREAKDOWN, ...row.breakdown }
        : { ...EMPTY_BREAKDOWN },
    evidence:
      row.evidence && typeof row.evidence === "object"
        ? { ...EMPTY_EVIDENCE, ...row.evidence }
        : { ...EMPTY_EVIDENCE },
  };
}

function mapJobMatchRow(row) {
  return {
    matchId: row.match_id,
    candidateId: row.candidate_id,
    fullName: row.full_name,
    email: row.email,
    resumeId: row.resume_id,
    skillMatchScore: row.skill_match_score,
    score: row.score,
    tier: row.tier,
    matchStatus: row.match_status,
    reasoning: row.reasoning,
    strengths: row.strengths || [],
    gaps: row.gaps || [],
    greenFlags: row.green_flags || [],
    redFlags: row.red_flags || [],
    eligible: eligibleFromRow(row.score, row.tier, row.score_threshold),
    ...mapEnrichment(row),
  };
}

function mapCandidateMatchRow(row) {
  return {
    matchId: row.match_id,
    jobId: row.job_id,
    jobTitle: row.job_title,
    resumeId: row.resume_id,
    skillMatchScore: row.skill_match_score,
    score: row.score,
    tier: row.tier,
    matchStatus: row.match_status,
    reasoning: row.reasoning,
    strengths: row.strengths || [],
    gaps: row.gaps || [],
    greenFlags: row.green_flags || [],
    redFlags: row.red_flags || [],
    eligible: eligibleFromRow(row.score, row.tier, row.score_threshold),
    ...mapEnrichment(row),
  };
}

function mapJobDetail(row) {
  return {
    jobId: row.id,
    title: row.title,
    originalFileName: row.original_file_name,
    filePath: row.file_path,
    mimeType: row.mime_type,
    jdSummary: row.jd_summary,
    requiredSkills: row.required_skills || [],
    primaryRole: row.primary_role,
    summaryHash: row.summary_hash,
    scoreThreshold:
      row.score_threshold != null
        ? Number(row.score_threshold)
        : DEFAULT_SCORE_THRESHOLD,
    uploadedAt: row.uploaded_at,
    processedAt: row.processed_at,
    processingFailedAt: row.processing_failed_at,
  };
}

function mapCandidateDetail(row) {
  return {
    candidateId: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    immigrationStatus: row.immigration_status,
    location: row.location,
    linkedin: row.linkedin,
    github: row.github,
    createdAt: row.created_at,
    currentResume: row.resume_id
      ? {
          resumeId: row.resume_id,
          skills: row.skills || [],
          primaryRole: row.primary_role,
          summaryHash: row.summary_hash,
          resumeSummary: row.resume_summary,
          minRate: row.min_rate,
          education: row.education || [],
          experience: row.experience || [],
          totalExperience: row.total_experience,
          currentCompany: row.current_company,
          currentRole: row.current_role,
          profileSummary: row.profile_summary,
          processedAt: row.resume_processed_at,
          processingFailedAt: row.resume_processing_failed_at,
          processingError: row.resume_processing_error,
          isCurrent: row.is_current,
        }
      : null,
  };
}

async function listJobMatches(req, res, next) {
  try {
    const { jobId } = req.params;
    const job = await jobRepo.getJobById(jobId, req.userId);
    if (!job) throw notFound(`Job not found: ${jobId}`);

    const filters = parseListQuery(req.query);
    const rows = await matchRepo.listMatchesForJob(jobId, filters);

    res.json({
      jobId: job.id,
      jobTitle: job.title,
      matches: rows.map(mapJobMatchRow),
    });
  } catch (err) {
    next(err);
  }
}

async function listCandidateMatches(req, res, next) {
  try {
    const { candidateId } = req.params;
    const candidate = await candidateRepo.getCandidateWithCurrentResume(
      candidateId,
      req.userId
    );
    if (!candidate) throw notFound(`Candidate not found: ${candidateId}`);

    const filters = parseListQuery(req.query);
    const rows = await matchRepo.listMatchesForCandidate(candidateId, filters);

    res.json({
      candidateId: candidate.id,
      fullName: candidate.full_name,
      matches: rows.map(mapCandidateMatchRow),
    });
  } catch (err) {
    next(err);
  }
}

async function getJob(req, res, next) {
  try {
    const job = await jobRepo.getJobById(req.params.jobId, req.userId);
    if (!job) throw notFound(`Job not found: ${req.params.jobId}`);
    res.json({ job: mapJobDetail(job) });
  } catch (err) {
    next(err);
  }
}

async function getCandidate(req, res, next) {
  try {
    const row = await candidateRepo.getCandidateWithCurrentResume(
      req.params.candidateId,
      req.userId
    );
    if (!row) throw notFound(`Candidate not found: ${req.params.candidateId}`);
    res.json({ candidate: mapCandidateDetail(row) });
  } catch (err) {
    next(err);
  }
}

async function listTopMatches(req, res, next) {
  try {
    const rows = await matchRepo.listTopMatches({
      userId: req.userId,
      limit: req.query.limit,
    });
    res.json({
      matches: rows.map((r) => ({
        matchId: r.match_id,
        candidateId: r.candidate_id,
        candidateName: r.candidate_name,
        jobId: r.job_id,
        jobTitle: r.job_title,
        score: r.score != null ? Number(r.score) : 0,
        tier: r.tier,
        skillMatchScore: r.skill_match_score,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function getMatch(req, res, next) {
  try {
    const row = await matchRepo.getMatchById(req.params.matchId, req.userId);
    if (!row) throw notFound(`Match not found: ${req.params.matchId}`);
    res.json({
      match: {
        matchId: row.id,
        jobId: row.job_id,
        jobTitle: row.job_title,
        candidateId: row.candidate_id,
        fullName: row.full_name,
        email: row.email,
        resumeId: row.resume_id,
        skillMatchScore: row.skill_match_score,
        score: row.score,
        tier: row.tier,
        matchStatus: row.match_status,
        reasoning: row.reasoning,
        strengths: row.strengths || [],
        gaps: row.gaps || [],
        greenFlags: row.green_flags || [],
        redFlags: row.red_flags || [],
        eligible: eligibleFromRow(row.score, row.tier, row.score_threshold),
        ...mapEnrichment(row),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function createDirectMatch(req, res, next) {
  try {
    const matchService = require("../services/match.service");
    const { jobId, resumeId } = req.body || {};
    const result = await matchService.createDirectMatch({
      jobId,
      resumeId,
      userId: req.userId,
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    next(err);
  }
}

/** Run Tier-1/2 funnel for a JD → shortlist candidates → emit match.requested for Tier-3. */
async function runJobMatch(req, res, next) {
  try {
    const { runForJob } = require("../matching/funnel");
    const jobId = req.params.jobId;
    const job = await jobRepo.getJobById(jobId, req.userId);
    if (!job) throw notFound(`Job not found: ${jobId}`);
    if (!job.processed_at) {
      const err = new Error("Job is still processing — wait for AI parsing to finish");
      err.statusCode = 409;
      throw err;
    }
    const result = await runForJob(jobId);
    res.status(202).json({
      jobId,
      created: (result.created || []).length,
      poolSize: result.poolSize || 0,
      finalists: result.finalists || 0,
      matchIds: (result.created || []).map((m) => m.matchId),
    });
  } catch (err) {
    next(err);
  }
}

/** Run Tier-1/2 funnel for a resume → shortlist jobs → emit match.requested for Tier-3. */
async function runResumeMatch(req, res, next) {
  try {
    const { runForResume } = require("../matching/funnel");
    const resumeId = req.params.resumeId;
    const resume = await matchRepo.getResumeForMatching(resumeId);
    if (!resume) throw notFound(`Resume not found: ${resumeId}`);
    
    // Verify candidate ownership
    const candidate = await candidateRepo.getCandidateWithCurrentResume(
      resume.candidate_id,
      req.userId
    );
    if (!candidate) throw notFound(`Resume not found: ${resumeId}`);

    if (!resume.processed_at) {
      const err = new Error("Resume is still processing — wait for AI parsing to finish");
      err.statusCode = 409;
      throw err;
    }
    const result = await runForResume(resumeId);
    res.status(202).json({
      resumeId,
      candidateId: resume.candidate_id,
      created: (result.created || []).length,
      poolSize: result.poolSize || 0,
      finalists: result.finalists || 0,
      matchIds: (result.created || []).map((m) => m.matchId),
    });
  } catch (err) {
    next(err);
  }
}

async function getClosestResumesCount(req, res, next) {
  try {
    const { jobId } = req.params;
    const threshold = req.query.threshold != null ? Number(req.query.threshold) : 60;
    const job = await jobRepo.getJobById(jobId, req.userId);
    if (!job) throw notFound(`Job not found: ${jobId}`);

    const count = await jobRepo.getClosestResumesCount(jobId, threshold, req.userId);
    res.json({
      jobId,
      threshold,
      closestResumesCount: count,
      semantic_match_count: count,
      vector_match_count: count,
    });
  } catch (err) {
    next(err);
  }
}

async function getClosestJdsCount(req, res, next) {
  try {
    const { candidateId } = req.params;
    const threshold = req.query.threshold != null ? Number(req.query.threshold) : 60;
    const candidate = await candidateRepo.getCandidateWithCurrentResume(candidateId, req.userId);
    if (!candidate) throw notFound(`Candidate not found: ${candidateId}`);

    const count = await candidateRepo.getClosestJdsCount(candidateId, threshold, req.userId);
    res.json({
      candidateId,
      threshold,
      closestJdsCount: count,
      semantic_match_count: count,
      vector_match_count: count,
    });
  } catch (err) {
    next(err);
  }
}

async function retryCandidateMatch(req, res, next) {
  try {
    const { matchId } = req.params;
    const matchRow = await matchRepo.getMatchById(matchId, req.userId);
    if (!matchRow) throw notFound(`Match not found: ${matchId}`);

    const { getBoss } = require("../config/queue");
    await matchRepo.markMatching(matchRow.job_id, matchRow.resume_id);
    await getBoss().send("match.requested", {
      jobId: matchRow.job_id,
      candidateId: matchRow.candidate_id,
      resumeId: matchRow.resume_id,
    });

    res.json({
      matchId,
      status: "requested",
      retried: true,
      message: "Candidate match re-enqueued for matching",
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listJobMatches,
  listCandidateMatches,
  listTopMatches,
  createDirectMatch,
  runJobMatch,
  runResumeMatch,
  getMatch,
  getJob,
  getCandidate,
  getClosestResumesCount,
  getClosestJdsCount,
  retryCandidateMatch,
};
