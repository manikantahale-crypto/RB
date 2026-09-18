/**
 * RELAY's face on node-api.
 *
 * The Front and the orchestrator talk to :4000 only; this forwards RELAY's
 * paths to the RELAY process. On the old project RELAY ran embedded inside
 * node-api on an ephemeral port that this file waited for at startup
 * (relay/embedRelay.js). Here RELAY is its own process on a fixed port
 * (apps/relay, RELAY_PORT 3005) and this simply forwards to RELAY_API_URL.
 * When RELAY is not running the caller gets a 502 that says so — no waiting,
 * no "starting" state.
 *
 * Ported from routes/relayProxy.routes.js on 2026-09-18 (ref/RELAY_Onboarding.md
 * stage 4). Everything after the URL lookup is as it was: same mount
 * prefixes, same timeouts, same one retry on the threads list.
 */
const express = require("express");
const log = require("../../../utils/logger");

function relayBaseUrl() {
  return (
    process.env.RELAY_INTERNAL_URL ||
    process.env.RELAY_SERVICE_URL ||
    process.env.RELAY_API_URL ||
    "http://127.0.0.1:3005"
  ).replace(/\/$/, "");
}

/** RELAY-owned paths only — never /internal/astra, /internal/jobs, /internal/orbit, /internal/prism (node-api's own). */
const RELAY_MOUNT_PREFIXES = [
  "/threads",
  "/followups",
  "/webhooks",
  "/fetch-now",
  "/reclassify-inbox",
  "/test-sla",
  "/test-consent-timeout",
  "/internal/consent",
  "/internal/profile",
  "/internal/shortlist",
  "/internal/interview",
  "/internal/vendors",
];

async function relayProxyHandler(req, res) {
  const relayBase = relayBaseUrl();
  const targetUrl = `${relayBase}${req.originalUrl}`;

  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;

  let body;
  if (req.method !== "GET" && req.method !== "HEAD" && req.body !== undefined) {
    body = JSON.stringify(req.body);
    headers["content-type"] = headers["content-type"] || "application/json";
    headers["content-length"] = Buffer.byteLength(body);
  }

  try {
    const isMailboxSync = req.path === "/fetch-now" || req.originalUrl.includes("/fetch-now");
    const isThreadsList =
      req.path === "/threads" ||
      req.originalUrl === "/threads" ||
      /^\/threads\/?(\?|$)/.test(req.originalUrl || "");

    const syncTimeoutMs = Math.max(30000, parseInt(process.env.RELAY_FETCH_NOW_TIMEOUT_MS || "180000", 10));
    const threadsTimeoutMs = Math.max(15000, parseInt(process.env.RELAY_THREADS_TIMEOUT_MS || "60000", 10));

    const fetchOpts = {
      method: req.method,
      headers,
      body,
      ...(isMailboxSync
        ? { signal: AbortSignal.timeout(syncTimeoutMs) }
        : isThreadsList
          ? { signal: AbortSignal.timeout(threadsTimeoutMs) }
          : {}),
    };

    let upstream;
    try {
      upstream = await fetch(targetUrl, fetchOpts);
    } catch (firstErr) {
      if (!isThreadsList) throw firstErr;
      await new Promise((r) => setTimeout(r, 400));
      upstream = await fetch(targetUrl, fetchOpts);
    }

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (key === "transfer-encoding") return;
      res.setHeader(key, value);
    });

    const text = await upstream.text();
    if (text) {
      const ct = upstream.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        try {
          return res.json(JSON.parse(text));
        } catch {
          /* fall through */
        }
      }
      return res.send(text);
    }
    return res.end();
  } catch (err) {
    log.warn("Relay proxy failed", { target: targetUrl, error: err.message });
    const timedOut =
      err.name === "TimeoutError" ||
      err.name === "AbortError" ||
      /aborted|timeout/i.test(String(err.message || ""));
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? "relay_timeout" : "relay_unavailable",
      message: timedOut
        ? "Smart Inbox is busy (mailbox sync). Wait a few seconds and refresh."
        : `Smart Inbox (RELAY) is not reachable at ${relayBase}. Start it with: npm run dev -w relay`,
      relayInternal: relayBase,
    });
  }
}

function createRelayProxyRouter() {
  const router = express.Router();
  for (const prefix of RELAY_MOUNT_PREFIXES) {
    router.use(prefix, relayProxyHandler);
  }

  router.get("/relay-health", async (_req, res) => {
    const relayBase = relayBaseUrl();
    try {
      const r = await fetch(`${relayBase}/health`, { signal: AbortSignal.timeout(5000) });
      const data = await r.json();
      return res.json({ proxy: "ok", relay: data, relayInternal: relayBase, publicApi: ":4000" });
    } catch (err) {
      return res.status(502).json({ proxy: "ok", relay: "down", error: err.message, relayInternal: relayBase });
    }
  });

  return router;
}

module.exports = createRelayProxyRouter();
