const express = require("express");
const { dailyActivity } = require("../controllers/stats.controller");

const router = express.Router();

// GET /stats/daily-activity
router.get("/daily-activity", dailyActivity);

module.exports = router;
