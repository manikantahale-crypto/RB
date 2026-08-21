const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env") });
require("dotenv").config();

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function flag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return raw === "1" || raw.toLowerCase() === "true";
}

module.exports = {
  DATABASE_URL: required("DATABASE_URL"),
  PORT: parseInt(process.env.PORT || "4000", 10),
  UPLOAD_DIR: process.env.UPLOAD_DIR || "./uploads",
  PYTHON_SERVICE_URL: (
    process.env.PYTHON_SERVICE_URL || "http://localhost:8000"
  ).replace(/\/$/, ""),
  /** Minimum Tier-2 skill overlap % to shortlist for LLM scoring (0 = include all ranked) */
  MATCH_SKILL_FLOOR: parseInt(process.env.MATCH_SKILL_FLOOR || "0", 10),
  /** Max candidates/jobs shortlisted per funnel run */
  MATCH_TOP_N: parseInt(process.env.MATCH_TOP_N || "15", 10),
  AUTH_JWT_SECRET:
    process.env.AUTH_JWT_SECRET ||
    (process.env.NODE_ENV === "production"
      ? required("AUTH_JWT_SECRET")
      : "dev-local-jwt-secret-change-in-production"),
  IMAP_HOST: process.env.IMAP_HOST || "imap.gmail.com",
  IMAP_PORT: parseInt(process.env.IMAP_PORT || "993", 10),
  IMAP_USERNAME: process.env.IMAP_USERNAME || "",
  IMAP_PASSWORD: process.env.IMAP_PASSWORD || "",
  IMAP_POLL_INTERVAL_SECONDS: parseInt(process.env.IMAP_POLL_INTERVAL_SECONDS || "120", 10),
  IMAP_POLL_ENABLED: (process.env.IMAP_POLL_ENABLED || "false").toLowerCase() === "true",
  IMAP_TLS_REJECT_UNAUTHORIZED: process.env.IMAP_TLS_REJECT_UNAUTHORIZED !== "false",
  ORCH_ORGANIZATION_ID: process.env.ORCH_ORGANIZATION_ID || "00000000-0000-0000-0000-000000000001",
  /** Write platform events to shared event_outbox (orch worker picks up via relay). */
  PLATFORM_EVENTS_ENABLED: flag("PLATFORM_EVENTS_ENABLED", true),
  /** Throw if event_outbox insert fails (default: log and continue). */
  PLATFORM_EVENTS_STRICT: flag("PLATFORM_EVENTS_STRICT", false),
  /** Emit syntra.jd.received on upload (may parallel ASTRA graph — default off). */
  ORCH_EMIT_JD_RECEIVED: flag("ORCH_EMIT_JD_RECEIVED", false),
  /** Route match scoring through orchestrator graph (skip internal match.requested worker). */
  ORCH_DELEGATE_MATCH: flag("ORCH_DELEGATE_MATCH", true),
  /** Orchestrator HTTP API — used by admin runtime trace; Syntra writes outbox directly. */
  ORCH_API_URL: (process.env.ORCH_API_URL || "http://localhost:4100").replace(/\/$/, ""),
  SYNTRA_API_URL: (process.env.SYNTRA_API_URL || `http://localhost:${process.env.PORT || "4000"}`).replace(/\/$/, ""),
};
