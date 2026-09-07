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
  if (isLocalDev) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  log.info(`→ ${req.method} ${req.originalUrl}`, {
    origin: req.headers.origin || null,
    contentType: req.headers["content-type"] || null,
  });
  res.on("finish", () => {
    log.info(`← ${req.method} ${req.originalUrl}`, {
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });
  next();
});

app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/dump-schema", async (req, res) => {
  const { pool } = require("./config/db");
  try {
    const { rows } = await pool.query(`SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE table_schema IN ('public', 'syntra') ORDER BY table_schema, table_name, ordinal_position;`);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const { requireAuth } = require("./middleware/auth");

app.use("/auth", require("./routes/auth.routes"));
app.use(require("./modules/syntra/routes/internal.syntra.routes"));
app.use(require("./routes/internal.orbit.routes"));
app.use(require("./routes/internal.astra.routes"));
app.use("/api/astra", require("./routes/astra.routes"));
app.use("/astra", require("./routes/astra.routes"));
app.use("/api/job-boards", require("./routes/jobBoards.routes"));
app.use("/jobs", requireAuth, require("./routes/job.routes"));
app.use("/resumes", requireAuth, require("./routes/resume.routes"));
app.use("/candidates", requireAuth, require("./routes/candidate.routes"));
app.use("/placements", requireAuth, require("./routes/placement.routes"));
app.use("/skills", requireAuth, require("./routes/skill.routes"));
app.use("/stats", requireAuth, require("./routes/stats.routes"));
app.use("/dashboard", requireAuth, require("./routes/dashboard.routes"));
app.use(requireAuth, require("./routes/matches.routes"));
app.use(requireAuth, require("./routes/ai.routes"));
app.use(requireAuth, require("./modules/syntra/routes/recruiterReview.routes"));
app.use("/orchestration", requireAuth, require("./routes/orchestrationActivity.routes"));

app.use(errorHandler);

module.exports = app;
