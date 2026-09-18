const express = require("express");
const {
  listVendors,
  createVendor,
  getVendor,
  updateVendor,
  approveVendor,
  rejectVendor,
  deactivateVendor,
  reactivateVendor,
} = require("../controllers/vendor.controller");

const router = express.Router();

router.get("/", listVendors);
router.post("/", createVendor);
router.get("/:vendorId", getVendor);
router.patch("/:vendorId", updateVendor);

// Lifecycle routes
router.post("/:vendorId/approve", approveVendor);
router.post("/:vendorId/reject", rejectVendor);
router.post("/:vendorId/deactivate", deactivateVendor);
router.post("/:vendorId/reactivate", reactivateVendor);

module.exports = router;
