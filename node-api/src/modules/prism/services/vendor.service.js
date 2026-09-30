const { withTransaction } = require("../../../config/db");
const vendorRepo = require("../repositories/vendor.repository");
const userRepo = require("../../../repositories/user.repository");

const VALID_VENDOR_TYPES = ["DIRECT_CLIENT", "PRIME_VENDOR", "TIER_1", "TIER_2", "STAFFING_AGENCY"];

async function createVendor(userId, data) {
  if (!userId) {
    const err = new Error("Unauthorized: Authenticated user is required");
    err.statusCode = 401;
    throw err;
  }

  if (!data || !data.name || typeof data.name !== "string" || !data.name.trim()) {
    const err = new Error("Vendor name is required");
    err.statusCode = 400;
    throw err;
  }

  const cleanName = data.name.trim();

  if (data.vendorType && !VALID_VENDOR_TYPES.includes(data.vendorType)) {
    const err = new Error(`Invalid vendor_type. Must be one of: ${VALID_VENDOR_TYPES.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    // 1. The signed-in user and their organisation, from platform.users.
    //    (The old code "ensured" a public.users row here at request time;
    //    platform.users is the one identity table now — V20260909.14.)
    const user = await userRepo.findUserById(userId);
    if (!user) {
      const err = new Error("Authenticated user not found");
      err.statusCode = 401;
      throw err;
    }

    // 2. Duplicate protection (scoped to user)
    const existing = await vendorRepo.findVendorByName(cleanName, userId, client);
    if (existing) {
      const err = new Error(`Vendor with name '${cleanName}' already exists.`);
      err.statusCode = 409;
      throw err;
    }

    // 3. Insert vendor
    return vendorRepo.insertVendor(client, {
      ...data,
      name: cleanName,
      createdBy: user.id,
      status: "PENDING", // Force initial status
    });
  });
}

async function listVendors(userId, filters) {
  return vendorRepo.listVendors(userId, filters);
}

async function getVendorById(vendorId, userId, client) {
  const vendor = await vendorRepo.getVendorById(vendorId, userId, client);
  if (!vendor) {
    const err = new Error("Vendor not found");
    err.statusCode = 404;
    throw err;
  }
  return vendor;
}

async function updateVendor(vendorId, userId, data) {
  // Prevent arbitrary status overrides
  delete data.status;

  if (data.vendorType && !VALID_VENDOR_TYPES.includes(data.vendorType)) {
    const err = new Error(`Invalid vendor_type. Must be one of: ${VALID_VENDOR_TYPES.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    // Check existence
    await getVendorById(vendorId, userId, client);

    // If renaming, check for duplicates
    if (data.name) {
      const existing = await vendorRepo.findVendorByName(data.name, userId, client);
      if (existing && existing.id !== vendorId) {
        const err = new Error(`Vendor with name '${data.name}' already exists.`);
        err.statusCode = 409;
        throw err;
      }
    }

    const updated = await vendorRepo.updateVendor(client, vendorId, userId, data);
    return updated;
  });
}

// -----------------------------------------------------------------------------
// Lifecycle Methods
// -----------------------------------------------------------------------------
async function approveVendor(vendorId, userId) {
  return withTransaction(async (client) => {
    const vendor = await getVendorById(vendorId, userId, client);

    if (vendor.status === "ACTIVE") {
      // Idempotent: already active
      return vendor;
    }

    if (vendor.status !== "PENDING" && vendor.status !== "INACTIVE") {
      const err = new Error(`Cannot approve vendor in status: ${vendor.status}`);
      err.statusCode = 409;
      throw err;
    }

    return vendorRepo.updateVendorStatus(client, vendorId, userId, "ACTIVE");
  });
}

async function rejectVendor(vendorId, userId) {
  return withTransaction(async (client) => {
    const vendor = await getVendorById(vendorId, userId, client);

    if (vendor.status === "REJECTED") {
      return vendor;
    }

    if (vendor.status !== "PENDING") {
      const err = new Error(`Cannot reject vendor in status: ${vendor.status}`);
      err.statusCode = 409;
      throw err;
    }

    return vendorRepo.updateVendorStatus(client, vendorId, userId, "REJECTED");
  });
}

async function deactivateVendor(vendorId, userId) {
  return withTransaction(async (client) => {
    const vendor = await getVendorById(vendorId, userId, client);

    if (vendor.status === "INACTIVE") {
      return vendor;
    }

    if (vendor.status !== "ACTIVE") {
      const err = new Error(`Cannot deactivate vendor in status: ${vendor.status}`);
      err.statusCode = 409;
      throw err;
    }

    return vendorRepo.updateVendorStatus(client, vendorId, userId, "INACTIVE");
  });
}

async function reactivateVendor(vendorId, userId) {
  return withTransaction(async (client) => {
    const vendor = await getVendorById(vendorId, userId, client);

    if (vendor.status === "ACTIVE") {
      return vendor;
    }

    if (vendor.status !== "INACTIVE") {
      const err = new Error(`Cannot reactivate vendor in status: ${vendor.status}`);
      err.statusCode = 409;
      throw err;
    }

    return vendorRepo.updateVendorStatus(client, vendorId, userId, "ACTIVE");
  });
}

module.exports = {
  createVendor,
  listVendors,
  getVendorById,
  updateVendor,
  approveVendor,
  rejectVendor,
  deactivateVendor,
  reactivateVendor,
};
