/**
 * Exactly one thing enriches a requirement.
 *
 * node-api's own worker and the orchestrator's ASTRA workflow (quality →
 * normalize → route) do the same work and both announce
 * `astra.requirement.normalized`. If both run, every requirement is parsed
 * twice — two LLM calls — and everything bound to that event starts twice.
 *
 * Decided 2026-09-22 (D-B): the workflow owns it. `ORCH_DELEGATE_ASTRA`
 * chooses, and defaults to FALSE because the workflow is not bound yet —
 * turning it on before the binding exists means nothing enriches anything.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

// node-api is CommonJS; vitest is ESM. Same bridge as matching.test.mjs.
const require = createRequire(import.meta.url);

/** env.js reads process.env once at require time, so each case needs its own. */
function loadEnv(values) {
  const previous = {};
  for (const [k, v] of Object.entries(values)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const path = require.resolve("../../../config/env.js");
  delete require.cache[path];
  const env = require("../../../config/env.js");
  for (const [k, v] of Object.entries(previous)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete require.cache[path];
  return env;
}

describe("ORCH_DELEGATE_ASTRA", () => {
  it("is off unless asked for, because the ASTRA workflow is not bound yet", () => {
    expect(loadEnv({ ORCH_DELEGATE_ASTRA: undefined }).ORCH_DELEGATE_ASTRA).toBe(false);
  });

  it("reads the same way as the other two delegate flags", () => {
    expect(loadEnv({ ORCH_DELEGATE_ASTRA: "1" }).ORCH_DELEGATE_ASTRA).toBe(true);
    expect(loadEnv({ ORCH_DELEGATE_ASTRA: "true" }).ORCH_DELEGATE_ASTRA).toBe(true);
    expect(loadEnv({ ORCH_DELEGATE_ASTRA: "0" }).ORCH_DELEGATE_ASTRA).toBe(false);
    expect(loadEnv({ ORCH_DELEGATE_ASTRA: "" }).ORCH_DELEGATE_ASTRA).toBe(false);
  });

  it("sits beside them rather than inventing a new spelling", () => {
    const env = loadEnv({});
    expect(env).toHaveProperty("ORCH_DELEGATE_MATCH");
    expect(env).toHaveProperty("ORCH_DELEGATE_ORBIT");
    expect(env).toHaveProperty("ORCH_DELEGATE_ASTRA");
  });
});

describe("the worker, when the workflow owns enrichment", () => {
  it("does nothing at all — no requirement is loaded, nothing is announced", async () => {
    const previous = {
      d: process.env.ORCH_DELEGATE_ASTRA,
      p: process.env.PLATFORM_EVENTS_ENABLED,
    };
    process.env.ORCH_DELEGATE_ASTRA = "1";
    process.env.PLATFORM_EVENTS_ENABLED = "1";
    for (const m of ["../../../config/env.js", "./astraRequirementReceived.worker.js"]) {
      delete require.cache[require.resolve(m)];
    }

    const { handleAstraRequirementReceived } = require("./astraRequirementReceived.worker.js");
    // No database is reachable from this test, and none is needed: the guard
    // returns before the repository is touched. If it ever stops doing that,
    // this call throws instead of returning, which is the point.
    const out = await handleAstraRequirementReceived({
      data: { jobId: "11111111-1111-1111-1111-111111111111" },
    });

    expect(out).toEqual({
      status: "skipped",
      reason: "delegated_to_orchestrator",
      jobId: "11111111-1111-1111-1111-111111111111",
    });

    if (previous.d === undefined) delete process.env.ORCH_DELEGATE_ASTRA;
    else process.env.ORCH_DELEGATE_ASTRA = previous.d;
    if (previous.p === undefined) delete process.env.PLATFORM_EVENTS_ENABLED;
    else process.env.PLATFORM_EVENTS_ENABLED = previous.p;
    for (const m of ["../../../config/env.js", "./astraRequirementReceived.worker.js"]) {
      delete require.cache[require.resolve(m)];
    }
  });

  it("still refuses a job with no requirement id, delegated or not", async () => {
    const { handleAstraRequirementReceived } = require("./astraRequirementReceived.worker.js");
    await expect(handleAstraRequirementReceived({ data: {} })).rejects.toThrow(/missing jobId/);
  });
});
