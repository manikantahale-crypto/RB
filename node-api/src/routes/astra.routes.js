const express = require("express");
const { ingestEmail, getEmailStatus, pollEmails } = require("../controllers/astra.controller");

const router = express.Router();

// POST /api/astra/intake/email (or /astra/intake/email)
router.post("/intake/email", ingestEmail);

// GET /api/astra/email-status
router.get("/email-status", getEmailStatus);

// POST /api/astra/poll-emails
router.post("/poll-emails", pollEmails);

module.exports = router;
