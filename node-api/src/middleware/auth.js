const jwt = require("jsonwebtoken");
const env = require("../config/env");

/**
 * Require Authorization: Bearer <token>.
 * Sets req.user ({ userId, email, role }) and req.userId from JWT payload.
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
    };
    req.userId = payload.userId;

    return next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Unauthorized: Token expired" });
    }
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
}

module.exports = { requireAuth };
