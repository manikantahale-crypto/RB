/**
 * Who the authoring tool thinks is calling.
 *
 * The case that matters most is the last one: two signed-in people are two
 * different uuids, which is what `isSamePerson` compares. With the old
 * constant `admin-local` on both sides it always matched, and every go-live
 * approval raised through the UI was refused as `same_person`.
 */
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { AdminAuthError, anonymousAllowed, identify } from "./admin-identity.js";
import { isSamePerson } from "./authoring-writes.js";

const SECRET = "test-secret-not-a-real-one";
const ENV = { AUTH_JWT_SECRET: SECRET } as NodeJS.ProcessEnv;
const ANON = { AUTH_JWT_SECRET: SECRET, ADMIN_ALLOW_ANONYMOUS: "1" } as NodeJS.ProcessEnv;
const ALICE = "22222222-2222-2222-2222-222222222222";
const BOB = "33333333-3333-3333-3333-333333333333";

function token(payload: Record<string, unknown>, secret = SECRET, opts: jwt.SignOptions = {}) {
  return jwt.sign(payload, secret, { expiresIn: "1h", ...opts });
}

describe("identify — a signed-in caller", () => {
  it("is the user id the token carries, with the organisation it acts for", () => {
    const who = identify(
      { authorization: `Bearer ${token({ userId: ALICE, email: "a@x.test", orgId: "org-1" })}` },
      ENV,
    );
    expect(who).toEqual({ id: ALICE, email: "a@x.test", orgId: "org-1", source: "token" });
  });

  it("is read from either spelling of the header", () => {
    const t = `Bearer ${token({ userId: ALICE })}`;
    expect(identify({ Authorization: t }, ENV).id).toBe(ALICE);
    expect(identify({ authorization: t }, ENV).id).toBe(ALICE);
  });
});

describe("identify — a caller who cannot be believed", () => {
  it("refuses a token signed with another secret", () => {
    const t = `Bearer ${token({ userId: ALICE }, "someone-elses-secret")}`;
    expect(() => identify({ authorization: t }, ENV)).toThrow(AdminAuthError);
  });

  it("refuses a token that names its own algorithm", () => {
    // `alg: none` with no signature — the classic forgery. Verification is
    // pinned to HS256, so it never reaches the payload.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ userId: ALICE })).toString("base64url");
    expect(() => identify({ authorization: `Bearer ${header}.${body}.` }, ENV)).toThrow(
      /not valid here/,
    );
  });

  it("says so when the sign-in has expired", () => {
    const t = `Bearer ${token({ userId: ALICE }, SECRET, { expiresIn: -10 })}`;
    expect(() => identify({ authorization: t }, ENV)).toThrow(/expired/i);
  });

  it("refuses a token with no user id", () => {
    expect(() => identify({ authorization: `Bearer ${token({ email: "a@x.test" })}` }, ENV)).toThrow(
      /no user id/,
    );
  });

  it("refuses a header that is not Bearer", () => {
    expect(() => identify({ authorization: "Basic abc123" }, ENV)).toThrow(/Bearer/);
  });

  it("refuses a bad token even when anonymous access is allowed", () => {
    // Someone tried to say who they were and failed. Falling back to
    // anonymous would quietly downgrade a signed-in session.
    const t = `Bearer ${token({ userId: ALICE }, "someone-elses-secret")}`;
    expect(() => identify({ authorization: t }, ANON)).toThrow(AdminAuthError);
  });

  it("cannot check anything without a configured secret", () => {
    const t = `Bearer ${token({ userId: ALICE })}`;
    expect(() => identify({ authorization: t }, {} as NodeJS.ProcessEnv)).toThrow(
      /AUTH_JWT_SECRET/,
    );
  });
});

describe("identify — no token at all", () => {
  it("is refused by default", () => {
    expect(() => identify({}, ENV)).toThrow(/Sign in/);
  });

  it("falls back to the old header only when explicitly allowed", () => {
    expect(identify({}, ANON)).toEqual({
      id: "admin-local",
      email: null,
      orgId: null,
      source: "anonymous",
    });
    expect(identify({ "x-admin-id": "someone" }, ANON).id).toBe("someone");
  });

  it("reads the opt-in the way the rest of the repo reads flags", () => {
    for (const on of ["1", "true", "YES"]) {
      expect(anonymousAllowed({ ADMIN_ALLOW_ANONYMOUS: on } as NodeJS.ProcessEnv)).toBe(true);
    }
    for (const off of ["0", "false", "", "no"]) {
      expect(anonymousAllowed({ ADMIN_ALLOW_ANONYMOUS: off } as NodeJS.ProcessEnv)).toBe(false);
    }
    expect(anonymousAllowed({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("the two-person rule, which this exists to unblock", () => {
  it("lets two signed-in people approve each other's work", () => {
    const alice = identify({ authorization: `Bearer ${token({ userId: ALICE })}` }, ENV);
    const bob = identify({ authorization: `Bearer ${token({ userId: BOB })}` }, ENV);
    expect(isSamePerson(bob.id, alice.id)).toBe(false);
  });

  it("still stops one person approving their own", () => {
    const first = identify({ authorization: `Bearer ${token({ userId: ALICE })}` }, ENV);
    const again = identify({ authorization: `Bearer ${token({ userId: ALICE })}` }, ENV);
    expect(isSamePerson(again.id, first.id)).toBe(true);
  });

  it("is why anonymous mode cannot approve either — one label, both sides", () => {
    const asker = identify({}, ANON);
    const approver = identify({}, ANON);
    expect(isSamePerson(approver.id, asker.id)).toBe(true);
  });
});
