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

/** Shared local-dev pool defaults — keep total connections under Supabase session cap. */
export function devPoolOpts(connectionString: string, max = 1) {
  return {
    connectionString,
    ssl: sslFor(connectionString),
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 20_000,
  };
}
