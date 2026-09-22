/**
 * WHO IS CALLING THE AUTHORING TOOL.
 *
 * Until 2026-09-22 the answer was the header `x-admin-id`, which the admin UI
 * sent as the constant `admin-local`. Three things followed from that:
 *
 *   1. Anyone who could reach :4200 could edit a workflow and put it live.
 *   2. `requested_by` and `approved_by` on every version said `admin-local`,
 *      so the audit trail named nobody.
 *   3. The two-person rule compares those two values (`isSamePerson`), so it
 *      matched on every approval and REFUSED THEM ALL. A version raised
 *      through the UI could not be approved through the UI at all.
 *
 * The identity is now the one node-api already issues: the same HS256 JWT,
 * the same `AUTH_JWT_SECRET`, and `payload.userId` is a real `platform.users`
 * row — which is exactly what `attribution()` in authoring-writes resolves, so
 * the audit columns fill with uuids and two different people are two different
 * uuids.
 *
 * ANONYMOUS ACCESS IS A DELIBERATE, NOISY OPT-IN. `ADMIN_ALLOW_ANONYMOUS=1`
 * restores the old header behaviour so a local session keeps working while
 * accounts are being made. It is off by default, announced at boot, and the
 * identity it produces is a label, not a user — which means the two-person
 * rule still refuses self-approval, because both sides are that same label.
 */
import jwt from "jsonwebtoken";

export type AdminIdentity = {
  /** What goes in `by` — a `platform.users` uuid when signed in. */
  id: string;
  email: string | null;
  /** The organisation the session is acting for, from the token. */
  orgId: string | null;
  source: "token" | "anonymous";
};

export class AdminAuthError extends Error {
  constructor(
    readonly code:
      | "missing_token"
      | "invalid_token"
      | "expired_token"
      | "misconfigured",
    message: string,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

/** `1`, `true` or `yes` — anything else, including unset, is off. */
export function anonymousAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.ADMIN_ALLOW_ANONYMOUS ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * The identity behind one request, or a typed error saying why there is none.
 *
 * A malformed or expired token is always an error, even when anonymous access
 * is allowed: someone tried to say who they were and failed, and treating that
 * as "anonymous" would silently downgrade a signed-in session.
 */
export function identify(
  headers: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): AdminIdentity {
  const raw = headers["authorization"] ?? headers["Authorization"];
  const header = typeof raw === "string" ? raw.trim() : "";

  if (header) {
    if (!/^Bearer\s+\S/i.test(header)) {
      throw new AdminAuthError(
        "invalid_token",
        "Authorization must be `Bearer <token>`.",
      );
    }
    const secret = (env.AUTH_JWT_SECRET ?? "").trim();
    if (!secret) {
      throw new AdminAuthError(
        "misconfigured",
        "AUTH_JWT_SECRET is not set, so this service cannot check a token.",
      );
    }
    const token = header.replace(/^Bearer\s+/i, "").trim();
    let payload: jwt.JwtPayload;
    try {
      // Pinned to the algorithm node-api signs with. Without this a token
      // could name its own algorithm, which is the classic JWT forgery.
      payload = jwt.verify(token, secret, {
        algorithms: ["HS256"],
      }) as jwt.JwtPayload;
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === "TokenExpiredError") {
        throw new AdminAuthError(
          "expired_token",
          "That sign-in has expired. Sign in again.",
        );
      }
      throw new AdminAuthError("invalid_token", "That token is not valid here.");
    }
    const userId = typeof payload.userId === "string" ? payload.userId : null;
    if (!userId) {
      throw new AdminAuthError(
        "invalid_token",
        "That token carries no user id.",
      );
    }
    return {
      id: userId,
      email: typeof payload.email === "string" ? payload.email : null,
      orgId: typeof payload.orgId === "string" ? payload.orgId : null,
      source: "token",
    };
  }

  if (!anonymousAllowed(env)) {
    throw new AdminAuthError(
      "missing_token",
      "Sign in to use the authoring tool.",
    );
  }

  // The old behaviour, on purpose and only when asked for. A label, never a
  // user: `attribution()` stores it in *_by_label and leaves the uuid null.
  const legacy = headers["x-admin-id"];
  const label = typeof legacy === "string" && legacy.trim() ? legacy.trim() : "admin-local";
  return { id: label, email: null, orgId: null, source: "anonymous" };
}

/** What every route now calls instead of reading `x-admin-id` itself. */
export function adminIdOf(req: { headers: Record<string, unknown> }): string {
  return identify(req.headers).id;
}

/**
 * Register the check once, for every route.
 *
 * `/health` stays open: it is what a process manager polls, and it says
 * nothing a caller could not learn by connecting.
 */
export function registerAdminAuth(app: {
  addHook: (name: "onRequest", fn: (req: any, reply: any) => Promise<void>) => void;
}): void {
  const open = new Set(["/health"]);
  app.addHook("onRequest", async (req, reply) => {
    if (open.has(req.url?.split("?")[0] ?? "")) return;
    try {
      req.admin = identify(req.headers);
    } catch (err) {
      if (err instanceof AdminAuthError) {
        const status = err.code === "misconfigured" ? 500 : 401;
        return reply.code(status).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });
}
