/**
 * THE INTERNAL ENDPOINTS ARE NOT PUBLIC, AND NOW THEY SAY SO.
 *
 * `/internal/*` is how the orchestrator's nodes reach a module: no session,
 * organisation from the payload, full authority over the module's own data.
 * They were mounted before `requireAuth` and checked nothing, so anyone who
 * could reach :4000 could merge two candidates, post a consent decision on
 * somebody's behalf, retry a run, or open a submission. The design intent was
 * "internal network only"; nothing said so and nothing enforced it.
 *
 * The check is a shared secret in `x-internal-secret`, compared in constant
 * time. A secret is the right weight here: both sides are ours, they are
 * deployed together, and mTLS between two processes on one host buys nothing a
 * secret does not.
 *
 * OFF UNTIL CONFIGURED, ON PURPOSE. With `INTERNAL_API_SECRET` unset the check
 * passes everything and says so once at boot. That is what lets this land
 * without a flag day across node-api, RELAY, the worker and every script; set
 * the variable everywhere and the door closes. It is announced loudly enough
 * that "we forgot" is not a story anyone can tell.
 */
const crypto = require("crypto");

/** Constant-time compare that does not leak the length either. */
function sameSecret(a, b) {
  const ah = crypto.createHash("sha256").update(String(a)).digest();
  const bh = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function configuredSecret() {
  const raw = process.env.INTERNAL_API_SECRET;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** Say once, at boot, which of the two worlds this process is in. */
function announceInternalSecret(log) {
  const say = log && typeof log.warn === "function" ? log : console;
  if (configuredSecret()) {
    (say.info || say.log).call(say, "[internal] /internal/* requires x-internal-secret");
  } else {
    say.warn(
      "[internal] INTERNAL_API_SECRET is not set — /internal/* is open to anyone " +
        "who can reach this port. Set it here and in the worker, RELAY and the " +
        "admin API to close it.",
    );
  }
}

function requireInternalSecret(req, res, next) {
  const expected = configuredSecret();
  if (!expected) return next();

  const provided = req.headers["x-internal-secret"];
  if (typeof provided !== "string" || !provided || !sameSecret(provided, expected)) {
    // No detail: a caller who cannot present the secret learns nothing from
    // the difference between "missing" and "wrong".
    return res.status(401).json({
      error: "internal_unauthorized",
      message: "This endpoint is for platform services.",
    });
  }
  return next();
}

module.exports = { requireInternalSecret, announceInternalSecret, configuredSecret };
