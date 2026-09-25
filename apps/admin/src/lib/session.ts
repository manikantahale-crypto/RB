/**
 * WHO IS SIGNED IN TO THE AUTHORING TOOL.
 *
 * The tool used to send the constant `x-admin-id: admin-local`, so admin-api
 * could not tell two people apart — which meant nobody could approve anybody's
 * go-live request, because the two-person rule saw the same identity on both
 * sides (`lib/admin-identity.ts` in admin-api says the rest).
 *
 * There is no separate account system for the tool: it signs in against the
 * same node-api the recruiters use, and admin-api verifies that token with the
 * same secret. One person, one account, one audit trail.
 *
 * The token sits in localStorage, which is where node-api's own UI keeps it.
 * That is the same exposure the recruiter app already has, not a new one; a
 * cookie with SameSite would be better for both and is a change to make in one
 * place, later.
 */
const TOKEN_KEY = "tekisho.admin.token";
const WHO_KEY = "tekisho.admin.who";

const SYNTRA_API =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  (import.meta.env.VITE_SYNTRA_API_URL as string | undefined) ||
  (import.meta.env.VITE_API_URL as string | undefined) ||
  (import.meta.env.DEV ? "http://localhost:4000" : "");

export type Session = { email: string; token: string };

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private windows and blocked site data both throw here. A tool that
    // cannot remember the sign-in still works; it just asks again.
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* see read() */
  }
}

export function currentSession(): Session | null {
  const token = read(TOKEN_KEY);
  const email = read(WHO_KEY);
  return token && email ? { email, token } : null;
}

export function authHeader(): Record<string, string> {
  const token = read(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function signOut(): void {
  write(TOKEN_KEY, null);
  write(WHO_KEY, null);
}

/**
 * Sign in against node-api and keep the token. Returns a message to show,
 * never throws: a sign-in box that explodes tells the person nothing.
 */
export async function signIn(
  email: string,
  password: string,
): Promise<{ ok: true; session: Session } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetch(`${SYNTRA_API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
  } catch {
    return {
      ok: false,
      message: `Cannot reach node-api on ${SYNTRA_API}. Start it with: npm run dev:syntra`,
    };
  }

  const body = (await res.json().catch(() => ({}))) as {
    token?: string;
    user?: { email?: string };
    error?: string;
    message?: string;
  };

  if (!res.ok || !body.token) {
    return {
      ok: false,
      message:
        body.message ??
        body.error ??
        (res.status === 401 ? "That email and password do not match." : "Sign-in failed."),
    };
  }

  const who = body.user?.email ?? email.trim();
  write(TOKEN_KEY, body.token);
  write(WHO_KEY, who);
  return { ok: true, session: { email: who, token: body.token } };
}
