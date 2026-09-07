const express = require("express");
const {
  listPending,
  decide,
  sync,
} = require("../controllers/recruiterReview.controller");

const router = express.Router();

router.get("/recruiter/reviews/pending", listPending);
router.post("/recruiter/reviews/sync", sync);
router.post("/recruiter/reviews/:id/decide", decide);

module.exports = router;
