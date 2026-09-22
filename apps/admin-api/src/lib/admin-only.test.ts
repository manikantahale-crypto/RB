/**
 * The policy, and the check that it has not fallen behind the routes.
 *
 * The matcher tests are ordinary. The last one is the important one: the
 * default in `adminOnlyRoute` is ALLOW, so a releasing route nobody listed is
 * a route operators can call. Nothing in the type system catches that. This
 * does, by reading the route files.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADMIN_ONLY, adminOnlyRoute } from "./admin-only.js";

describe("adminOnlyRoute", () => {
  it("matches a real url against a route with parameters", () => {
    const hit = adminOnlyRoute("POST", "/workflows/relay.intake/approve-go-live");
    expect(hit?.why).toBe("approving a go-live");
  });

  it("ignores the query string", () => {
    expect(
      adminOnlyRoute("POST", "/workflows/relay.intake/take-offline?reason=x"),
    ).not.toBeNull();
  });

  it("is not fooled by a longer path that starts the same", () => {
    // `/workflows/:graphKey/approve-go-live/something` is a different route.
    expect(
      adminOnlyRoute("POST", "/workflows/relay.intake/approve-go-live/extra"),
    ).toBeNull();
  });

  it("leaves authoring alone — the whole point of the tool", () => {
    for (const url of [
      "/workflows/relay.intake/draft",
      "/workflows/relay.intake/compile",
      "/workflows/relay.intake/request-go-live",
      "/workflows/relay.intake/send-for-approval",
      "/workflows/accept",
      "/workflows/propose",
      "/node-test",
      "/live-test/fire",
      "/events/draft",
    ]) {
      expect(adminOnlyRoute("POST", url), url).toBeNull();
    }
  });

  it("does not gate a read of a gated path", () => {
    // Seeing that a request exists is not approving it.
    expect(adminOnlyRoute("GET", "/workflows/relay.intake/rollback")).toBeNull();
  });

  it("every entry carries a reason a person could act on", () => {
    for (const r of ADMIN_ONLY) {
      expect(r.why, r.path).toMatch(/^[a-z]/);
      expect(r.path.startsWith("/"), r.path).toBe(true);
    }
  });
});

/**
 * The verbs that change what is running, recognised by name.
 *
 * Deliberately a list of WORDS rather than of routes: a new route called
 * `/workflows/:key/publish-live` would be caught by this without anyone
 * thinking to add it, which is exactly the failure being guarded against.
 */
const RELEASING = [
  "approve-go-live",
  "take-offline",
  "rollback",
  "activate",
  "go-live",
];

describe("the policy has not fallen behind the routes", () => {
  it("lists every registered route whose name says it changes what is running", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const routesDir = join(here, "..", "routes");
    const registered = new Set<string>();

    for (const file of readdirSync(routesDir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const src = readFileSync(join(routesDir, file), "utf8");
      for (const m of src.matchAll(
        /app\.(post|put|patch|delete)\(\s*"([^"]+)"/g,
      )) {
        registered.add(`${m[1]!.toUpperCase()} ${m[2]}`);
      }
    }

    const shouldBeGated = [...registered].filter((r) => {
      const path = r.split(" ")[1] ?? "";
      // `request-go-live` and `cancel-go-live-request` ASK; they do not release.
      if (/request/.test(path)) return false;
      return RELEASING.some((verb) => path.endsWith(`/${verb}`));
    });

    const ungated = shouldBeGated.filter((r) => {
      const [method, path] = r.split(" ") as [string, string];
      // The pattern is the route as written, so it matches itself.
      return adminOnlyRoute(method, path.replace(/:[^/]+/g, "x")) === null;
    });

    expect(
      ungated,
      "These routes change what is running and any operator can call them. " +
        "Add them to ADMIN_ONLY in admin-only.ts:\n  " + ungated.join("\n  "),
    ).toEqual([]);
    // And prove the sweep actually found routes, so a broken regex cannot
    // pass this test by finding nothing at all.
    expect(shouldBeGated.length).toBeGreaterThan(4);
  });
});
