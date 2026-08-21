const express = require("express");
const { listTopSkills } = require("../controllers/stats.controller");

const router = express.Router();

// GET /skills/top
router.get("/top", listTopSkills);

module.exports = router;
