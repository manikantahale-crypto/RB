const candidateRepo = require("../repositories/candidate.repository");
const lifecycleRepo = require("../modules/orbit/repositories/lifecycle.repository");
const { computeCandidateActionNeeded } = require("../utils/actionNeeded");

function mapCandidateListItem(row, stateMap = new Map()) {
  let skills = row.skills || [];
  if (typeof skills === "string") {
    try {
      skills = JSON.parse(skills);
    } catch {
      skills = [];
    }
  }
  if (!Array.isArray(skills)) skills = [];

  const orbitState = stateMap.get(row.id) || (row.status === "Active" ? "AVAILABLE" : row.status || "AVAILABLE");

  const actionNeededInfo = computeCandidateActionNeeded({
    skills,
    experience_years: row.total_experience,
    work_authorization: row.immigration_status,
    location: row.location,
    orbit_lifecycle_state: orbitState,
    created_by: row.created_by,
  });

  let expDetails = row.experience || [];
  if (typeof expDetails === "string") {
    try {
      expDetails = JSON.parse(expDetails);
    } catch {
      expDetails = row.experience ? [row.experience] : [];
    }
  }

  let education = row.education || [];
  if (typeof education === "string") {
    try {
      education = JSON.parse(education);
    } catch {
      education = [];
    }
  }

  return {
    id: row.id,
    resumeId: row.resume_id ?? null,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone ?? null,
    location: row.location ?? null,
    immigrationStatus: row.immigration_status ?? null,
    currentCompany: row.current_company ?? null,
    currentRole: row.current_role ?? null,
    totalExperience: row.total_experience ?? null,
    skills,
    primaryRole: row.primary_role ?? null,
    experience: expDetails,
    education,
    minRate: row.min_rate ?? null,
    profileSummary: row.profile_summary ?? row.resume_summary ?? null,
    linkedin: row.linkedin ?? null,
    github: row.github ?? null,
    fileName: row.original_file_name ?? null,
    createdAt: row.created_at,
    processingStatus: row.processing_status,
    matchCount: Number(row.match_count) || 0,
    status: row.status || "Active",
    orbit_lifecycle_state: orbitState,
    action_needed: actionNeededInfo.action_needed,
    missing_fields: actionNeededInfo.missing_fields,
    missing_keys: actionNeededInfo.missing_keys,
  };
}

async function listCandidates(req, res, next) {
  try {
    const { rows, total } = await candidateRepo.listCandidates({
      userId: req.userId,
      limit: req.query.limit,
    });

    const candidateIds = rows.map((r) => r.id);
    let stateMap = new Map();
    if (candidateIds.length > 0) {
      stateMap = await lifecycleRepo.getLatestStatesForCandidates(candidateIds);
    }

    res.json({
      candidates: rows.map((r) => mapCandidateListItem(r, stateMap)),
      total,
    });
  } catch (err) {
    next(err);
  }
}

async function updateCandidate(req, res, next) {
  try {
    const { candidateId } = req.params;
    const updates = req.body || {};

    const updated = await candidateRepo.updateCandidate(candidateId, updates, req.userId);
    if (!updated) {
      const err = new Error(`Candidate not found: ${candidateId}`);
      err.statusCode = 404;
      throw err;
    }

    res.json({ success: true, candidate: updated });
  } catch (err) {
    next(err);
  }
}

async function deleteCandidate(req, res, next) {
  try {
    const ok = await candidateRepo.deleteCandidate(req.params.candidateId, req.userId);
    if (!ok) {
      const err = new Error(`Candidate not found: ${req.params.candidateId}`);
      err.statusCode = 404;
      throw err;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function deleteCandidatesBulk(req, res, next) {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) {
      const err = new Error("Provide ids: string[]");
      err.statusCode = 400;
      throw err;
    }
    const result = await candidateRepo.deleteCandidates(ids, req.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getCandidate(req, res, next) {
  try {
    const row = await candidateRepo.getCandidateWithCurrentResume(req.params.candidateId, req.userId);
    if (!row) {
      const err = new Error(`Candidate not found: ${req.params.candidateId}`);
      err.statusCode = 404;
      throw err;
    }

    let skills = row.skills || [];
    if (typeof skills === "string") {
      try {
        skills = JSON.parse(skills);
      } catch {
        skills = [];
      }
    }
    if (!Array.isArray(skills)) skills = [];

    let currentResume = null;
    if (row.resume_id) {
      currentResume = {
        id: row.resume_id,
        skills: skills,
        primaryRole: row.primary_role,
        summary: row.resume_summary || row.profile_summary,
        minRate: row.min_rate,
        education: row.education,
        experience: row.experience,
        totalExperience: row.total_experience,
        currentCompany: row.current_company,
        currentRole: row.current_role,
        processedAt: row.resume_processed_at,
        processingFailedAt: row.resume_processing_failed_at,
        processingError: row.resume_processing_error,
        processingStatus: row.resume_processing_failed_at ? 'failed' : (row.resume_processed_at ? 'processed' : 'processing'),
        isCurrent: row.is_current,
      };
    }

    const candidate = {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      immigrationStatus: row.immigration_status,
      location: row.location,
      linkedin: row.linkedin,
      github: row.github,
      status: row.status || "Active",
      createdAt: row.created_at,
      currentResume,
    };

    res.json({ candidate });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listCandidates,
  getCandidate,
  updateCandidate,
  deleteCandidate,
  deleteCandidatesBulk,
  mapCandidateListItem,
};
