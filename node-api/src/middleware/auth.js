const jwt = require("jsonwebtoken");
const env = require("../config/env");
const log = require("../utils/logger");

/**
 * Require Authorization: Bearer <token>.
 * Sets req.user ({ userId, email, role, orgId }), req.userId and req.orgId
 * from the JWT payload.
 *
 * `orgId` is absent from tokens issued before 2026-09-09 and those stay valid
 * for seven days. Callers therefore treat it as optional: a null reaches the
 * insert, and the database trigger derives the organisation from created_by as
 * it did before. Nothing breaks while the old tokens age out.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const hasAuth = Boolean(authHeader);
  const authType = authHeader ? authHeader.split(" ")[0] : "None";
  const cookieHeader = req.headers.cookie || "";
  const hasCookie = Boolean(cookieHeader);
  const requestId = req.id || req.requestId || req.headers["x-request-id"] || "none";
  const route = req.originalUrl || req.url;

  if (log.isDebugEnabled()) {
    log.debug(
      `[AUTH DEBUG] [request=${requestId}] route=${route} authorizationPresent=${hasAuth} authType=${authType} cookiePresent=${hasCookie}`
    );
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const reason = !authHeader ? "Missing Authorization header" : "Malformed Authorization header (not Bearer)";
    log.warn(`[AUTH] 401 Unauthorized for ${req.method} ${route}: ${reason} [request=${requestId}]`);
    if (log.isDebugEnabled()) {
      log.debug(
        `[AUTH DEBUG] [request=${requestId}] route=${route} authenticated=false reason="${reason}"`
      );
    }
    return res.status(401).json({ error: "Unauthorized: Missing or malformed token", requestId });
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    const reason = "Empty token after Bearer";
    log.warn(`[AUTH] 401 Unauthorized for ${req.method} ${route}: ${reason} [request=${requestId}]`);
    if (log.isDebugEnabled()) {
      log.debug(
        `[AUTH DEBUG] [request=${requestId}] route=${route} authenticated=false reason="${reason}"`
      );
    }
    return res.status(401).json({ error: "Unauthorized: Missing token", requestId });
  }

  try {
    const payload = jwt.verify(token, env.AUTH_JWT_SECRET);
    if (!payload || !payload.userId) {
      const reason = "Invalid token payload: missing userId";
      log.warn(`[AUTH] 401 Unauthorized for ${req.method} ${route}: ${reason} [request=${requestId}]`);
      if (log.isDebugEnabled()) {
        log.debug(
          `[AUTH DEBUG] [request=${requestId}] route=${route} authenticated=false reason="${reason}"`
        );
      }
      return res.status(401).json({ error: "Unauthorized: Invalid token payload", requestId });
    }

    req.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role || null,
      orgId: payload.orgId || null,
    };
    req.userId = payload.userId;
    req.orgId = payload.orgId || null;

    if (log.isDebugEnabled()) {
      log.debug(
        `[AUTH DEBUG] [request=${requestId}] route=${route} authenticated=true userIdPresent=true userId=${payload.userId}`
      );
    }

    return next();
  } catch (err) {
    const reason = err.name === "TokenExpiredError" ? "Token expired" : `Invalid token (${err.message})`;
    log.warn(`[AUTH] 401 Unauthorized for ${req.method} ${route}: ${reason} [request=${requestId}]`);
    if (log.isDebugEnabled()) {
      log.debug(
        `[AUTH DEBUG] [request=${requestId}] route=${route} authenticated=false reason="${reason}"`
      );
    }
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Unauthorized: Token expired", requestId });
    }
    return res.status(401).json({ error: "Unauthorized: Invalid token", requestId });
  }
}

module.exports = { requireAuth };
