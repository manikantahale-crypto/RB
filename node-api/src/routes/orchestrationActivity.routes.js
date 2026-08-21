const express = require("express");
const { getActivitySnapshot } = require("../services/orchestrationActivity.service");

const router = express.Router();

/** GET /orchestration/activity — recent outbox + orch.runs proof for UI */
router.get("/activity", async (req, res, next) => {
  try {
    const snapshot = await getActivitySnapshot();
    res.json(snapshot);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
