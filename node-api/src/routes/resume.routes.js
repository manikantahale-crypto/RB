const express = require("express");
const upload = require("../middleware/upload");
const { uploadResume, bulkSaveResumes, retryResume } = require("../controllers/resume.controller");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// POST /resumes  (multipart/form-data: file=<pdf>, fullName, email, phone)
router.post("/", upload.single("file"), uploadResume);

// POST /resumes/bulk-save
router.post("/bulk-save", requireAuth, bulkSaveResumes);

// POST /resumes/:resumeId/retry
router.post("/:resumeId/retry", requireAuth, retryResume);

module.exports = router;