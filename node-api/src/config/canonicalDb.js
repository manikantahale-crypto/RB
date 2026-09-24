/**
 * Centralized Canonical Database Configuration for node-api.
 *
 * Provides consistent SSL resolution, pool sizing, timeouts, and application names
 * across development and deployment environments.
 *
 * Corresponds to canonicalPoolOpts in @tekisho/authoring for CommonJS runtime.
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
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host === "host.docker.internal";
  return local ? false : { rejectUnauthorized: false };
}

function resolveSsl(connectionString) {
  const envSsl = (process.env.DB_SSL || "").toLowerCase();
  if (envSsl === "false" || envSsl === "disable" || envSsl === "off") {
    return false;
  }
  if (envSsl === "true" || envSsl === "require") {
    return { rejectUnauthorized: false };
  }
  return sslFor(connectionString);
}

function canonicalPoolOpts(connectionString, role = "node-api", overrides = {}) {
  const connStr = connectionString || process.env.DATABASE_URL || "";

  const ssl = resolveSsl(connStr);

  const defaultMaxForRole = {
    "node-api": 2,
    api: 2,
    worker: 1,
    ingress: 2,
    "admin-api": 1,
    script: 1,
  };

  const envMax = process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : undefined;
  const max = Math.max(
    1,
    overrides.max ?? envMax ?? defaultMaxForRole[role] ?? 2,
  );

  const envMin = process.env.DB_POOL_MIN ? parseInt(process.env.DB_POOL_MIN, 10) : 0;
  const min = Math.max(0, overrides.min ?? envMin);

  const idleTimeoutMillis =
    overrides.idleTimeoutMillis ??
    (process.env.DB_IDLE_TIMEOUT_MS ? parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10) : 8000);

  const connectionTimeoutMillis =
    overrides.connectionTimeoutMillis ??
    (process.env.DB_CONNECTION_TIMEOUT_MS
      ? parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10)
      : 15000);

  const applicationName =
    overrides.applicationName ||
    process.env.DB_APPLICATION_NAME ||
    role;

  return {
    connectionString: connStr,
    ssl,
    max,
    min,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    application_name: applicationName,
    ...(overrides.searchPath ? { searchPath: overrides.searchPath } : {}),
    ...(overrides.maxUses ? { maxUses: overrides.maxUses } : {}),
  };
}

module.exports = {
  sslFor,
  resolveSsl,
  canonicalPoolOpts,
};
