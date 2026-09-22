/**
 * The headers node-api uses when it calls another platform service's
 * `/internal/*` endpoint — today RELAY's, from the PRISM and SYNTRA paths.
 *
 * One place, because the secret is the kind of thing that gets added to four
 * of five call sites. See middleware/internalSecret.js for the other side of
 * the same conversation; with `INTERNAL_API_SECRET` unset this is exactly the
 * header set that was sent before, so nothing changes until it is configured.
 */
function internalHeaders(extra = {}) {
  const secret = (process.env.INTERNAL_API_SECRET || "").trim();
  return {
    "Content-Type": "application/json",
    ...(secret ? { "x-internal-secret": secret } : {}),
    ...extra,
  };
}

module.exports = { internalHeaders };
