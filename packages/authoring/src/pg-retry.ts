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

/** Shared local-dev pool defaults — keep total connections under Supabase session cap. */
export function devPoolOpts(connectionString: string, max = 1) {
  return {
    connectionString,
    ssl: { rejectUnauthorized: false as const },
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 20_000,
  };
}
