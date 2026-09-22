/**
 * The gate on `/internal/*`.
 *
 * These endpoints merge candidates, post consent decisions and open
 * submissions with no session, so "open to anyone who can reach the port" was
 * the single widest hole in the system. The two states below are both
 * deliberate: unset means open and noisy, set means closed.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

// node-api is CommonJS; vitest is ESM. Same bridge as matching.test.mjs.
const require = createRequire(import.meta.url);
const { requireInternalSecret, configuredSecret } = require("./internalSecret.js");

function call(headers, env) {
  const previous = process.env.INTERNAL_API_SECRET;
  if (env === undefined) delete process.env.INTERNAL_API_SECRET;
  else process.env.INTERNAL_API_SECRET = env;

  const result = { status: null, body: null, passed: false };
  const res = {
    status(code) {
      result.status = code;
      return res;
    },
    json(body) {
      result.body = body;
      return res;
    },
  };
  requireInternalSecret({ headers }, res, () => {
    result.passed = true;
  });

  if (previous === undefined) delete process.env.INTERNAL_API_SECRET;
  else process.env.INTERNAL_API_SECRET = previous;
  return result;
}

describe("requireInternalSecret — with a secret configured", () => {
  it("lets the right secret through", () => {
    expect(call({ "x-internal-secret": "s3cret" }, "s3cret").passed).toBe(true);
  });

  it("refuses a wrong one, and says nothing useful about why", () => {
    const r = call({ "x-internal-secret": "guess" }, "s3cret");
    expect(r.passed).toBe(false);
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("internal_unauthorized");
    expect(JSON.stringify(r.body)).not.toContain("s3cret");
  });

  it("refuses a missing one", () => {
    const r = call({}, "s3cret");
    expect(r.passed).toBe(false);
    expect(r.status).toBe(401);
  });

  it("refuses a header that is not a string", () => {
    expect(call({ "x-internal-secret": ["s3cret"] }, "s3cret").passed).toBe(false);
  });

  it("compares the whole secret, not a prefix", () => {
    expect(call({ "x-internal-secret": "s3cr" }, "s3cret").passed).toBe(false);
    expect(call({ "x-internal-secret": "s3cretXX" }, "s3cret").passed).toBe(false);
  });
});

describe("requireInternalSecret — with none configured", () => {
  it("passes everything, which is the documented starting state", () => {
    expect(call({}, undefined).passed).toBe(true);
    expect(call({ "x-internal-secret": "anything" }, undefined).passed).toBe(true);
  });

  it("treats blank as unset rather than as a secret nobody can send", () => {
    expect(call({}, "   ").passed).toBe(true);
    expect(configuredSecret()).toBe(null);
  });
});
