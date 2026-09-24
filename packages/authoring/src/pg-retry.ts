/** Supabase session pooler (~15 slots project-wide) — retry when saturated at startup. */
export function isPgPoolExhausted(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("EMAXCONN") ||
    msg.includes("max clients reached") ||
    msg.includes("too many clients")
  );
}

export async function withPgRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 10,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isPgPoolExhausted(err) || i >= attempts - 1) throw err;
      const waitMs = 2000 * (i + 1);
      console.warn(
        `[${label}] DB pool busy (attempt ${i + 1}/${attempts}) — retry in ${waitMs / 1000}s…`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

/**
 * Whether to ask for SSL, decided from where we are connecting.
 *
 * Supabase requires it. A Postgres running in a container on this machine
 * cannot offer it at all, and asking fails the connection outright with
 * "The server does not support SSL connections" — which is what stopped the
 * whole stack from running against a local database.
 *
 * So it is a property of the host, not a constant. Anything that is not
 * plainly this machine gets SSL, because the failure modes are not symmetric:
 * connecting to a remote database without TLS is a real problem, and
 * connecting to one on loopback with it is merely impossible.
 *
 * `sslmode=disable` in the URL wins either way, for the case this does not
 * anticipate.
 */
export function sslFor(connectionString: string): { rejectUnauthorized: false } | false {
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

export type CanonicalPoolRole = "api" | "worker" | "ingress" | "admin-api" | "script";

export interface CanonicalPoolOverrides {
  max?: number;
  min?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  maxUses?: number;
  applicationName?: string;
  searchPath?: string[];
}

/**
 * Centralized, configurable database pool configuration.
 * Respects DB_POOL_MAX, DB_POOL_MIN, DB_IDLE_TIMEOUT_MS, DB_CONNECTION_TIMEOUT_MS,
 * DB_SSL, and DB_APPLICATION_NAME with role-specific defaults.
 */
export function canonicalPoolOpts(
  connectionString: string,
  role: CanonicalPoolRole = "script",
  overrides: CanonicalPoolOverrides = {},
) {
  const connStr = connectionString || process.env.DATABASE_URL || "";

  let ssl: { rejectUnauthorized: false } | false;
  const envSsl = (process.env.DB_SSL || "").toLowerCase();
  if (envSsl === "false" || envSsl === "disable" || envSsl === "off") {
    ssl = false;
  } else if (envSsl === "true" || envSsl === "require") {
    ssl = { rejectUnauthorized: false };
  } else {
    ssl = sslFor(connStr);
  }

  const defaultMaxForRole: Record<CanonicalPoolRole, number> = {
    worker: 1,
    "admin-api": 1,
    ingress: 2,
    api: 2,
    script: 1,
  };

  const envMax = process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : undefined;
  const max = Math.max(
    1,
    overrides.max ?? envMax ?? defaultMaxForRole[role] ?? 1,
  );

  const envMin = process.env.DB_POOL_MIN ? parseInt(process.env.DB_POOL_MIN, 10) : 0;
  const min = Math.max(0, overrides.min ?? envMin);

  const idleTimeoutMillis =
    overrides.idleTimeoutMillis ??
    (process.env.DB_IDLE_TIMEOUT_MS ? parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10) : 10_000);

  const connectionTimeoutMillis =
    overrides.connectionTimeoutMillis ??
    (process.env.DB_CONNECTION_TIMEOUT_MS
      ? parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10)
      : 20_000);

  const applicationName =
    overrides.applicationName ||
    process.env.DB_APPLICATION_NAME ||
    `tekisho-${role}`;

  return {
    connectionString: connStr,
    ssl,
    max,
    min,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    application_name: applicationName,
    ...(overrides.searchPath ? { searchPath: overrides.searchPath } : {}),
    ...(overrides.maxUses ? { maxUses: overrides.maxUses } : {}),
  };
}

/** Shared local-dev pool defaults — delegates to canonicalPoolOpts. */
export function devPoolOpts(connectionString: string, max = 1) {
  return canonicalPoolOpts(connectionString, "script", { max });
}

