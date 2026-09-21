const { fetchAndIngest } = require("../services/adapters/jobBoard.adapter");

async function fetchRequirements(req, res, next) {
  try {
    const { source, keyword, location } = req.body;
    if (!source) {
      return res.status(400).json({
        status: "error",
        message: "Missing required parameter: source"
      });
    }

    const userId = req.userId || req.user?.userId || null;

    let result;
    try {
      result = await fetchAndIngest(source, keyword || "React Developer", location || "Dallas", userId, {
        correlationId: req.body.correlation_id || req.body.correlationId || null,
        organizationId: req.body.organization_id || req.body.organizationId || null,
      });
    } catch (apiErr) {
      return res.status(400).json({
        status: "error",
        message: apiErr.message || `${source} is not configured`
      });
    }

    res.json({
      status: "success",
      data: result
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  fetchRequirements
};
