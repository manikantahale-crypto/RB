const express = require("express");
const upload = require("../middleware/upload");
const {
  uploadJob,
  listJobs,
  deleteJobsBulk,
  getJob,
  deleteJob,
  bulkSaveJobs,
  retryJob,
} = require("../controllers/job.controller");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", listJobs);
router.post("/", upload.single("file"), uploadJob);
router.post("/bulk-delete", deleteJobsBulk);
router.get("/:jobId", getJob);
router.delete("/:jobId", deleteJob);

// POST /jobs/bulk-save
router.post("/bulk-save", requireAuth, bulkSaveJobs);

// POST /jobs/:jobId/retry
router.post("/:jobId/retry", requireAuth, retryJob);

module.exports = router;
