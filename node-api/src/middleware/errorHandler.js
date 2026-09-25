const log = require("../utils/logger");

module.exports = (err, req, res, next) => {
  const requestId = req?.id || req?.requestId || "unknown";
  const statusCode = err.statusCode || err.status || 500;
  const isDebug = log.isDebugEnabled();

  // Structured server-side logging with request ID and error details
  if (isDebug) {
    log.error(
      `[request=${requestId}] ${req.method} ${req.originalUrl || req.path} - ${err.name || "Error"}: ${err.message}`,
      {
        statusCode,
        stack: err.stack,
        requestId,
      }
    );
  } else {
    log.error(`[request=${requestId}] ${req.method} ${req.path} - ${err.message}`);
  }

  // Safe structured response for client (never leak stack trace in production)
  res.status(statusCode).json({
    error: err.message || "Internal Server Error",
    message: err.message || "Internal Server Error",
    requestId,
    ...(err.code ? { code: err.code } : {}),
    ...(err.details ? { details: err.details } : {}),
  });
};
