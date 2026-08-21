const log = require("../utils/logger");

module.exports = (err, req, res, next) => {
  log.error(`${req.method} ${req.path} - ${err.message}`);
  res.status(err.statusCode || 500).json({
    error: err.message || "Internal Server Error",
  });
};