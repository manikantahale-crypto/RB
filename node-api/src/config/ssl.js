/**
 * Whether to ask for SSL, decided from where we are connecting.
 *
 * Supabase requires it. A Postgres in a container on this machine cannot offer
 * it at all, and asking fails outright with "The server does not support SSL
 * connections" — which is what stopped the stack running against a local
 * database.
 *
 * The same rule as sslFor() in packages/authoring, restated because node-api is
 * CommonJS and cannot import the ESM package. If you change one, change both.
 */
function sslFor(connectionString) {
  let host = "";
  try {
    const u = new URL(connectionString);
    if (u.searchParams.get("sslmode") === "disable") return false;
    host = u.hostname;
  } catch {
    return { rejectUnauthorized: false };
  }
  const local =
    host === "localhost" || host === "127.0.0.1" || host === "::1" ||
    host === "[::1]" || host === "host.docker.internal";
  return local ? false : { rejectUnauthorized: false };
}

module.exports = { sslFor };
