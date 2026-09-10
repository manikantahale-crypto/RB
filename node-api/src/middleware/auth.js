const jwt = require("jsonwebtoken");
const env = require("../config/env");

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
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing or malformed token" });
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }

  try {
    const payload = jwt.verify(token, env.AUTH_JWT_SECRET);
    if (!payload || !payload.userId) {
      return res.status(401).json({ error: "Unauthorized: Invalid token payload" });
    }

    req.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      orgId: payload.orgId ?? null,
    };
    req.userId = payload.userId;
    req.orgId = payload.orgId ?? null;

    return next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Unauthorized: Token expired" });
    }
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
}

module.exports = { requireAuth };
