const express = require("express");
const {
  createPlacement,
  getPlacements,
  updatePlacement,
  createRevenueArrangement,
  getRevenueArrangements,
} = require("../controllers/placement.controller");

const router = express.Router();

// Placement CRUD
router.post("/", createPlacement);
router.get("/candidate/:candidateId", getPlacements);
router.patch("/:placementId", updatePlacement);

// Revenue arrangements
router.post("/:placementId/revenue", createRevenueArrangement);
router.get("/:placementId/revenue", getRevenueArrangements);

module.exports = router;
