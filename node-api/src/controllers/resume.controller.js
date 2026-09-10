const resumeService = require("../services/resume.service");

async function uploadResume(req, res, next) {
  try {
    if (!req.file) {
      const err = new Error("No file uploaded (field name must be 'file')");
      err.statusCode = 400;
      throw err;
    }
    const result = await resumeService.createResume({
      fullName: req.body.fullName,
      email: req.body.email,
      phone: req.body.phone,
      file: req.file,
      userId: req.userId,
      orgId: req.orgId,
    });

    if (result.status === "duplicate") {
      res.status(409).json({ 
        message: "Duplicate resume detected", 
        resumeId: result.resumeId, 
        candidateId: result.candidateId, 
        status: "duplicate" 
      });
    } else {
      res.status(202).json({ 
        resumeId: result.resumeId, 
        candidateId: result.candidateId, 
        status: "accepted" 
      });
    }
  } catch (err) {
    next(err);
  }
}

async function bulkSaveResumes(req, res, next) {
  try {
    const { candidateIds } = req.body;
    if (!candidateIds || !Array.isArray(candidateIds)) {
      return res.status(400).json({ message: "candidateIds array is required" });
    }
    const count = await resumeService.bulkSaveCandidates(candidateIds, req.userId);
    if (count === 0) {
      return res.status(409).json({
        message:
          "No resumes were saved. The resume may still be processing, failed parsing, or belong to another user.",
        count: 0,
      });
    }
    res.json({ message: "Resumes saved successfully", count });
  } catch (err) {
    next(err);
  }
}

async function retryResume(req, res, next) {
  try {
    const { resumeId } = req.params;
    if (!resumeId) {
      return res.status(400).json({ message: "resumeId is required" });
    }
    const result = await resumeService.retryResume(resumeId, req.userId);
    res.status(202).json({
      resumeId: result.resumeId,
      candidateId: result.candidateId,
      status: "accepted"
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { uploadResume, bulkSaveResumes, retryResume };
