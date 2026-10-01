const express = require("express");
const errorHandler = require("./middleware/errorHandler");
const log = require("./utils/logger");

const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Allow any localhost / 127.0.0.1 port (Vite often bumps 3000 → 3001).
  const isLocalDev =
    origin &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const configuredOrigins = (process.env.FRONTEND_URL || process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const isVercel = origin && /^https:\/\/[a-zA-Z0-9_.-]+\.vercel\.app$/.test(origin);
  const isAllowed = isLocalDev || (origin && configuredOrigins.includes(origin)) || isVercel;

  if (isAllowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ||
      "Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Request-Id, X-Correlation-Id"
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "X-Request-Id, X-Correlation-Id"
  );
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use((req, res, next) => {
  const incomingId = req.headers["x-request-id"] || req.headers["x-correlation-id"];
  const requestId =
    typeof incomingId === "string" && incomingId.trim()
      ? incomingId.trim()
      : `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  req.id = requestId;
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const start = Date.now();
  if (log.isDebugEnabled()) {
    log.debug(`[request=${requestId}] → ${req.method} ${req.originalUrl}`, {
      origin: req.headers.origin || null,
      contentType: req.headers["content-type"] || null,
    });
  } else {
    log.info(`→ ${req.method} ${req.originalUrl}`, {
      origin: req.headers.origin || null,
      contentType: req.headers["content-type"] || null,
    });
  }

  res.on("finish", () => {
    const elapsed = Date.now() - start;
    if (log.isDebugEnabled()) {
      log.debug(
        `[request=${requestId}] ← ${req.method} ${req.originalUrl} status=${res.statusCode} ms=${elapsed}`
      );
    } else {
      log.info(`← ${req.method} ${req.originalUrl}`, {
        status: res.statusCode,
        ms: elapsed,
      });
    }
  });
  next();
});

/** RELAY (Smart Inbox): mounted behind a startup gate. */
let relayRouter = null;

function isRelayPath(path) {
  if (!path) return false;
  const p = path.split("?")[0];
  return (
    p === "/relay-health" ||
    p === "/threads" ||
    p.startsWith("/threads/") ||
    p === "/followups" ||
    p.startsWith("/followups/") ||
    p === "/webhooks" ||
    p.startsWith("/webhooks/") ||
    p === "/fetch-now" ||
    p === "/reclassify-inbox" ||
    p === "/test-sla" ||
    p === "/test-consent-timeout" ||
    p === "/test-consent-reminders" ||
    p.startsWith("/internal/shortlist/") ||
    p.startsWith("/internal/consent/") ||
    p.startsWith("/internal/profile/") ||
    p === "/internal/vendors/cache-clear" ||
    p === "/internal/interview/send"
  );
}

app.use((req, res, next) => {
  if (relayRouter) {
    return relayRouter(req, res, next);
  }
  if (isRelayPath(req.path)) {
    return res.status(503).json({ error: "relay starting" });
  }
  return next();
});

function loadRelayRoutes() {
  if (!relayRouter) {
    relayRouter = require("./modules/relay/routes/relay.routes");
  }
  return relayRouter;
}

app.loadRelayRoutes = loadRelayRoutes;

app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

/*
 * `/dump-schema` was here: every column of every table in `public` and
 * `syntra`, to anyone who could reach the port, with no token. Removed
 * 2026-09-22 — nothing in the repository called it, and `\d` does the same
 * job for whoever has a right to ask.
 */

const { requireAuth } = require("./middleware/auth");

app.use("/auth", require("./routes/auth.routes"));
/*
 * The orchestrator's door into each module. No session, organisation from the
 * payload, full authority over that module's data — so it is gated on a shared
 * secret rather than on nothing. See middleware/internalSecret.js; with
 * INTERNAL_API_SECRET unset the gate passes everything and says so at boot.
 */
const { requireInternalSecret } = require("./middleware/internalSecret");
app.use("/internal", requireInternalSecret);
app.use(require("./modules/syntra/routes/internal.syntra.routes"));
app.use(require("./modules/orbit/routes/internal.orbit.routes"));
app.use(require("./modules/astra/routes/internal.astra.routes"));
app.use(require("./modules/prism/routes/internal.prism.routes"));
app.use("/api/astra", require("./modules/astra/routes/astra.routes"));
app.use("/astra", require("./modules/astra/routes/astra.routes"));
app.use("/api/job-boards", require("./modules/astra/routes/jobBoards.routes"));
app.use("/jobs", requireAuth, require("./routes/job.routes"));
app.use("/resumes", requireAuth, require("./routes/resume.routes"));
app.use("/candidates", requireAuth, require("./routes/candidate.routes"));
app.use("/placements", requireAuth, require("./modules/orbit/routes/placement.routes"));
app.use("/vendors", requireAuth, require("./modules/prism/routes/vendor.routes"));
app.use("/submissions", requireAuth, require("./modules/prism/routes/prism.routes"));
app.use("/skills", requireAuth, require("./routes/skill.routes"));
app.use("/stats", requireAuth, require("./routes/stats.routes"));
app.use("/dashboard", requireAuth, require("./routes/dashboard.routes"));
app.use(requireAuth, require("./modules/syntra/routes/matchActions.routes"));
app.use(requireAuth, require("./routes/matches.routes"));
app.use(requireAuth, require("./modules/syntra/routes/score.routes"));
app.use(requireAuth, require("./routes/ai.routes"));
app.use(requireAuth, require("./modules/syntra/routes/recruiterReview.routes"));
app.use("/orchestration", requireAuth, require("./routes/orchestrationActivity.routes"));

app.use(errorHandler);

module.exports = app;
module.exports.loadRelayRoutes = loadRelayRoutes;
