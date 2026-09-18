const vendorService = require("../services/vendor.service");

async function listVendors(req, res, next) {
  try {
    const filters = {
      status: req.query.status,
      vendorType: req.query.vendor_type,
      search: req.query.search,
    };
    const vendors = await vendorService.listVendors(req.userId, filters);
    res.json({ data: vendors });
  } catch (err) {
    next(err);
  }
}

async function createVendor(req, res, next) {
  try {
    const vendor = await vendorService.createVendor(req.userId, req.body);
    res.status(201).json({ data: vendor });
  } catch (err) {
    next(err);
  }
}

async function getVendor(req, res, next) {
  try {
    const vendor = await vendorService.getVendorById(req.params.vendorId, req.userId);
    res.json({ data: vendor });
  } catch (err) {
    next(err);
  }
}

async function updateVendor(req, res, next) {
  try {
    const vendor = await vendorService.updateVendor(req.params.vendorId, req.userId, req.body);
    res.json({ data: vendor });
  } catch (err) {
    next(err);
  }
}

// -----------------------------------------------------------------------------
// Lifecycle Controllers
// -----------------------------------------------------------------------------
async function approveVendor(req, res, next) {
  try {
    const vendor = await vendorService.approveVendor(req.params.vendorId, req.userId);
    res.json({ data: vendor, message: "Vendor approved" });
  } catch (err) {
    next(err);
  }
}

async function rejectVendor(req, res, next) {
  try {
    const vendor = await vendorService.rejectVendor(req.params.vendorId, req.userId);
    res.json({ data: vendor, message: "Vendor rejected" });
  } catch (err) {
    next(err);
  }
}

async function deactivateVendor(req, res, next) {
  try {
    const vendor = await vendorService.deactivateVendor(req.params.vendorId, req.userId);
    res.json({ data: vendor, message: "Vendor deactivated" });
  } catch (err) {
    next(err);
  }
}

async function reactivateVendor(req, res, next) {
  try {
    const vendor = await vendorService.reactivateVendor(req.params.vendorId, req.userId);
    res.json({ data: vendor, message: "Vendor reactivated" });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listVendors,
  createVendor,
  getVendor,
  updateVendor,
  approveVendor,
  rejectVendor,
  deactivateVendor,
  reactivateVendor,
};
