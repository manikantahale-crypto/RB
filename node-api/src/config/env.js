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
  PORT: parseInt(process.env.SYNTRA_PORT || (process.env.RENDER ? "4000" : process.env.PORT) || "4000", 10),
  UPLOAD_DIR: process.env.UPLOAD_DIR || "./uploads",
  PYTHON_SERVICE_URL: (
    process.env.PYTHON_SERVICE_URL || "http://localhost:8000"
  ).replace(/\/$/, ""),
  /** Minimum Tier-2 skill overlap % to shortlist for LLM scoring (0 = include all ranked) */
  MATCH_SKILL_FLOOR: parseInt(process.env.MATCH_SKILL_FLOOR || "0", 10),
  /** Max candidates/jobs shortlisted per funnel run */
  MATCH_TOP_N: parseInt(process.env.MATCH_TOP_N || "15", 10),
  /**
   * How many jobs one resume may send back for a funnel re-run.
   *
   * A job built its candidate shortlist when it was processed, so one
   * processed before this resume existed never considered it. Nearly every
   * requirement predates any new resume — 3,416 have finished extraction — so
   * "all of them" is the honest answer and an impossible amount of work. This
   * caps it at the jobs where the answer might actually change: the
   * highest-scoring ones that missed this resume's own shortlist.
   */
  MATCH_RECONCILE_MAX: parseInt(process.env.MATCH_RECONCILE_MAX || "25", 10),
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
  /** Route ORBIT UI actions through orchestrator graphs (module.orbit.bench). */
  ORCH_DELEGATE_ORBIT: flag("ORCH_DELEGATE_ORBIT", true),
  /**
   * Who enriches a requirement: this service's own worker, or the
   * orchestrator's ASTRA workflow (quality -> normalize -> route).
   *
   * BOTH do the same work and both announce `astra.requirement.normalized`,
   * so exactly one of them must run. Decided 2026-09-22: the workflow owns
   * it — an authored graph, a threshold an admin can tune, and a run on the
   * runs screen, instead of behaviour hardcoded in a worker.
   *
   * Default FALSE until that workflow is bound (stage 6). Turning this on
   * before the binding exists means nothing enriches anything, so the flip
   * belongs in the same change that creates the binding.
   */
  ORCH_DELEGATE_ASTRA: flag("ORCH_DELEGATE_ASTRA", false),
  /** Orchestrator HTTP API — used by admin runtime trace; Syntra writes outbox directly. */
  ORCH_API_URL: (process.env.ORCH_API_URL || "http://127.0.0.1:4100").replace(/\/$/, ""),
  SYNTRA_API_URL: (process.env.SYNTRA_API_URL || `http://127.0.0.1:${process.env.SYNTRA_PORT || (process.env.RENDER ? "4000" : process.env.PORT) || "4000"}`).replace(/\/$/, ""),
};
